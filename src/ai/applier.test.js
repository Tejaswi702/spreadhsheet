import { describe, it, expect, beforeEach } from 'vitest'
import { createEngine } from '../engine/core.js'
import {
  isTotalsRow,
  describeFormatAction,
  applyFormatSheet,
} from './applier.js'

describe('Challenge 5 - Task 5.2: Pure Sheet Format Applier', () => {
  let engine

  beforeEach(() => {
    engine = createEngine(50, 20)
  })

  // Helper to load simple sample data
  function populateSampleData() {
    engine.setCell(0, 0, 'ID')
    engine.setCell(0, 1, 'Region')
    engine.setCell(0, 2, 'Sales')

    engine.setCell(1, 0, '1')
    engine.setCell(1, 1, 'East')
    engine.setCell(1, 2, '1200')

    engine.setCell(2, 0, '2')
    engine.setCell(2, 1, 'West')
    engine.setCell(2, 2, '850')

    engine.setCell(3, 0, 'Total')
    engine.setCell(3, 1, '')
    engine.setCell(3, 2, '2050')
  }

  describe('Totals Row Detection (isTotalsRow)', () => {
    it('detects totals row by regex on first filled cell', () => {
      populateSampleData()
      const used = engine.getUsedRange()
      expect(isTotalsRow(engine, used)).toBe(true)
    })

    it('returns false when last row is normal data', () => {
      engine.setCell(0, 0, 'Header')
      engine.setCell(1, 0, 'Row 1')
      engine.setCell(2, 0, 'Row 2')
      const used = engine.getUsedRange()
      expect(isTotalsRow(engine, used)).toBe(false)
    })
  })

  describe('Plain-Words Description (describeFormatAction)', () => {
    it('generates human-readable summary of formatting action', () => {
      const action = {
        type: 'format_sheet',
        headerStyle: { bold: true, bg: '#f0f0f0', align: 'center' },
        columns: [
          { col: 2, style: { numberFormat: 'currency' } },
        ],
        freezeRows: 1,
        autoFitColumns: true,
      }
      const summary = describeFormatAction(action)
      expect(summary).toContain('header: bold, bg #f0f0f0, center')
      expect(summary).toContain('currency')
      expect(summary).toContain('freeze 1 row(s)')
      expect(summary).toContain('auto-fit columns')
    })
  })

  describe('Load-Bearing Application Order & Precedence', () => {
    it('applies headerStyle LAST so it wins over column alignment, and header is not formatted by column styles', () => {
      populateSampleData()
      const action = {
        type: 'format_sheet',
        headerStyle: { bold: true, bg: '#f0f0f0', align: 'center' },
        columns: [
          { col: 2, style: { align: 'right', numberFormat: 'currency' } },
        ],
        totalsStyle: { bold: true },
        freezeRows: 1,
      }

      const result = applyFormatSheet(engine, {}, action)
      expect(result.success).toBe(true)
      expect(result.code).toBe('APPLIED')

      const styles = result.newStyles

      // Header row (0): bold, bg, center align (wins over column 2 align 'right', no numberFormat)
      expect(styles['0,0']).toEqual({ bold: true, bg: '#f0f0f0', align: 'center' })
      expect(styles['0,2']).toEqual({ bold: true, bg: '#f0f0f0', align: 'center' })
      expect(styles['0,2'].numberFormat).toBeUndefined()

      // Body row (1, 2): column 2 has right align and currency
      expect(styles['1,2']).toEqual({ align: 'right', numberFormat: 'currency' })
      expect(styles['2,2']).toEqual({ align: 'right', numberFormat: 'currency' })

      // Totals row (3): has totalsStyle bold
      expect(styles['3,0']).toEqual({ bold: true })
      expect(styles['3,2']).toEqual({ align: 'right', numberFormat: 'currency', bold: true })
    })

    it('ignores column indices outside used range and writes nothing outside', () => {
      populateSampleData()
      const action = {
        type: 'format_sheet',
        headerStyle: { bold: true },
        columns: [
          { col: 99, style: { numberFormat: 'currency' } }, // outside used range
        ],
      }

      const result = applyFormatSheet(engine, {}, action)
      expect(result.success).toBe(true)
      // Col 99 should not exist in newStyles
      expect(result.newStyles['1,99']).toBeUndefined()
    })
  })

  describe('Guardrails and Error Codes', () => {
    it('refuses freezeRows >= usedRowCount with OUT_OF_RANGE (§4.5)', () => {
      populateSampleData() // 4 used rows: rows 0, 1, 2, 3
      const action = {
        type: 'format_sheet',
        headerStyle: { bold: true },
        freezeRows: 4, // 4 >= 4 used rows -> illegal
      }

      const result = applyFormatSheet(engine, {}, action)
      expect(result.success).toBe(false)
      expect(result.code).toBe('OUT_OF_RANGE')
      expect(result.error).toBe('OUT_OF_RANGE')
    })

    it('reports NO_CHANGES when an action produces zero effective changes', () => {
      populateSampleData()
      const initialStyles = {
        '0,0': { bold: true },
        '0,1': { bold: true },
        '0,2': { bold: true },
      }

      // Re-applying the exact same header bold when engine freezeRows is already 0
      const action = {
        type: 'format_sheet',
        headerStyle: { bold: true },
        freezeRows: 0,
      }

      const result = applyFormatSheet(engine, initialStyles, action)
      expect(result.success).toBe(true)
      expect(result.code).toBe('NO_CHANGES')
    })
  })
})
