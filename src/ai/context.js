// ─────────────────────────────────────────────────────────────
//  Sheet Context Builder (Challenge 4 Task 4.1)
//
//  Extracts a compact schema representation of the spreadsheet
//  data to send to the LLM.
//
//  CRITICAL RULE from AI_CONTRACT.md:
//  Send column headers, inferred type per column, up to five
//  sample rows, row count, and current selection.
//  NEVER the full data.
// ─────────────────────────────────────────────────────────────

import { columnLetterFromIndex } from '../engine/core.js'

export const TOTALS_ROW_REGEX = /^(grand\s+)?(total|totals|subtotal|sum)\b/i

/**
 * Infer data type of a column based on column name and non-empty sample values.
 * Inferred types: 'id', 'date', 'currency', 'percent', 'number', 'text'
 */
export function inferColumnType(name, sampleValues = []) {
  const normName = String(name || '').toLowerCase().trim()
  const cleanSamples = sampleValues
    .map((v) => String(v ?? '').trim())
    .filter((v) => v !== '' && v.toLowerCase() !== 'n/a')

  if (cleanSamples.length === 0) return 'text'

  // 1. Currency: contains $ or name suggests currency/price/cost/sales/total/revenue
  const currencyCount = cleanSamples.filter((v) => /\$\s*[\d,]+(\.\d+)?/.test(v)).length
  if (currencyCount / cleanSamples.length >= 0.5) {
    return 'currency'
  }

  // 2. Percent: contains % or name indicates discount/rate/percent
  const percentCount = cleanSamples.filter((v) => /^-?\d+(\.\d+)?%$/.test(v)).length
  if (percentCount / cleanSamples.length >= 0.5) {
    return 'percent'
  }

  // 3. Date: YYYY-MM-DD, M/D/YYYY, D MMM YYYY
  const dateRegex = /^\d{4}-\d{1,2}-\d{1,2}$|^\d{1,2}\/\d{1,2}\/\d{2,4}$|^\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}$/
  const dateCount = cleanSamples.filter((v) => dateRegex.test(v)).length
  if (dateCount / cleanSamples.length >= 0.5 || normName.includes('date')) {
    return 'date'
  }

  // 4. Identifier (ID): alphanumeric codes like ORD-1001, CUST-01, SKU-123
  const idRegex = /^[A-Z0-9]+[-_][A-Z0-9]+$/i
  const idCount = cleanSamples.filter((v) => idRegex.test(v)).length
  if (idCount / cleanSamples.length >= 0.5 || normName.endsWith(' id') || normName === 'id') {
    return 'id'
  }

  // 5. Numeric: plain digits with optional decimal/commas
  const numRegex = /^-?[\d,]+(\.\d+)?$/
  const numCount = cleanSamples.filter((v) => numRegex.test(v.replace(/,/g, ''))).length
  if (numCount / cleanSamples.length >= 0.7) {
    return 'number'
  }

  return 'text'
}

/**
 * Builds the compact sheet context object conforming to AI_CONTRACT.md
 *
 * @param {object} engine - Spreadsheet core engine
 * @param {object|null} selection - Optional { start: {r, c}, end: {r, c} }
 * @returns {object} Context JSON for the model
 */
export function buildSheetContext(engine, selection = null) {
  const used = engine.getUsedRange()
  if (used.maxRow < used.minRow || used.maxCol < used.minCol) {
    return {
      range: 'A1:A1',
      rowCount: 0,
      columns: [],
      sampleRows: [],
      selection: 'A1',
      hasTotalsRow: false,
    }
  }

  const startColLetter = columnLetterFromIndex(used.minCol)
  const endColLetter = columnLetterFromIndex(used.maxCol)
  const rangeStr = `${startColLetter}${used.minRow + 1}:${endColLetter}${used.maxRow + 1}`

  // Row 1 is the header row
  const headerRow = used.minRow
  const columns = []

  // Check whether the last used row is a totals row
  let hasTotalsRow = false
  if (used.maxRow > headerRow) {
    for (let c = used.minCol; c <= used.maxCol; c++) {
      const val = String(engine.getCell(used.maxRow, c).computed ?? engine.getCell(used.maxRow, c).raw ?? '').trim()
      if (val !== '') {
        if (TOTALS_ROW_REGEX.test(val)) {
          hasTotalsRow = true
        }
        break
      }
    }
  }

  const bodyStartRow = headerRow + 1
  const bodyEndRow = hasTotalsRow ? used.maxRow - 1 : used.maxRow
  const totalBodyRowCount = Math.max(0, bodyEndRow - bodyStartRow + 1)

  // Extract column definitions and collect up to 3 non-empty examples
  for (let c = used.minCol; c <= used.maxCol; c++) {
    const headerCell = engine.getCell(headerRow, c)
    const headerName = String(headerCell.raw || headerCell.computed || '').trim() || `${columnLetterFromIndex(c)}`

    const sampleValues = []
    const distinctSet = new Set()

    for (let r = bodyStartRow; r <= Math.min(bodyEndRow, bodyStartRow + 30); r++) {
      const cell = engine.getCell(r, c)
      const val = String(cell.computed !== null && cell.computed !== '' ? cell.computed : cell.raw || '').trim()
      if (val !== '' && !distinctSet.has(val)) {
        distinctSet.add(val)
        sampleValues.push(val)
        if (sampleValues.length >= 3) break
      }
    }

    const type = inferColumnType(headerName, sampleValues)
    columns.push({
      name: headerName,
      index: c - used.minCol,
      type,
      examples: sampleValues,
    })
  }

  // Extract at most 5 sample rows from the body (never the full sheet)
  const sampleRows = []
  const maxSampleRows = Math.min(5, totalBodyRowCount)
  for (let r = bodyStartRow; r < bodyStartRow + maxSampleRows; r++) {
    const rowData = []
    for (let c = used.minCol; c <= used.maxCol; c++) {
      const cell = engine.getCell(r, c)
      const val = cell.computed !== null && cell.computed !== '' ? cell.computed : cell.raw
      rowData.push(val ?? '')
    }
    sampleRows.push(rowData)
  }

  // Selection string (e.g. C2:C10 or A1)
  let selectionStr = 'A1'
  if (selection && selection.start) {
    const startL = columnLetterFromIndex(selection.start.c)
    const startR = selection.start.r + 1
    if (selection.end && (selection.start.r !== selection.end.r || selection.start.c !== selection.end.c)) {
      const endL = columnLetterFromIndex(selection.end.c)
      const endR = selection.end.r + 1
      selectionStr = `${startL}${startR}:${endL}${endR}`
    } else {
      selectionStr = `${startL}${startR}`
    }
  }

  return {
    range: rangeStr,
    rowCount: totalBodyRowCount,
    columns,
    sampleRows,
    selection: selectionStr,
    hasTotalsRow,
  }
}
