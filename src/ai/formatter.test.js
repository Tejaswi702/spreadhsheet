import { describe, it, expect } from 'vitest'
import {
  formatCellValue,
  formatNumberWithCommas,
  formatPercentage,
} from './formatter.js'

describe('Challenge 5 - Task 5.1: Number Formatter & Display Utilities', () => {
  describe('AI_CONTRACT.md §4 Display Rules Table', () => {
    // Contract table test matrix:
    // format     | 79      | $1,200.00  | 0.1     | 10%     | n/a     | 2024-01-15 / 1/15/2024 / 15 Jan 2024
    // number     | 79.00   | 1,200.00   | 0.10    | 0.10    | n/a     | unchanged
    // currency   | $79.00  | $1,200.00  | $0.10   | $0.10   | n/a     | unchanged
    // percent    | 7900%   | 120000%    | 10%     | 10%     | n/a     | unchanged
    // date       | unch.   | unch.      | unch.   | unch.   | n/a     | 2024-01-15

    it('formats "number" column correctly per contract matrix', () => {
      expect(formatCellValue('79', 'number')).toBe('79.00')
      expect(formatCellValue(79, 'number')).toBe('79.00')
      expect(formatCellValue('$1,200.00', 'number')).toBe('1,200.00')
      expect(formatCellValue('0.1', 'number')).toBe('0.10')
      expect(formatCellValue('10%', 'number')).toBe('0.10')
      expect(formatCellValue('n/a', 'number')).toBe('n/a')
      expect(formatCellValue('2024-01-15', 'number')).toBe('2024-01-15')
      expect(formatCellValue('1/15/2024', 'number')).toBe('1/15/2024')
    })

    it('formats "currency" column correctly per contract matrix', () => {
      expect(formatCellValue('79', 'currency')).toBe('$79.00')
      expect(formatCellValue(79, 'currency')).toBe('$79.00')
      expect(formatCellValue('$1,200.00', 'currency')).toBe('$1,200.00')
      expect(formatCellValue('$ 49.99', 'currency')).toBe('$49.99')
      expect(formatCellValue('0.1', 'currency')).toBe('$0.10')
      expect(formatCellValue('10%', 'currency')).toBe('$0.10')
      expect(formatCellValue('n/a', 'currency')).toBe('n/a')
      expect(formatCellValue('2024-01-15', 'currency')).toBe('2024-01-15')
    })

    it('formats "percent" column correctly per contract matrix', () => {
      expect(formatCellValue('79', 'percent')).toBe('7900%')
      expect(formatCellValue('$1,200.00', 'percent')).toBe('120000%')
      expect(formatCellValue('0.1', 'percent')).toBe('10%')
      expect(formatCellValue('10%', 'percent')).toBe('10%')
      expect(formatCellValue('n/a', 'percent')).toBe('n/a')
      expect(formatCellValue('2024-01-15', 'percent')).toBe('2024-01-15')
    })

    it('formats "date" column correctly per contract matrix', () => {
      expect(formatCellValue('79', 'date')).toBe('79')
      expect(formatCellValue('$1,200.00', 'date')).toBe('$1,200.00')
      expect(formatCellValue('0.1', 'date')).toBe('0.1')
      expect(formatCellValue('10%', 'date')).toBe('10%')
      expect(formatCellValue('n/a', 'date')).toBe('n/a')
      expect(formatCellValue('2024-01-15', 'date')).toBe('2024-01-15')
      expect(formatCellValue('1/15/2024', 'date')).toBe('2024-01-15')
      expect(formatCellValue('15 Jan 2024', 'date')).toBe('2024-01-15')
    })
  })

  describe('Edge Cases and Blanks', () => {
    it('returns empty string for null, undefined, or empty values', () => {
      expect(formatCellValue(null, 'currency')).toBe('')
      expect(formatCellValue(undefined, 'number')).toBe('')
      expect(formatCellValue('', 'percent')).toBe('')
      expect(formatCellValue('   ', 'date')).toBe('')
    })

    it('returns raw string for "general" or unrecognized formats', () => {
      expect(formatCellValue('Hello World', 'general')).toBe('Hello World')
      expect(formatCellValue(1234, 'general')).toBe('1234')
      expect(formatCellValue('Sample', 'unknown_format')).toBe('Sample')
    })

    it('handles negative currency and numbers', () => {
      expect(formatCellValue(-1200.5, 'number')).toBe('-1,200.50')
      expect(formatCellValue('-1200.50', 'currency')).toBe('-$1,200.50')
    })
  })

  describe('Golden Cases from fixtures/ai-eval/format-prompts.json', () => {
    it('satisfies f01 and f03 golden formatting checks', () => {
      // H2 raw '$1,200.00' formatted as currency -> '$1,200.00'
      expect(formatCellValue('$1,200.00', 'currency')).toBe('$1,200.00')
      // H7 raw '79' formatted as currency -> '$79.00'
      expect(formatCellValue('79', 'currency')).toBe('$79.00')
      // H32 raw '$ 49.99' formatted as currency -> '$49.99'
      expect(formatCellValue('$ 49.99', 'currency')).toBe('$49.99')
      // J2 raw '4320' formatted as currency -> '$4,320.00'
      expect(formatCellValue(4320, 'currency')).toBe('$4,320.00')
      // J22 blank remains blank
      expect(formatCellValue('', 'currency')).toBe('')
      // I2 raw '10%' formatted as percent -> '10%'
      expect(formatCellValue('10%', 'percent')).toBe('10%')
      // I14 raw 'n/a' formatted as percent -> 'n/a'
      expect(formatCellValue('n/a', 'percent')).toBe('n/a')
    })

    it('tests formatNumberWithCommas and formatPercentage helpers directly', () => {
      expect(formatNumberWithCommas(1234567.89, 2)).toBe('1,234,567.89')
      expect(formatNumberWithCommas(-500, 2)).toBe('-500.00')
      expect(formatNumberWithCommas(null)).toBe('')
      expect(formatPercentage(0.25)).toBe('25%')
      expect(formatPercentage(0.125)).toBe('12.5%')
      expect(formatPercentage(null)).toBe('')
    })
  })
})
