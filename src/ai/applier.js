// ─────────────────────────────────────────────────────────────
//  Pure Sheet Format Applier (Challenge 5 Task 5.2)
//
//  Conforms to AI_CONTRACT.md §4:
//  • Pure functions over sheet data (no React, no DOM).
//  • Identifies used range & totals row.
//  • Strict load-bearing order of application:
//    1. clearFormatting (if true)
//    2. bodyStyle
//    3. columns[] styles
//    4. totalsStyle (only if last row is totals row)
//    5. headerStyle (applied last, wins over column alignment)
//  • Ignores column indices outside used range.
//  • Validates freezeRows (< usedRowCount), returns OUT_OF_RANGE on error.
//  • Detects NO_CHANGES when nothing changes.
// ─────────────────────────────────────────────────────────────

import { TOTALS_ROW_REGEX } from './context.js'
import { toNum } from './executor.js'

/**
 * Checks whether the last row looks like a totals row according to AI_CONTRACT.md §4.2:
 * 1. First filled cell matches TOTALS_ROW_REGEX (/^(grand\s+)?(total|totals|subtotal|sum)\b/i)
 * 2. OR it reads as a summary line: a non-numeric label first, then numbers,
 *    with at least one column left empty, and at least two filled cells, not all cells filled.
 */
export function isTotalsRow(engine, used) {
  if (!engine || !used || used.maxRow <= used.minRow) return false
  const r = used.maxRow
  const colCount = used.maxCol - used.minCol + 1
  if (colCount <= 0) return false

  let firstFilledVal = null
  let filledCount = 0
  let emptyCount = 0
  let hasNumberAfterFirst = false

  for (let c = used.minCol; c <= used.maxCol; c++) {
    const cell = engine.getCell(r, c)
    const raw = String(cell.computed ?? cell.raw ?? '').trim()
    if (raw === '') {
      emptyCount++
    } else {
      filledCount++
      if (firstFilledVal === null) {
        firstFilledVal = raw
      } else {
        if (toNum(raw) !== null) {
          hasNumberAfterFirst = true
        }
      }
    }
  }

  if (firstFilledVal === null) return false

  // Condition 1: regex match on first filled cell
  if (TOTALS_ROW_REGEX.test(firstFilledVal)) {
    return true
  }

  // Condition 2: summary line heuristic
  // non-numeric label first, then numbers, at least 1 empty column, at least 2 filled, not all cells filled
  const isFirstNonNumeric = toNum(firstFilledVal) === null
  if (
    isFirstNonNumeric &&
    hasNumberAfterFirst &&
    emptyCount >= 1 &&
    filledCount >= 2 &&
    filledCount < colCount
  ) {
    return true
  }

  return false
}

/**
 * Formats a plain-words summary preview of a format_sheet action.
 * E.g. "header: bold, #f0f0f0; 4 columns formatted; totals row: bold; freeze 1 row"
 */
export function describeFormatAction(action) {
  if (!action) return ''
  const parts = []

  if (action.clearFormatting) {
    parts.push('clear previous formatting')
  }

  if (action.headerStyle) {
    const hParts = []
    if (action.headerStyle.bold) hParts.push('bold')
    if (action.headerStyle.bg) hParts.push(`bg ${action.headerStyle.bg}`)
    if (action.headerStyle.align) hParts.push(action.headerStyle.align)
    if (action.headerStyle.color) hParts.push(`color ${action.headerStyle.color}`)
    parts.push(`header: ${hParts.join(', ') || 'styled'}`)
  }

  if (action.bodyStyle) {
    parts.push('body styling')
  }

  if (Array.isArray(action.columns) && action.columns.length > 0) {
    const colDescs = action.columns.map((col) => {
      const styles = []
      if (col.style?.numberFormat) styles.push(col.style.numberFormat)
      if (col.style?.align) styles.push(col.style.align)
      return `Col ${col.col}: ${styles.join(', ')}`
    })
    parts.push(`columns (${colDescs.join('; ')})`)
  }

  if (action.totalsStyle) {
    parts.push('totals row: styled')
  }

  if (action.freezeRows !== undefined && action.freezeRows !== null) {
    parts.push(action.freezeRows > 0 ? `freeze ${action.freezeRows} row(s)` : 'unfreeze rows')
  }

  if (Array.isArray(action.columnWidths) && action.columnWidths.length > 0) {
    parts.push(`${action.columnWidths.length} column width(s)`)
  }

  if (action.autoFitColumns) {
    parts.push('auto-fit columns')
  }

  return parts.join(' | ') || 'Format sheet'
}

