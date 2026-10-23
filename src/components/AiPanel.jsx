import { useState, useRef, useEffect, useCallback } from 'react'
import './AiPanel.css'
import { buildSheetContext } from '../ai/context.js'
import { extractJsonFromText, validateAction } from '../ai/parser.js'
import { executeQuery } from '../ai/executor.js'
import { createProvider } from '../ai/provider.js'
import { columnLetterFromIndex, parseCellKey } from '../engine/core.js'
import { describeFormatAction } from '../ai/applier.js'

/**
 * Plain-words English description of a query plan.
 */
function describePlan(plan) {
  if (!plan) return ''
  const parts = []

  // Aggregates
  if (Array.isArray(plan.aggregates) && plan.aggregates.length > 0) {
    const aggDesc = plan.aggregates.map((agg) => {
      const alias = agg.as ? ` as "${agg.as}"` : ''
      switch (agg.fn) {
        case 'count':
          return `Count of ${agg.column}${alias}`
        case 'countDistinct':
          return `Distinct count of ${agg.column}${alias}`
        case 'avg':
          return `Average of ${agg.column}${alias}`
        case 'sum':
          return `Sum of ${agg.column}${alias}`
        case 'min':
          return `Minimum ${agg.column}${alias}`
        case 'max':
          return `Maximum ${agg.column}${alias}`
        default:
          return `${agg.fn}(${agg.column})${alias}`
      }
    })
    parts.push(aggDesc.join(', '))
  } else if (Array.isArray(plan.columns) && plan.columns.length > 0) {
    parts.push(`Columns: ${plan.columns.join(', ')}`)
  } else {
    parts.push('All columns')
  }

  // Group By
  if (Array.isArray(plan.groupBy) && plan.groupBy.length > 0) {
    parts.push(`grouped by ${plan.groupBy.join(', ')}`)
  }

  // Filters
  if (Array.isArray(plan.filters) && plan.filters.length > 0) {
    const filterDesc = plan.filters.map((f) => {
      if (f.op === 'isEmpty') return `${f.column} is empty`
      if (f.op === 'notEmpty') return `${f.column} is not empty`
      return `${f.column} ${f.op} ${JSON.stringify(f.value)}`
    })
    parts.push(`where ${filterDesc.join(' and ')}`)
  }

  // Sort
  if (Array.isArray(plan.sort) && plan.sort.length > 0) {
    const sortDesc = plan.sort.map((s) => `${s.column} (${s.dir || 'asc'})`)
    parts.push(`sorted by ${sortDesc.join(', ')}`)
  }

  // Limit
  if (plan.limit) {
    parts.push(`limited to ${plan.limit} rows`)
  }

  return parts.join(' | ')
}

const SYSTEM_PROMPT = `You are an AI assistant analyzing and formatting spreadsheet data.
The user will ask questions about the sheet or request formatting.
Analyze the provided schema and sample rows, and respond with a single JSON object.
Allowed action types:
1. "query": A read-only analysis plan.
   Schema:
   {
     "type": "query",
     "columns": ["Col1", ...], // optional projection
     "filters": [{ "column": "Col", "op": "eq|neq|gt|gte|lt|lte|contains|startsWith|endsWith|isEmpty|notEmpty", "value": ... }],
     "groupBy": ["Col", ...],
     "aggregates": [{ "fn": "count|countDistinct|sum|avg|min|max", "column": "Col", "as": "Alias" }],
     "sort": [{ "column": "Col", "dir": "asc|desc" }],
     "limit": 500,
     "excludeTotalsRow": true
   }
2. "format_sheet": When the user asks to format, style, or freeze rows in the sheet.
   {
     "type": "format_sheet",
     "clearFormatting": false,
     "headerStyle": { "bold": true, "bg": "#f0f0f0", "align": "center" },
     "bodyStyle": { "fontSize": 12 },
     "columns": [{ "col": 7, "style": { "align": "right", "numberFormat": "currency" } }],
     "totalsStyle": { "bold": true },
     "freezeRows": 1,
     "columnWidths": [{ "col": 0, "width": 90 }],
     "autoFitColumns": true
   }
3. "clarify": When the question is ambiguous or refers to unknown columns.
   { "type": "clarify", "question": "..." }

Return ONLY the JSON object. Do not include extra conversational text.`

