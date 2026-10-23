// ─────────────────────────────────────────────────────────────
//  AI Response Parser & JSON Schema Validator (Challenge 4 Task 4.1)
//
//  Conforms to AI_CONTRACT.md:
//  1. Extract first JSON object from raw model text (code fences, prose).
//  2. Parse it; fail with INVALID_RESPONSE if malformed.
//  3. Validate against schema; fail with INVALID_RESPONSE / READ_ONLY / UNKNOWN_COLUMN / UNKNOWN_OP / UNKNOWN_FN.
// ─────────────────────────────────────────────────────────────

import { ACTION_TYPES, FILTER_OPS, AGGREGATE_FNS, MAX_RESULT_ROWS } from './contract.js'

/**
 * Extracts the first JSON object from a model's raw response text.
 * Handles prose before/after JSON, markdown code blocks (```json ... ``` or ``` ... ```).
 *
 * @param {string} text - Raw text from provider
 * @returns {object} Parsed JSON object
 * @throws {Error} with code 'INVALID_RESPONSE' if no valid JSON found
 */
export function extractJsonFromText(text) {
  if (!text || typeof text !== 'string') {
    const err = new Error('INVALID_RESPONSE: Empty response text')
    err.code = 'INVALID_RESPONSE'
    throw err
  }

  const trimmed = text.trim()

  // 1. Check for markdown code fences ```json ... ``` or ``` ... ```
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim())
    } catch {
      // If code block fails to parse, fall through to bracket search
    }
  }

  // 2. Locate first balanced JSON object { ... }
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1)
    try {
      return JSON.parse(candidate)
    } catch {
      // Try finding the first closed object incrementally
      let depth = 0
      let inString = false
      let escape = false
      for (let i = firstBrace; i < trimmed.length; i++) {
        const char = trimmed[i]
        if (escape) {
          escape = false
          continue
        }
        if (char === '\\') {
          escape = true
          continue
        }
        if (char === '"') {
          inString = !inString
          continue
        }
        if (!inString) {
          if (char === '{') depth++
          else if (char === '}') {
            depth--
            if (depth === 0) {
              const substring = trimmed.slice(firstBrace, i + 1)
              try {
                return JSON.parse(substring)
              } catch {
                break
              }
            }
          }
        }
      }
    }
  }

  const err = new Error('INVALID_RESPONSE: Could not extract valid JSON object from response')
  err.code = 'INVALID_RESPONSE'
  throw err
}

/**
 * Validates an action object against the contract specification.
 *
 * @param {object} action - Parsed JSON object from the model
 * @param {object} options - Validation options:
 *   - allowedTypes: string[] (default: ['query', 'clarify', 'format_sheet'])
 *   - knownColumns: string[] (optional sheet column headers to enforce guardrails)
 * @returns {{ valid: boolean, action?: object, error?: string, detail?: string }}
 */
