// ─────────────────────────────────────────────────────────────
//  Number & Display Formatter Utilities (Challenge 5 Task 5.1)
//
//  Conforms to AI_CONTRACT.md §4:
//  • Display rules for `numberFormat` (stored raw value never changes).
//  • Supported formats: general, number, currency, percent, date.
//  • Non-numeric / non-date strings left alone (e.g. 'n/a' -> 'n/a').
//  • Blanks remain blank ('').
// ─────────────────────────────────────────────────────────────

import { toNum, parseToIsoDate } from './executor.js'

/**
 * Formats a number with thousands separators and fixed decimal places.
 * E.g. 79 -> '79.00', 1200 -> '1,200.00', 0.1 -> '0.10'
 */
export function formatNumberWithCommas(num, decimals = 2) {
  if (num === null || num === undefined || isNaN(num)) return ''
  const isNegative = num < 0
  const absNum = Math.abs(num)
  const fixed = absNum.toFixed(decimals)
  const parts = fixed.split('.')
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const formatted = parts.join('.')
  return isNegative ? `-${formatted}` : formatted
}

/**
 * Formats a percentage value.
 * In AI_CONTRACT.md:
 * - 0.1 -> '10%'
 * - '10%' -> '10%'
 * - 79 -> '7900%'
 * - '$1,200.00' -> '120000%'
 */
export function formatPercentage(num) {
  if (num === null || num === undefined || isNaN(num)) return ''
  const multiplied = num * 100
  // Handle float precision issues like 0.1 * 100 = 10.000000000000002
  const rounded = Number(multiplied.toFixed(6))
  // If whole number, format without decimal, otherwise up to 2 decimal places
  if (Number.isInteger(rounded)) {
    return `${rounded}%`
  }
  const str = rounded.toFixed(2).replace(/\.?0+$/, '')
  return `${str}%`
}

/**
 * Formats a cell value based on its numberFormat style.
 *
 * @param {any} value - Cell raw or computed value
 * @param {'general' | 'number' | 'currency' | 'percent' | 'date'} [format='general'] - Format type
 * @returns {string} Formatted display string
 */
export function formatCellValue(value, format = 'general') {
  if (value === null || value === undefined) return ''
  const strVal = String(value).trim()
  if (strVal === '') return ''

  if (!format || format === 'general') {
    return String(value)
  }

  switch (format) {
    case 'number': {
      // If it cannot be parsed as number, leave unchanged (e.g. 'n/a', dates)
      const num = toNum(value)
      if (num === null) return String(value)
      return formatNumberWithCommas(num, 2)
    }

    case 'currency': {
      // If it cannot be parsed as number, leave unchanged
      const num = toNum(value)
      if (num === null) return String(value)
      const isNegative = num < 0
      const absFormatted = formatNumberWithCommas(Math.abs(num), 2)
      return isNegative ? `-$${absFormatted}` : `$${absFormatted}`
    }

    case 'percent': {
      // If it cannot be parsed as number, leave unchanged
      const num = toNum(value)
      if (num === null) return String(value)
      return formatPercentage(num)
    }

    case 'date': {
      // Only format strings that parse as valid dates (YYYY-M-D, M/D/YYYY, D Mon YYYY)
      // Numbers, currency, and invalid strings remain unchanged per AI_CONTRACT.md
      const isoDate = parseToIsoDate(value)
      if (isoDate) return isoDate
      return String(value)
    }

    default:
      return String(value)
  }
}