export default function AiPanel({
  engine,
  selectedCell,
  selectionRange,
  onClose,
  onInsertCells,
  onApplyFormat,
}) {
  const [messages, setMessages] = useState([])
  const [promptInput, setPromptInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [insertTargetMap, setInsertTargetMap] = useState({}) // messageId -> target cell string
  const [showPlanMap, setShowPlanMap] = useState({}) // messageId -> boolean
  const messagesEndRef = useRef(null)

  const providerKind = typeof import.meta !== 'undefined' && import.meta.env?.VITE_AI_PROVIDER
    ? import.meta.env.VITE_AI_PROVIDER
    : 'mock'

  // Scroll messages to bottom on update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Get active cell coordinate formatted as e.g. "A1"
  const defaultTargetCoord = useCallback(() => {
    if (selectedCell) {
      return `${columnLetterFromIndex(selectedCell.c)}${selectedCell.r + 1}`
    }
    return 'A1'
  }, [selectedCell])

  // Submit Prompt Handler
  const handleSubmitPrompt = async (textToSubmit) => {
    const prompt = (textToSubmit || promptInput).trim()
    if (!prompt || isLoading) return

    const messageId = Date.now().toString()
    setPromptInput('')
    setIsLoading(true)

    // Add user turn and pending assistant card
    const userTurn = { id: messageId + '-u', role: 'user', text: prompt }
    const pendingAssistantTurn = {
      id: messageId,
      role: 'assistant',
      status: 'loading',
      text: '',
    }

    setMessages((prev) => [...prev, userTurn, pendingAssistantTurn])

    try {
      // 1. Build compact schema context (never full data)
      const context = buildSheetContext(engine, selectionRange || selectedCell)

      // 2. Call provider
      const provider = createProvider(providerKind)
      const historyTurns = messages.map((m) => ({
        role: m.role,
        content: m.text,
      }))

      const response = await provider.complete({
        system: `${SYSTEM_PROMPT}\n\nSheet Schema Context:\n${JSON.stringify(context, null, 2)}`,
        user: prompt,
        history: historyTurns,
      })

      // 3. Extract JSON from prose / code fences
      const action = extractJsonFromText(response.text)

      // 4. Handle clarify
      if (action.type === 'clarify') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  status: 'clarify',
                  question: action.question || 'Could you please clarify your request?',
                  rawResponse: response.text,
                }
              : m,
          ),
        )
        setIsLoading(false)
        return
      }

      // 5. Handle format_sheet actions (Challenge 5)
      if (action.type === 'format_sheet') {
        const validation = validateAction(action)
        if (!validation.valid) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === messageId
                ? {
                    ...m,
                    status: 'error',
                    error: `Validation Error (${validation.error}): ${validation.detail || ''}`,
                    plan: action,
                    rawResponse: response.text,
                  }
                : m,
            ),
          )
          setIsLoading(false)
          return
        }

        const formattedAction = validation.action || action
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  status: 'format_preview',
                  action: formattedAction,
                  previewSummary: describeFormatAction(formattedAction),
                  rawResponse: response.text,
                }
              : m,
          ),
        )
        setIsLoading(false)
        return
      }

      // Guardrail: reject non-query
      if (action.type !== 'query') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  status: 'error',
                  error: 'READ_ONLY: Only query and format_sheet actions are permitted.',
                  rawResponse: response.text,
                }
              : m,
          ),
        )
        setIsLoading(false)
        return
      }

      // 5. Hand-written Schema Validation
      const knownCols = Array.isArray(context?.columns) ? context.columns.map((c) => c.name) : undefined
      const validation = validateAction(action, { knownColumns: knownCols })
      if (!validation.valid) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  status: 'error',
                  error: `Validation Error (${validation.error}): ${validation.detail || ''}`,
                  plan: action,
                  rawResponse: response.text,
                }
              : m,
          ),
        )
        setIsLoading(false)
        return
      }

      const plan = validation.action || action

      // 6. Execute pure query over sheet values
      const result = executeQuery(engine, plan)
      if (result.error) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  status: 'error',
                  error: `Query Error (${result.error}): ${result.detail || ''}`,
                  plan,
                  rawResponse: response.text,
                }
              : m,
          ),
        )
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  status: 'success',
                  plan,
                  result,
                  planDescription: describePlan(plan),
                  rawResponse: response.text,
                }
              : m,
          ),
        )
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                status: 'error',
                error: err.message || 'An error occurred while processing the request',
              }
            : m,
        ),
      )
    } finally {
      setIsLoading(false)
    }
  }

  // Re-run Query (deterministic, NO model call)
  const handleReRun = (msgId, plan) => {
    if (!plan) return
    const result = executeQuery(engine, plan)
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId
          ? {
              ...m,
              result,
              reRunTimestamp: Date.now(),
            }
          : m,
      ),
    )
  }

  // Insert Table into Sheet at chosen cell
  const handleInsertIntoSheet = (msgId, result) => {
    if (!result || !onInsertCells) return
    const targetStr = (insertTargetMap[msgId] || defaultTargetCoord()).toUpperCase().trim()
    const parsed = parseCellKey(targetStr)
    if (!parsed) {
      alert(`Invalid cell coordinate "${targetStr}". Please enter a valid coordinate like A1, B10.`)
      return
    }

    const { row: startRow, col: startCol } = parsed
    const changes = []

    // 1. Column Headers
    if (Array.isArray(result.columns)) {
      result.columns.forEach((colName, cIdx) => {
        changes.push({
          row: startRow,
          col: startCol + cIdx,
          value: String(colName ?? ''),
        })
      })
    }

    // 2. Data Rows
    if (Array.isArray(result.rows)) {
      result.rows.forEach((rowVals, rIdx) => {
        rowVals.forEach((val, cIdx) => {
          changes.push({
            row: startRow + 1 + rIdx,
            col: startCol + cIdx,
            value: String(val ?? ''),
          })
        })
      })
    }

    onInsertCells(changes)
  }

  // Toggle Plan JSON view
  const toggleShowPlan = (msgId) => {
    setShowPlanMap((prev) => ({ ...prev, [msgId]: !prev[msgId] }))
  }

  return (
    <div className="ai-panel-drawer" data-testid="ai-panel">
      {/* Header */}
      <div className="ai-panel-header">
        <div className="ai-panel-title-area">
          <span className="ai-panel-title">✨ Ask Your Data</span>
          <span className="ai-panel-provider-tag">{providerKind}</span>
        </div>
        <button
          className="ai-panel-close-btn"
          onClick={onClose}
          title="Close AI Panel (Ctrl+K)"
        >
          ✕
        </button>
      </div>

      {/* Messages Stream */}
      <div className="ai-panel-messages">
        {messages.length === 0 ? (
          <div className="ai-panel-empty-state">
            <div className="ai-panel-empty-icon">📊</div>
            <div className="ai-panel-empty-title">Ask questions in plain English</div>
            <div className="ai-panel-empty-subtitle">
              Your prompt becomes a deterministic query executed over the sheet values.
            </div>
            <div className="ai-panel-examples">
              <button
                className="ai-example-btn"
                onClick={() => handleSubmitPrompt('What is the total sales by region?')}
              >
                "What is the total sales by region?"
              </button>
              <button
                className="ai-example-btn"
                onClick={() => handleSubmitPrompt('Top 3 sales reps by total sales')}
              >
                "Top 3 sales reps by total sales"
              </button>
              <button
                className="ai-example-btn"
                onClick={() => handleSubmitPrompt('How many orders were placed in the West region?')}
              >
                "How many orders were placed in the West region?"
              </button>
              <button
                className="ai-example-btn"
                onClick={() => handleSubmitPrompt('Format this as a clean table')}
              >
                "Format this as a clean table"
              </button>
              <button
                className="ai-example-btn"
                onClick={() => handleSubmitPrompt('Make the header row bold and blue')}
              >
                "Make the header row bold and blue"
              </button>
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            if (msg.role === 'user') {
              return (
                <div key={msg.id} className="ai-message-user">
                  {msg.text}
                </div>
              )
            }

            // Assistant Card
            return (
              <div key={msg.id} className="ai-message-assistant">
                {msg.status === 'loading' && (
                  <div className="ai-loading-card">
                    <div className="ai-spinner" />
                    <span>Analyzing sheet and executing query...</span>
                  </div>
                )}

                {msg.status === 'clarify' && (
                  <div className="ai-clarify-card">
                    <div className="ai-clarify-title">❓ Clarification Needed</div>
                    <div className="ai-clarify-text">{msg.question}</div>
                  </div>
                )}

                {msg.status === 'error' && (
                  <div className="ai-error-card">
                    <div className="ai-error-title">⚠️ Error</div>
                    <div>{msg.error}</div>
                  </div>
                )}

                {msg.status === 'success' && msg.result && (
                  <>
                    <div className="ai-result-header">
                      <div className="ai-plan-desc">{msg.planDescription}</div>
                      <div className="ai-result-stats">
                        <span>{msg.result.rowCount} {msg.result.rowCount === 1 ? 'row' : 'rows'}</span>
                        {msg.result.truncated && (
                          <span className="ai-truncated-badge">Capped at 500 rows</span>
                        )}
                      </div>
                    </div>

                    {/* Table Preview */}
                    <div className="ai-table-preview-wrapper">
                      <table className="ai-preview-table">
                        <thead>
                          <tr>
                            {msg.result.columns.map((col, idx) => (
                              <th key={idx}>{col}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {msg.result.rows.slice(0, 10).map((row, rIdx) => (
                            <tr key={rIdx}>
                              {row.map((cell, cIdx) => (
                                <td key={cIdx}>{cell !== null && cell !== undefined ? String(cell) : ''}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Collapsible Plan JSON */}
                    {showPlanMap[msg.id] && (
                      <pre className="ai-plan-json-view">
                        {JSON.stringify(msg.plan, null, 2)}
                      </pre>
                    )}

                    {/* Action Buttons */}
                    <div className="ai-result-actions">
                      <div className="ai-action-btn-group">
                        <button
                          className="ai-btn-sm"
                          onClick={() => toggleShowPlan(msg.id)}
                          title="View raw JSON plan"
                        >
                          {showPlanMap[msg.id] ? 'Hide Plan' : 'Show Plan'}
                        </button>
                        <button
                          className="ai-btn-sm"
                          onClick={() => handleReRun(msg.id, msg.plan)}
                          title="Re-run query over latest sheet values without calling model"
                        >
                          🔄 Re-run
                        </button>
                      </div>

                      <div className="ai-insert-group">
                        <input
                          className="ai-target-cell-input"
                          value={insertTargetMap[msg.id] ?? defaultTargetCoord()}
                          onChange={(e) =>
                            setInsertTargetMap({
                              ...insertTargetMap,
                              [msg.id]: e.target.value,
                            })
                          }
                          title="Starting cell coordinate to write results"
                        />
                        <button
                          className="ai-btn-sm ai-btn-primary"
                          onClick={() => handleInsertIntoSheet(msg.id, msg.result)}
                          title="Insert query results into sheet at target cell with 1-step undo"
                        >
                          Insert
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {msg.status === 'format_preview' && (
                  <div className="ai-format-card">
                    <div className="ai-format-header">
                      <span className="ai-format-badge">🎨 Format Preview</span>
                      <div className="ai-plan-desc">{msg.previewSummary}</div>
                    </div>

                    {showPlanMap[msg.id] && (
                      <pre className="ai-plan-json-view">
                        {JSON.stringify(msg.action, null, 2)}
                      </pre>
                    )}

                    <div className="ai-result-actions">
                      <button
                        className="ai-btn-sm"
                        onClick={() => toggleShowPlan(msg.id)}
                        title="View raw JSON action"
                      >
                        {showPlanMap[msg.id] ? 'Hide Plan' : 'Show Plan'}
                      </button>

                      <div className="ai-format-actions-right">
                        <button
                          className="ai-btn-sm ai-btn-discard"
                          onClick={() => {
                            setMessages((prev) =>
                              prev.map((m) =>
                                m.id === msg.id
                                  ? { ...m, status: 'format_discarded' }
                                  : m,
                              ),
                            )
                          }}
                        >
                          Discard
                        </button>
                        <button
                          className="ai-btn-sm ai-btn-primary"
                          onClick={() => {
                            if (onApplyFormat) {
                              const res = onApplyFormat(msg.action)
                              if (!res?.success) {
                                alert(`Formatting Error: ${res?.detail || res?.error}`)
                                return
                              }
                              setMessages((prev) =>
                                prev.map((m) =>
                                  m.id === msg.id
                                    ? {
                                        ...m,
                                        status: 'format_applied',
                                        appliedDetail:
                                          res.code === 'NO_CHANGES'
                                            ? 'No changes needed'
                                            : '✓ Applied formatting (Ctrl+Z to undo)',
                                      }
                                    : m,
                                ),
                              )
                            }
                          }}
                        >
                          Apply
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {msg.status === 'format_applied' && (
                  <div className="ai-format-applied-card">
                    <div className="ai-format-success-title">{msg.appliedDetail || '✓ Applied formatting'}</div>
                    <div className="ai-plan-desc">{msg.previewSummary}</div>
                  </div>
                )}

                {msg.status === 'format_discarded' && (
                  <div className="ai-format-discarded-card">
                    <span>Discarded formatting proposal</span>
                  </div>
                )}
              </div>
            )
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Footer */}
      <div className="ai-panel-footer">
        <form
          className="ai-input-form"
          onSubmit={(e) => {
            e.preventDefault()
            handleSubmitPrompt()
          }}
        >
          <textarea
            className="ai-textarea"
            placeholder="Ask a question about your sheet..."
            value={promptInput}
            onChange={(e) => setPromptInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSubmitPrompt()
              }
            }}
            disabled={isLoading}
          />
          <div className="ai-form-actions">
            <span className="ai-hint-text">Enter to send · Ctrl+K to toggle</span>
            <button
              type="submit"
              className="ai-send-btn"
              disabled={isLoading || !promptInput.trim()}
            >
              {isLoading ? 'Thinking...' : 'Ask AI'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