/**
 * Pure format sheet applier.
 * Computes the new style map and structural changes without touching React state.
 *
 * @param {object} engine - Spreadsheet engine instance
 * @param {object} currentStyles - Current cell styles map { "row,col": { ... } }
 * @param {object} action - Validated format_sheet action
 * @returns {object} Application result
 */
export function applyFormatSheet(engine, currentStyles = {}, action = {}) {
  if (!engine) {
    return {
      success: false,
      code: 'INVALID_ENGINE',
      error: 'INVALID_ENGINE',
      detail: 'Engine is required',
    }
  }

  const used = engine.getUsedRange()
  if (used.maxRow < used.minRow || used.maxCol < used.minCol) {
    return {
      success: true,
      code: 'NO_CHANGES',
      detail: 'Sheet is empty, no formatting applied',
      newStyles: { ...currentStyles },
      styleDeltaCount: 0,
      structuralChanges: {},
      plainWordsSummary: describeFormatAction(action),
    }
  }

  const usedRowCount = used.maxRow - used.minRow + 1
  const headerRow = used.minRow
  const hasTotals = isTotalsRow(engine, used)
  const totalsRow = hasTotals ? used.maxRow : null

  // 1. Validate freezeRows rule (§4.5):
  // "A value that would freeze every used row (>= used row count) is refused with OUT_OF_RANGE
  // and nothing else in the action is applied."
  if (
    action.freezeRows !== undefined &&
    action.freezeRows !== null &&
    typeof action.freezeRows === 'number'
  ) {
    if (action.freezeRows < 0) {
      return {
        success: false,
        code: 'OUT_OF_RANGE',
        error: 'OUT_OF_RANGE',
        detail: 'freezeRows must be non-negative',
      }
    }
    if (action.freezeRows >= usedRowCount) {
      return {
        success: false,
        code: 'OUT_OF_RANGE',
        error: 'OUT_OF_RANGE',
        detail: `freezeRows (${action.freezeRows}) cannot freeze all used rows (${usedRowCount})`,
      }
    }
  }

  // Clone styles for mutation
  const newStyles = { ...currentStyles }
  let styleChangesCount = 0

  // 2. clearFormatting first (over the whole used range)
  if (action.clearFormatting) {
    for (let r = used.minRow; r <= used.maxRow; r++) {
      for (let c = used.minCol; c <= used.maxCol; c++) {
        const key = `${r},${c}`
        if (newStyles[key] && Object.keys(newStyles[key]).length > 0) {
          delete newStyles[key]
          styleChangesCount++
        }
      }
    }
  }

  // Helper to merge styles into a cell
  const applyStyleToCell = (r, c, styleObj, stripNumberFormatAndAlign = false) => {
    if (!styleObj || typeof styleObj !== 'object') return
    const key = `${r},${c}`
    const existing = newStyles[key] || {}
    const toApply = { ...styleObj }

    if (stripNumberFormatAndAlign) {
      delete toApply.numberFormat
      delete toApply.align
    }

    const merged = { ...existing, ...toApply }
    // Clean undefined/null entries
    Object.keys(merged).forEach((k) => {
      if (merged[k] === undefined || merged[k] === null) {
        delete merged[k]
      }
    })

    // Check if effectively changed
    if (JSON.stringify(existing) !== JSON.stringify(merged)) {
      newStyles[key] = merged
      styleChangesCount++
    }
  }

  // 3. bodyStyle (body rows, all used columns)
  // Body is row 2 to last used row
  if (action.bodyStyle && typeof action.bodyStyle === 'object') {
    const bodyStart = headerRow + 1
    const bodyEnd = used.maxRow
    for (let r = bodyStart; r <= bodyEnd; r++) {
      for (let c = used.minCol; c <= used.maxCol; c++) {
        applyStyleToCell(r, c, action.bodyStyle)
      }
    }
  }

  // 4. columns[] entry (body rows of that column)
  // "the header row is never number-formatted or realigned by a column entry"
  // "Column indices outside 0..colCount-1 are ignored; nothing is ever written outside used range"
  if (Array.isArray(action.columns)) {
    const bodyStart = headerRow + 1
    const bodyEnd = used.maxRow
    for (const colEntry of action.columns) {
      if (
        colEntry &&
        typeof colEntry.col === 'number' &&
        colEntry.col >= used.minCol &&
        colEntry.col <= used.maxCol &&
        colEntry.style
      ) {
        for (let r = bodyStart; r <= bodyEnd; r++) {
          applyStyleToCell(r, colEntry.col, colEntry.style)
        }
      }
    }
  }

  // 5. totalsStyle (only if the last row looks like a totals row)
  if (totalsRow !== null && action.totalsStyle && typeof action.totalsStyle === 'object') {
    for (let c = used.minCol; c <= used.maxCol; c++) {
      applyStyleToCell(totalsRow, c, action.totalsStyle)
    }
  }

  // 6. headerStyle applied LAST so it wins over column alignment
  if (action.headerStyle && typeof action.headerStyle === 'object') {
    for (let c = used.minCol; c <= used.maxCol; c++) {
      applyStyleToCell(headerRow, c, action.headerStyle)
    }
  }

  // 7. Structural changes (freezeRows, columnWidths, autoFitColumns)
  const structuralChanges = {}
  let structuralChangesCount = 0

  // freezeRows
  if (action.freezeRows !== undefined && action.freezeRows !== null) {
    const currentFrozen = typeof engine.getFrozenRows === 'function' ? engine.getFrozenRows() : 0
    if (action.freezeRows !== currentFrozen) {
      structuralChanges.freezeRows = action.freezeRows
      structuralChanges.prevFreezeRows = currentFrozen
      structuralChangesCount++
    }
  }

  // columnWidths (widths outside 30..600 are ignored)
  if (Array.isArray(action.columnWidths)) {
    const validWidths = []
    for (const wEntry of action.columnWidths) {
      if (
        wEntry &&
        typeof wEntry.col === 'number' &&
        wEntry.col >= used.minCol &&
        wEntry.col <= used.maxCol &&
        typeof wEntry.width === 'number' &&
        wEntry.width >= 30 &&
        wEntry.width <= 600
      ) {
        const curW = typeof engine.getColWidth === 'function' ? engine.getColWidth(wEntry.col) : 100
        if (curW !== wEntry.width) {
          validWidths.push({
            col: wEntry.col,
            width: wEntry.width,
            prevWidth: curW,
          })
          structuralChangesCount++
        }
      }
    }
    if (validWidths.length > 0) {
      structuralChanges.columnWidths = validWidths
    }
  }

  // autoFitColumns
  if (action.autoFitColumns === true) {
    structuralChanges.autoFitColumns = true
    structuralChangesCount++
  }

  // 8. NO_CHANGES detection (§4.7)
  if (styleChangesCount === 0 && structuralChangesCount === 0) {
    return {
      success: true,
      code: 'NO_CHANGES',
      detail: 'No formatting or structural changes were produced',
      newStyles: { ...currentStyles },
      prevStyles: { ...currentStyles },
      styleDeltaCount: 0,
      structuralChanges: {},
      plainWordsSummary: describeFormatAction(action),
    }
  }

  return {
    success: true,
    code: 'APPLIED',
    newStyles,
    prevStyles: { ...currentStyles },
    styleDeltaCount: styleChangesCount,
    structuralChanges,
    plainWordsSummary: describeFormatAction(action),
  }
}
