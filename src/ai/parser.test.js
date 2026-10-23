import { describe, it, expect } from 'vitest'
import { extractJsonFromText, validateAction } from './parser.js'
import { buildSheetContext, inferColumnType } from './context.js'
import { createEngine } from '../engine/core.js'

describe('Challenge 4 - Task 4.1: Sheet Context Generator & Schema Validator', () => {
  describe('extractJsonFromText', () => {
    it('extracts raw JSON string directly', () => {
      const raw = '{"type":"query","limit":10}'
      expect(extractJsonFromText(raw)).toEqual({ type: 'query', limit: 10 })
    })

    it('extracts JSON enclosed within markdown ```json code fences', () => {
      const raw = 'Here is the plan:\n\n```json\n{\n  "type": "query",\n  "groupBy": ["Region"]\n}\n```\n\nHope this helps!'
      expect(extractJsonFromText(raw)).toEqual({ type: 'query', groupBy: ['Region'] })
    })

    it('extracts JSON enclosed within plain ``` code fences', () => {
      const raw = '```\n{"type":"clarify","question":"Which column?"}\n```'
      expect(extractJsonFromText(raw)).toEqual({ type: 'clarify', question: 'Which column?' })
    })

    it('extracts JSON surrounded by prose without fences', () => {
      const raw = 'The requested analysis plan is {"type":"query","columns":["Order ID"]} based on your request.'
      expect(extractJsonFromText(raw)).toEqual({ type: 'query', columns: ['Order ID'] })
    })

    it('throws INVALID_RESPONSE on malformed JSON or empty string', () => {
      expect(() => extractJsonFromText('')).toThrowError(/INVALID_RESPONSE/)
      expect(() => extractJsonFromText('Just some chat response with no json at all')).toThrowError(/INVALID_RESPONSE/)
      expect(() => extractJsonFromText('{ "type": "query", unquotedKey: bad }')).toThrowError(/INVALID_RESPONSE/)
    })
  })

  describe('validateAction & Guardrails', () => {
    const knownColumns = ['Order ID', 'Region', 'Date', 'Total', 'Units']

    it('validates a correct query plan and clamps limit to MAX_RESULT_ROWS (500)', () => {
      const plan = {
        type: 'query',
        groupBy: ['Region'],
        aggregates: [{ fn: 'sum', column: 'Total', as: 'Total Sales' }],
        sort: [{ column: 'Total Sales', dir: 'desc' }],
        limit: 1000, // Should be clamped
      }
      const res = validateAction(plan, { knownColumns })
      expect(res.valid).toBe(true)
      expect(res.action.limit).toBe(500)
      expect(res.action.excludeTotalsRow).toBe(true) // default true
    })

    it('rejects mutation actions with READ_ONLY guardrail', () => {
      const mutationAction = {
        type: 'mutation',
        changes: [{ row: 1, col: 1, value: '500' }],
      }
      const res = validateAction(mutationAction, { allowedTypes: ['query', 'clarify'] })
      expect(res.valid).toBe(false)
      expect(res.error).toBe('READ_ONLY')
    })

    it('rejects unknown filter operator with UNKNOWN_OP', () => {
      const badFilterPlan = {
        type: 'query',
        filters: [{ column: 'Region', op: 'matchesRegex', value: '.*' }],
      }
      const res = validateAction(badFilterPlan, { knownColumns })
      expect(res.valid).toBe(false)
      expect(res.error).toBe('UNKNOWN_OP')
      expect(res.detail).toContain('matchesRegex')
    })

    it('rejects unknown aggregate function with UNKNOWN_FN', () => {
      const badAggPlan = {
        type: 'query',
        aggregates: [{ fn: 'stdev', column: 'Total' }],
      }
      const res = validateAction(badAggPlan, { knownColumns })
      expect(res.valid).toBe(false)
      expect(res.error).toBe('UNKNOWN_FN')
      expect(res.detail).toContain('stdev')
    })

    it('rejects unknown column names with UNKNOWN_COLUMN guardrail', () => {
      const badColPlan = {
        type: 'query',
        filters: [{ column: 'NonExistentColumn', op: 'eq', value: 'East' }],
      }
      const res = validateAction(badColPlan, { knownColumns })
      expect(res.valid).toBe(false)
      expect(res.error).toBe('UNKNOWN_COLUMN')
      expect(res.detail).toContain('NonExistentColumn')
    })

    it('validates clarify actions with question string', () => {
      const clarifyAction = {
        type: 'clarify',
        question: 'Which column holds the revenue: Total or Unit Price?',
      }
      const res = validateAction(clarifyAction)
      expect(res.valid).toBe(true)
      expect(res.action.question).toContain('revenue')
    })
  })

  describe('buildSheetContext & Type Inference', () => {
    it('infers column types accurately', () => {
      expect(inferColumnType('Order ID', ['ORD-1001', 'ORD-1002'])).toBe('id')
      expect(inferColumnType('Order Date', ['2024-01-15', '1/16/2024', '17 Jan 2024'])).toBe('date')
      expect(inferColumnType('Total Price', ['$1,200.00', '$45.00'])).toBe('currency')
      expect(inferColumnType('Discount Rate', ['10%', '15%'])).toBe('percent')
      expect(inferColumnType('Quantity', ['5', '10', '25'])).toBe('number')
      expect(inferColumnType('Region', ['East', 'West', 'Central'])).toBe('text')
    })

    it('builds compact sheet context without sending full data', () => {
      const engine = createEngine(20, 10)
      // Header row (Row 0 / 1)
      engine.setCell(0, 0, 'Order ID')
      engine.setCell(0, 1, 'Region')
      engine.setCell(0, 2, 'Total')

      // Body rows (10 rows)
      for (let r = 1; r <= 10; r++) {
        engine.setCell(r, 0, `ORD-${1000 + r}`)
        engine.setCell(r, 1, r % 2 === 0 ? 'East' : 'West')
        engine.setCell(r, 2, `$${r * 100}.00`)
      }

      // Totals row at row 11
      engine.setCell(11, 0, 'Total')
      engine.setCell(11, 2, '$5500.00')

      const context = buildSheetContext(engine, { start: { r: 1, c: 1 }, end: { r: 5, c: 2 } })

      // Checks shape
      expect(context.range).toBe('A1:C12')
      expect(context.rowCount).toBe(10) // 10 body data rows excluding header & totals row
      expect(context.hasTotalsRow).toBe(true)
      expect(context.selection).toBe('B2:C6')

      // Verifies columns metadata
      expect(context.columns.length).toBe(3)
      expect(context.columns[0].name).toBe('Order ID')
      expect(context.columns[0].type).toBe('id')
      expect(context.columns[1].type).toBe('text')
      expect(context.columns[2].type).toBe('currency')

      // CRITICAL CONTRACT CHECK: at most 5 sample rows, never full 10 rows
      expect(context.sampleRows.length).toBeLessThanOrEqual(5)
      expect(context.sampleRows[0]).toEqual(['ORD-1001', 'West', '$100.00'])
    })
  })
})
