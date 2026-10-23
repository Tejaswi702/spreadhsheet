import { describe, it, expect, beforeAll } from 'vitest'
import { executeQuery, norm, toNum, parseToIsoDate } from './executor.js'
import { createEngine } from '../engine/core.js'
import { loadSampleLarge } from '../fixtures/loadSample.js'
import queries from '../../fixtures/ai-eval/queries.json'

describe('Challenge 4 - Task 4.2: Pure Query Executor Engine', () => {
  let engine

  beforeAll(() => {
    engine = createEngine(3050, 20)
    loadSampleLarge(engine)
    // Warm up V8 JIT compiler
    if (queries.cases.length > 0) {
      executeQuery(engine, queries.cases[0].plan)
    }
  })

  describe('Value normalization helpers', () => {
    it('toNum coerces currency, percent, and numbers; handles N/A', () => {
      expect(toNum('$1,200.00')).toBe(1200)
      expect(toNum('10%')).toBe(0.1)
      expect(toNum('0.1')).toBe(0.1)
      expect(toNum('$ 49.99')).toBe(49.99)
      expect(toNum('N/A')).toBeNull()
      expect(toNum('n/a')).toBeNull()
      expect(toNum('')).toBeNull()
      expect(toNum(500)).toBe(500)
    })

    it('norm produces trimmed lowercase strings', () => {
      expect(norm('  West  ')).toBe('west')
      expect(norm('ELECTRONICS')).toBe('electronics')
      expect(norm('')).toBe('')
      expect(norm(null)).toBe('')
    })

    it('parseToIsoDate handles YYYY-MM-DD, M/D/YYYY, D Mon YYYY', () => {
      expect(parseToIsoDate('2024-01-15')).toBe('2024-01-15')
      expect(parseToIsoDate('1/8/2024')).toBe('2024-01-08')
      expect(parseToIsoDate('15 Jan 2024')).toBe('2024-01-15')
      expect(parseToIsoDate('21 Jul 2024')).toBe('2024-07-21')
      expect(parseToIsoDate('3 February 2024')).toBe('2024-02-03')
      expect(parseToIsoDate('invalid')).toBeNull()
    })
  })

  describe('Golden Queries from queries.json on sales-large.tsv', () => {
    for (const testCase of queries.cases) {
      it(`Case ${testCase.id}: "${testCase.prompt}"`, () => {
        const t0 = performance.now()
        const result = executeQuery(engine, testCase.plan)
        const duration = performance.now() - t0

        // Performance Budget: Any golden plan over sales-large.tsv runs in under 50 ms
        expect(duration).toBeLessThan(50)

        if (testCase.expect.error) {
          expect(result.error).toBe(testCase.expect.error)
          if (testCase.expect.detail) {
            expect(result.detail).toBe(testCase.expect.detail)
          }
          return
        }

        // Validate output columns
        expect(result.columns).toEqual(testCase.expect.columns)

        // Validate row count and truncation
        expect(result.rowCount).toBe(testCase.expect.rowCount)
        expect(result.truncated).toBe(testCase.expect.truncated)

        // Validate rows values (numbers within 0.01 tolerance)
        const expectedRows = testCase.expect.rows || testCase.expect.rowsPreview
        expect(result.rows.length).toBeGreaterThanOrEqual(expectedRows.length)

        for (let i = 0; i < expectedRows.length; i++) {
          const actualRow = result.rows[i]
          const expRow = expectedRows[i]
          expect(actualRow.length).toBe(expRow.length)

          for (let j = 0; j < expRow.length; j++) {
            const expVal = expRow[j]
            const actVal = actualRow[j]

            if (typeof expVal === 'number') {
              expect(typeof actVal).toBe('number')
              expect(Math.abs(actVal - expVal)).toBeLessThanOrEqual(0.01)
            } else {
              expect(String(actVal)).toBe(String(expVal))
            }
          }
        }
      })
    }
  })

  describe('Budget & Stress Testing: 100,000 Generated Rows', () => {
    it('executes a two-level group-by over 100,000 rows in under 500 ms', () => {
      const largeEngine = createEngine(100010, 5)
      largeEngine.setCell(0, 0, 'Region')
      largeEngine.setCell(0, 1, 'Category')
      largeEngine.setCell(0, 2, 'Total')

      const regions = ['East', 'West', 'Central', 'North', 'South']
      const categories = ['Electronics', 'Furniture', 'Software', 'Accessories']

      // Batch fill 100,000 rows in engine
      const changes = []
      for (let r = 1; r <= 100000; r++) {
        const reg = regions[r % regions.length]
        const cat = categories[r % categories.length]
        const tot = String((r % 500) + 10)
        changes.push({ row: r, col: 0, value: reg })
        changes.push({ row: r, col: 1, value: cat })
        changes.push({ row: r, col: 2, value: tot })
      }
      largeEngine.setCells(changes)

      const twoLevelPlan = {
        type: 'query',
        groupBy: ['Region', 'Category'],
        aggregates: [{ fn: 'sum', column: 'Total', as: 'Sum' }],
        sort: [{ column: 'Sum', dir: 'desc' }],
      }

      const t0 = performance.now()
      const result = executeQuery(largeEngine, twoLevelPlan)
      const duration = performance.now() - t0

      expect(result.rowCount).toBe(20) // 5 regions * 4 categories
      expect(result.columns).toEqual(['Region', 'Category', 'Sum'])
      expect(duration).toBeLessThan(500) // Budget: < 500 ms
    })
  })
})
