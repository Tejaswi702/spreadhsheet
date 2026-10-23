import { describe, it, expect, beforeEach } from 'vitest'
import { createEngine } from '../engine/core.js'
import { loadSampleSmall, loadSampleLarge } from '../fixtures/loadSample.js'
import { applyFormatSheet, isTotalsRow } from './applier.js'
import { formatCellValue } from './formatter.js'
import formatPrompts from '../../fixtures/ai-eval/format-prompts.json'

describe('Challenge 5 - Task 5.4: Golden Evaluation & Performance Benchmark Suite', () => {
  let engine

  beforeEach(() => {
    engine = createEngine(3050, 20)
  })

  describe('Golden Cases from format-prompts.json on sales.tsv (Sample 33)', () => {
    it('Case f01: "Format this as a clean table"', () => {
      loadSampleSmall(engine)
      const testCase = formatPrompts.cases.find((c) => c.id === 'f01')
      const result = applyFormatSheet(engine, {}, testCase.action)

      expect(result.success).toBe(true)
      expect(result.code).toBe('APPLIED')

      const styles = result.newStyles

      // Cell A1: bold: true, bg: '#f0f0f0', align: 'center'
      expect(styles['0,0']?.bold).toBe(true)
      expect(styles['0,0']?.bg).toBe('#f0f0f0')
      expect(styles['0,0']?.align).toBe('center')

      // Cell J1: bold: true
      expect(styles['0,9']?.bold).toBe(true)

      // Cell A33 (row 32): bold: true (totals row)
      expect(styles['32,0']?.bold).toBe(true)

      // Cell A32 (row 31): bold: false/undefined
      expect(styles['31,0']?.bold).toBeFalsy()

      // Cell H2 (row 1, col 7): display $1,200.00
      const h2Val = engine.getCell(1, 7).computed ?? engine.getCell(1, 7).raw
      expect(formatCellValue(h2Val, styles['1,7']?.numberFormat)).toBe('$1,200.00')

      // Cell H7 (row 6, col 7): display $79.00
      const h7Val = engine.getCell(6, 7).computed ?? engine.getCell(6, 7).raw
      expect(formatCellValue(h7Val, styles['6,7']?.numberFormat)).toBe('$79.00')

      // Cell I2 (row 1, col 8): display 10%
      const i2Val = engine.getCell(1, 8).computed ?? engine.getCell(1, 8).raw
      expect(formatCellValue(i2Val, styles['1,8']?.numberFormat)).toBe('10%')

      // Cell I6 (row 5, col 8): display 10% (raw 0.1)
      const i6Val = engine.getCell(5, 8).computed ?? engine.getCell(5, 8).raw
      expect(formatCellValue(i6Val, styles['5,8']?.numberFormat)).toBe('10%')

      // Cell I14 (row 13, col 8): display n/a (non-numeric text left alone)
      const i14Val = engine.getCell(13, 8).computed ?? engine.getCell(13, 8).raw
      expect(formatCellValue(i14Val, styles['13,8']?.numberFormat)).toBe('n/a')

      // Cell H1 (row 0, col 7): header row is never number-formatted
      const h1Val = engine.getCell(0, 7).computed ?? engine.getCell(0, 7).raw
      expect(formatCellValue(h1Val, styles['0,7']?.numberFormat)).toBe('Unit Price')

      // Cell G2 (row 1, col 6): align right
      expect(styles['1,6']?.align).toBe('right')

      // freezeRows: 1
      expect(result.structuralChanges?.freezeRows).toBe(1)
    })

    it('Case f02: "Make the header row bold and blue"', () => {
      loadSampleSmall(engine)
      const testCase = formatPrompts.cases.find((c) => c.id === 'f02')
      const result = applyFormatSheet(engine, {}, testCase.action)

      expect(result.success).toBe(true)
      const styles = result.newStyles

      // A1 and J1 have bold and bg #cce5ff
      expect(styles['0,0']).toEqual({ bold: true, bg: '#cce5ff' })
      expect(styles['0,9']).toEqual({ bold: true, bg: '#cce5ff' })

      // K1 (col 10) is outside used range -> unaffected
      expect(styles['0,10']).toBeUndefined()

      // A2 (row 1) is unaffected
      expect(styles['1,0']).toBeUndefined()
    })

    it('Case f03: "Show unit prices and totals as currency with two decimals"', () => {
      loadSampleSmall(engine)
      const testCase = formatPrompts.cases.find((c) => c.id === 'f03')
      const result = applyFormatSheet(engine, {}, testCase.action)

      expect(result.success).toBe(true)
      const styles = result.newStyles

      // H7 -> $79.00
      const h7Val = engine.getCell(6, 7).computed ?? engine.getCell(6, 7).raw
      expect(formatCellValue(h7Val, styles['6,7']?.numberFormat)).toBe('$79.00')

      // H32 -> $49.99 (raw is "$ 49.99")
      const h32Val = engine.getCell(31, 7).computed ?? engine.getCell(31, 7).raw
      expect(formatCellValue(h32Val, styles['31,7']?.numberFormat)).toBe('$49.99')

      // J2 -> $4,320.00
      const j2Val = engine.getCell(1, 9).computed ?? engine.getCell(1, 9).raw
      expect(formatCellValue(j2Val, styles['1,9']?.numberFormat)).toBe('$4,320.00')

      // Blank cell in col J (ORD-1021 at row index 22) stays blank
      const blankVal = engine.getCell(22, 9).computed ?? engine.getCell(22, 9).raw
      expect(formatCellValue(blankVal, styles['22,9']?.numberFormat)).toBe('')

      // H1 (header) stays Unit Price
      const h1Val = engine.getCell(0, 7).computed ?? engine.getCell(0, 7).raw
      expect(formatCellValue(h1Val, styles['0,7']?.numberFormat)).toBe('Unit Price')

      // H2 raw value is preserved unmutated
      expect(engine.getCell(1, 7).raw).toBe('$1,200.00')
    })

    it('Case f04: "Unfreeze the header row"', () => {
      loadSampleSmall(engine)
      engine.setFrozenRows(1)
      const testCase = formatPrompts.cases.find((c) => c.id === 'f04')
      const result = applyFormatSheet(engine, {}, testCase.action)

      expect(result.success).toBe(true)
      expect(result.structuralChanges?.freezeRows).toBe(0)
    })

    it('Case f05: "Right-align every number column and set the body font size to 12"', () => {
      loadSampleSmall(engine)
      const testCase = formatPrompts.cases.find((c) => c.id === 'f05')
      const result = applyFormatSheet(engine, {}, testCase.action)

      expect(result.success).toBe(true)
      const styles = result.newStyles

      // G2 (col 6): right align and fontSize 12
      expect(styles['1,6']?.align).toBe('right')
      expect(styles['1,6']?.fontSize).toBe(12)

      // A2 (col 0): body font size 12
      expect(styles['1,0']?.fontSize).toBe(12)

      // A1 (header): is not body, so no fontSize 12
      expect(styles['0,0']?.fontSize).toBeUndefined()
    })

    it('Case f06: "Remove all formatting"', () => {
      loadSampleSmall(engine)
      const initialStyles = {
        '0,0': { bold: true, bg: '#f0f0f0' },
        '1,7': { numberFormat: 'currency' },
      }
      const testCase = formatPrompts.cases.find((c) => c.id === 'f06')
      const result = applyFormatSheet(engine, initialStyles, testCase.action)

      expect(result.success).toBe(true)
      // Styles are cleared
      expect(result.newStyles['0,0']).toBeUndefined()
      expect(result.newStyles['1,7']).toBeUndefined()
    })

    it('Case f07: "Make column Z bold" (Out of used range -> NO_CHANGES)', () => {
      loadSampleSmall(engine)
      const testCase = formatPrompts.cases.find((c) => c.id === 'f07')
      const result = applyFormatSheet(engine, {}, testCase.action)

      expect(result.success).toBe(true)
      expect(result.code).toBe('NO_CHANGES')
    })

    it('Case f08: "Freeze the first 50 rows" (Exceeds row count -> OUT_OF_RANGE)', () => {
      loadSampleSmall(engine)
      const testCase = formatPrompts.cases.find((c) => c.id === 'f08')
      const result = applyFormatSheet(engine, {}, testCase.action)

      expect(result.success).toBe(false)
      expect(result.code).toBe('OUT_OF_RANGE')
    })

    it('Case f09: "Highlight the totals row in yellow"', () => {
      loadSampleSmall(engine)
      const testCase = formatPrompts.cases.find((c) => c.id === 'f09')
      const result = applyFormatSheet(engine, {}, testCase.action)

      expect(result.success).toBe(true)
      const styles = result.newStyles

      // A33 and J33 have bg '#ffff99'
      expect(styles['32,0']?.bg).toBe('#ffff99')
      expect(styles['32,9']?.bg).toBe('#ffff99')

      // A32 does not have yellow bg
      expect(styles['31,0']?.bg).toBeUndefined()
    })

    it('Case f10: "Bold the totals row" when last row is normal data (NO_CHANGES)', () => {
      loadSampleSmall(engine)
      // Delete row 33 (row index 32)
      for (let c = 0; c < 10; c++) {
        engine.setCell(32, c, '')
      }

      const testCase = formatPrompts.cases.find((c) => c.id === 'f10')
      const result = applyFormatSheet(engine, {}, testCase.action)

      expect(result.success).toBe(true)
      expect(result.code).toBe('NO_CHANGES')
    })
  })

  describe('Performance Budget: sales-large.tsv (~3,000 rows)', () => {
    it('identifies totals row at row 2,992 and applies formatting in under 300 ms', () => {
      loadSampleLarge(engine)
      const used = engine.getUsedRange()
      expect(used.maxRow).toBe(2991) // 0-indexed: row 2992 is index 2991
      expect(isTotalsRow(engine, used)).toBe(true)

      const f01Action = formatPrompts.cases.find((c) => c.id === 'f01').action

      const t0 = performance.now()
      const result = applyFormatSheet(engine, {}, f01Action)
      const duration = performance.now() - t0

      expect(result.success).toBe(true)
      expect(result.code).toBe('APPLIED')
      // Budget: Applying must take under 300 ms over ~3,000 rows
      expect(duration).toBeLessThan(300)

      // Verify row 2992 (index 2991) is styled as totals row
      expect(result.newStyles['2991,0']?.bold).toBe(true)
    })
  })
})