export function validateAction(action, options = {}) {
  const allowedTypes = options.allowedTypes || [
    ACTION_TYPES.QUERY,
    ACTION_TYPES.CLARIFY,
    ACTION_TYPES.FORMAT_SHEET,
  ]

  if (!action || typeof action !== 'object' || Array.isArray(action)) {
    return {
      valid: false,
      error: 'INVALID_RESPONSE',
      detail: 'INVALID_RESPONSE: Expected a JSON object',
    }
  }

  if (!action.type || typeof action.type !== 'string') {
    return {
      valid: false,
      error: 'INVALID_RESPONSE',
      detail: 'INVALID_RESPONSE: Missing required field "type"',
    }
  }

  // Reject mutation or non-read-only actions when in query mode
  if (action.type === 'mutation' || !allowedTypes.includes(action.type)) {
    return {
      valid: false,
      error: 'READ_ONLY',
      detail: `READ_ONLY: Action type "${action.type}" is not allowed. Only read-only queries and clarification are permitted.`,
    }
  }

  // 1. Clarify action validation
  if (action.type === ACTION_TYPES.CLARIFY) {
    if (!action.question || typeof action.question !== 'string' || action.question.trim() === '') {
      return {
        valid: false,
        error: 'INVALID_RESPONSE',
        detail: 'INVALID_RESPONSE: "clarify" action requires non-empty "question" string',
      }
    }
    return { valid: true, action }
  }

  // 2. Query action validation
  if (action.type === ACTION_TYPES.QUERY) {
    if (action.excludeTotalsRow !== undefined && typeof action.excludeTotalsRow !== 'boolean') {
      return {
        valid: false,
        error: 'INVALID_RESPONSE',
        detail: 'INVALID_RESPONSE: "excludeTotalsRow" must be a boolean',
      }
    }

    // Normalized known columns lookup set (lowercase)
    const knownSet = options.knownColumns
      ? new Map(options.knownColumns.map((col) => [col.trim().toLowerCase(), col]))
      : null

    // Validate filters
    if (action.filters !== undefined) {
      if (!Array.isArray(action.filters)) {
        return {
          valid: false,
          error: 'INVALID_RESPONSE',
          detail: 'INVALID_RESPONSE: "filters" must be an array',
        }
      }
      for (const filter of action.filters) {
        if (!filter || typeof filter !== 'object') {
          return {
            valid: false,
            error: 'INVALID_RESPONSE',
            detail: 'INVALID_RESPONSE: each filter must be an object',
          }
        }
        if (!filter.column || typeof filter.column !== 'string') {
          return {
            valid: false,
            error: 'INVALID_RESPONSE',
            detail: 'INVALID_RESPONSE: filter missing required "column" string',
          }
        }
        if (!filter.op || typeof filter.op !== 'string') {
          return {
            valid: false,
            error: 'INVALID_RESPONSE',
            detail: 'INVALID_RESPONSE: filter missing required "op" string',
          }
        }
        if (!FILTER_OPS.includes(filter.op)) {
          return {
            valid: false,
            error: 'UNKNOWN_OP',
            detail: `UNKNOWN_OP:${filter.op}`,
          }
        }
        if (knownSet && !knownSet.has(filter.column.trim().toLowerCase())) {
          return {
            valid: false,
            error: 'UNKNOWN_COLUMN',
            detail: `UNKNOWN_COLUMN:${filter.column}`,
          }
        }
      }
    }

    // Validate groupBy
    if (action.groupBy !== undefined) {
      if (!Array.isArray(action.groupBy)) {
        return {
          valid: false,
          error: 'INVALID_RESPONSE',
          detail: 'INVALID_RESPONSE: "groupBy" must be an array',
        }
      }
      for (const col of action.groupBy) {
        if (typeof col !== 'string') {
          return {
            valid: false,
            error: 'INVALID_RESPONSE',
            detail: 'INVALID_RESPONSE: groupBy item must be a string column name',
          }
        }
        if (knownSet && !knownSet.has(col.trim().toLowerCase())) {
          return {
            valid: false,
            error: 'UNKNOWN_COLUMN',
            detail: `UNKNOWN_COLUMN:${col}`,
          }
        }
      }
    }

    // Validate aggregates
    const aggregateAliases = new Set()
    if (action.aggregates !== undefined) {
      if (!Array.isArray(action.aggregates)) {
        return {
          valid: false,
          error: 'INVALID_RESPONSE',
          detail: 'INVALID_RESPONSE: "aggregates" must be an array',
        }
      }
      for (const agg of action.aggregates) {
        if (!agg || typeof agg !== 'object') {
          return {
            valid: false,
            error: 'INVALID_RESPONSE',
            detail: 'INVALID_RESPONSE: aggregate must be an object',
          }
        }
        if (!agg.fn || typeof agg.fn !== 'string') {
          return {
            valid: false,
            error: 'INVALID_RESPONSE',
            detail: 'INVALID_RESPONSE: aggregate missing required "fn" string',
          }
        }
        if (!AGGREGATE_FNS.includes(agg.fn)) {
          return {
            valid: false,
            error: 'UNKNOWN_FN',
            detail: `UNKNOWN_FN:${agg.fn}`,
          }
        }
        if (!agg.column || typeof agg.column !== 'string') {
          return {
            valid: false,
            error: 'INVALID_RESPONSE',
            detail: 'INVALID_RESPONSE: aggregate missing required "column" string',
          }
        }
        if (knownSet && !knownSet.has(agg.column.trim().toLowerCase())) {
          return {
            valid: false,
            error: 'UNKNOWN_COLUMN',
            detail: `UNKNOWN_COLUMN:${agg.column}`,
          }
        }
        const alias = agg.as || `${agg.fn}(${agg.column})`
        aggregateAliases.add(alias.toLowerCase())
      }
    }

    // Validate columns
    if (action.columns !== undefined) {
      if (!Array.isArray(action.columns)) {
        return {
          valid: false,
          error: 'INVALID_RESPONSE',
          detail: 'INVALID_RESPONSE: "columns" must be an array',
        }
      }
      for (const col of action.columns) {
        if (typeof col !== 'string') {
          return {
            valid: false,
            error: 'INVALID_RESPONSE',
            detail: 'INVALID_RESPONSE: columns item must be a string',
          }
        }
        if (knownSet && !knownSet.has(col.trim().toLowerCase())) {
          return {
            valid: false,
            error: 'UNKNOWN_COLUMN',
            detail: `UNKNOWN_COLUMN:${col}`,
          }
        }
      }
    }

    // Validate sort
    if (action.sort !== undefined) {
      if (!Array.isArray(action.sort)) {
        return {
          valid: false,
          error: 'INVALID_RESPONSE',
          detail: 'INVALID_RESPONSE: "sort" must be an array',
        }
      }
      for (const s of action.sort) {
        if (!s || typeof s !== 'object' || !s.column || typeof s.column !== 'string') {
          return {
            valid: false,
            error: 'INVALID_RESPONSE',
            detail: 'INVALID_RESPONSE: sort entry requires a "column" string',
          }
        }
        if (s.dir && !['asc', 'desc'].includes(s.dir)) {
          return {
            valid: false,
            error: 'INVALID_RESPONSE',
            detail: 'INVALID_RESPONSE: sort "dir" must be "asc" or "desc"',
          }
        }
        // Column can be a sheet column, a groupBy column, or an aggregate alias
        const colNorm = s.column.trim().toLowerCase()
        const isAggregateAlias = aggregateAliases.has(colNorm)
        if (knownSet && !knownSet.has(colNorm) && !isAggregateAlias) {
          return {
            valid: false,
            error: 'UNKNOWN_COLUMN',
            detail: `UNKNOWN_COLUMN:${s.column}`,
          }
        }
      }
    }

    // Validate limit
    if (action.limit !== undefined) {
      if (typeof action.limit !== 'number' || action.limit < 1 || !Number.isInteger(action.limit)) {
        return {
          valid: false,
          error: 'INVALID_RESPONSE',
          detail: 'INVALID_RESPONSE: "limit" must be a positive integer',
        }
      }
    }

    // Enforce default limit and clamp to MAX_RESULT_ROWS (500)
    const sanitizedAction = {
      ...action,
      excludeTotalsRow: action.excludeTotalsRow ?? true,
      limit: Math.min(MAX_RESULT_ROWS, action.limit || MAX_RESULT_ROWS),
    }

    return { valid: true, action: sanitizedAction }
  }

  // 3. Format sheet action validation
  if (action.type === ACTION_TYPES.FORMAT_SHEET) {
    if (action.freezeRows !== undefined && action.freezeRows !== null) {
      if (typeof action.freezeRows !== 'number' || action.freezeRows < 0) {
        return {
          valid: false,
          error: 'INVALID_RESPONSE',
          detail: 'INVALID_RESPONSE: "freezeRows" must be a non-negative integer or null',
        }
      }
    }
    return { valid: true, action }
  }

  return {
    valid: false,
    error: 'INVALID_RESPONSE',
    detail: `INVALID_RESPONSE: Unrecognized action type "${action.type}"`,
  }
}
