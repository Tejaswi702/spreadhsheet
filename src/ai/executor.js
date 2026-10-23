// ─────────────────────────────────────────────────────────────
//  Pure Query Executor Engine (Challenge 4 Task 4.2)
//
//  Conforms to AI_CONTRACT.md Section 3:
//  • Pure functions over sheet's computed values (no React).
//  • Blank rows skipped; totals row excluded by default.
//  • Text normalization: norm(v) = String(v).trim().toLowerCase()
//  • Number coercion: toNum(v) handling $, commas, %, N/A -> null
//  • Date parsing: accepts YYYY-M-D, M/D/YYYY, D Mon YYYY -> YYYY-MM-DD
//  • Filters with AND: eq, neq, gt, gte, lt, lte, contains, startsWith, endsWith, isEmpty, notEmpty
//  • Group-by with first-seen display labels; aggregates sum, avg, count, countDistinct, min, max
//  • Multi-key stable sort (numbers before text)
//  • Limit capped at MAX_RESULT_ROWS (500)
//  • Performance: < 50 ms over sales-large.tsv (~3,000 rows), < 500 ms on 100k rows
// ─────────────────────────────────────────────────────────────

import { TOTALS_ROW_REGEX } from './context.js'
import { MAX_RESULT_ROWS, FILTER_OPS, AGGREGATE_FNS } from './contract.js'

/**
 * Text normalization: String(v).trim().toLowerCase()
 */
export function norm(v) {
  if (v === null || v === undefined) return ''
  return String(v).trim().toLowerCase()
}

/**
 * Number coercion according to AI_CONTRACT.md §3.2:
 * Trim; note trailing %; strip $, commas, %, whitespace.
 * The remainder must match ^-?\d+(\.\d+)?$, otherwise null.
 * Trailing % divides by 100.
 */
export function toNum(v) {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return isNaN(v) ? null : v
  const s = String(v).trim()
  if (s === '' || s.toLowerCase() === 'n/a') return null

  const isPercent = s.endsWith('%')
  const cleaned = s.replace(/[$,\s]/g, '').replace(/%$/, '')
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null

  const num = parseFloat(cleaned)
  if (isNaN(num)) return null
  return isPercent ? num / 100 : num
}

const MONTH_MAP = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  january: '01', february: '02', march: '03', april: '04',
  june: '06', july: '07', august: '08', september: '09',
  october: '10', november: '11', december: '12',
}

/**
 * Date normalization according to AI_CONTRACT.md §3.2:
 * Accepts YYYY-M-D, M/D/YYYY, D Mon YYYY -> returns ISO string YYYY-MM-DD or null.
 */
export function parseToIsoDate(v) {
  if (v === null || v === undefined || typeof v === 'number') return null
  const s = String(v).trim()
  if (s === '') return null

  // 1. YYYY-M-D
  const m1 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m1) {
    return `${m1[1]}-${m1[2].padStart(2, '0')}-${m1[3].padStart(2, '0')}`
  }

  // 2. M/D/YYYY
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m2) {
    return `${m2[3]}-${m2[1].padStart(2, '0')}-${m2[2].padStart(2, '0')}`
  }

  // 3. D Mon YYYY
  const m3 = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/)
  if (m3) {
    const monthKey = m3[2].toLowerCase()
    const month = MONTH_MAP[monthKey] || MONTH_MAP[monthKey.slice(0, 3)]
    if (month) {
      return `${m3[3]}-${month}-${m3[1].padStart(2, '0')}`
    }
  }

  return null
}

/**
 * Evaluates a single filter condition according to AI_CONTRACT.md §3.3
 */
export function evaluateFilter(cellValue, op, filterValue) {
  const normC = norm(cellValue)
  const normV = norm(filterValue)

  switch (op) {
    case 'eq': {
      const numC = toNum(cellValue)
      const numV = toNum(filterValue)
      if (numC !== null && numV !== null) {
        return Math.abs(numC - numV) < 1e-9
      }
      return normC === normV
    }
    case 'neq': {
      const numC = toNum(cellValue)
      const numV = toNum(filterValue)
      if (numC !== null && numV !== null) {
        return Math.abs(numC - numV) >= 1e-9
      }
      return normC !== normV
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const dateV = parseToIsoDate(filterValue)
      if (dateV !== null) {
        const dateC = parseToIsoDate(cellValue)
        if (dateC === null) return false
        if (op === 'gt') return dateC > dateV
        if (op === 'gte') return dateC >= dateV
        if (op === 'lt') return dateC < dateV
        if (op === 'lte') return dateC <= dateV
      }
      const numC = toNum(cellValue)
      const numV = toNum(filterValue)
      if (numC === null || numV === null) return false
      if (op === 'gt') return numC > numV
      if (op === 'gte') return numC >= numV
      if (op === 'lt') return numC < numV
      if (op === 'lte') return numC <= numV
      return false
    }
    case 'contains':
      return normC.includes(normV)
    case 'startsWith':
      return normC.startsWith(normV)
    case 'endsWith':
      return normC.endsWith(normV)
    case 'isEmpty':
      return normC === ''
    case 'notEmpty':
      return normC !== ''
    default:
      return false
  }
}

/**
 * Rounds a number to two decimal places
 */
export function roundTo2(num) {
  if (num === null || num === undefined) return null
  return Number(Math.round(Number(num + 'e2')) + 'e-2')
}

/**
 * Pure Query Executor executing a validated plan over spreadsheet data.
 *
 * @param {object} engine - Spreadsheet engine
 * @param {object} plan - Query plan
 * @returns {object} { columns: string[], rows: any[][], rowCount: number, truncated: boolean }
 *                   or error object { error: string, detail?: string }
 */
export function executeQuery(engine, plan) {
  if (!plan || typeof plan !== 'object') {
    return { error: 'INVALID_RESPONSE', detail: 'INVALID_RESPONSE: Plan must be an object' }
  }

  if (plan.type !== 'query') {
    if (plan.type === 'mutation') {
      return { error: 'READ_ONLY', detail: 'READ_ONLY: Mutations not permitted' }
    }
    return { error: 'READ_ONLY', detail: `READ_ONLY: Action type ${plan.type} not permitted` }
  }

  const used = engine.getUsedRange()
  if (used.maxRow < used.minRow || used.maxCol < used.minCol) {
    return { columns: [], rows: [], rowCount: 0, truncated: false }
  }

  // 1. Column headers from row 1 (used.minRow)
  const headerMap = new Map() // lowercase -> { colIndex, originalName }
  const allHeaderNames = []
  for (let c = used.minCol; c <= used.maxCol; c++) {
    const cell = engine.getCell(used.minRow, c)
    const name = String(cell.computed ?? cell.raw ?? '').trim()
    if (name) {
      headerMap.set(name.toLowerCase(), { colIndex: c, originalName: name })
      allHeaderNames.push(name)
    }
  }

  // 2. Validate column references against known headers
  const checkColumn = (colName) => {
    if (!colName || typeof colName !== 'string') return false
    return headerMap.has(colName.trim().toLowerCase())
  }

  if (Array.isArray(plan.filters)) {
    for (const f of plan.filters) {
      if (!checkColumn(f.column)) {
        return { error: 'UNKNOWN_COLUMN', detail: `UNKNOWN_COLUMN:${f.column}` }
      }
      if (!FILTER_OPS.includes(f.op)) {
        return { error: 'UNKNOWN_OP', detail: `UNKNOWN_OP:${f.op}` }
      }
    }
  }

  if (Array.isArray(plan.groupBy)) {
    for (const col of plan.groupBy) {
      if (!checkColumn(col)) {
        return { error: 'UNKNOWN_COLUMN', detail: `UNKNOWN_COLUMN:${col}` }
      }
    }
  }

  const aggregateAliases = new Set()
  if (Array.isArray(plan.aggregates)) {
    for (const agg of plan.aggregates) {
      if (!checkColumn(agg.column)) {
        return { error: 'UNKNOWN_COLUMN', detail: `UNKNOWN_COLUMN:${agg.column}` }
      }
      if (!AGGREGATE_FNS.includes(agg.fn)) {
        return { error: 'UNKNOWN_FN', detail: `UNKNOWN_FN:${agg.fn}` }
      }
      const alias = agg.as || `${agg.fn}(${agg.column})`
      aggregateAliases.add(alias.trim().toLowerCase())
    }
  }

  if (Array.isArray(plan.columns)) {
    for (const col of plan.columns) {
      if (!checkColumn(col)) {
        return { error: 'UNKNOWN_COLUMN', detail: `UNKNOWN_COLUMN:${col}` }
      }
    }
  }

  // 3. Detect Totals Row & Determine Body Range
  let hasTotalsRow = false
  if (used.maxRow > used.minRow) {
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

  const bodyStartRow = used.minRow + 1
  const bodyEndRow = hasTotalsRow && plan.excludeTotalsRow !== false ? used.maxRow - 1 : used.maxRow

  // 4. Setup needed columns for single-pass extraction
  const filterSpecs = Array.isArray(plan.filters)
    ? plan.filters.map((f) => ({
      colIndex: headerMap.get(f.column.trim().toLowerCase()).colIndex,
      op: f.op,
      value: f.value,
    }))
    : []

  const hasAggregates = Array.isArray(plan.aggregates) && plan.aggregates.length > 0
  const groupBySpecs = Array.isArray(plan.groupBy)
    ? plan.groupBy.map((colName) => ({
      name: colName,
      colIndex: headerMap.get(colName.trim().toLowerCase()).colIndex,
    }))
    : []

  const aggregateSpecs = hasAggregates
    ? plan.aggregates.map((agg) => ({
      fn: agg.fn,
      colIndex: headerMap.get(agg.column.trim().toLowerCase()).colIndex,
      alias: agg.as || `${agg.fn}(${agg.column})`,
    }))
    : []

  let outputColumns = []
  if (hasAggregates) {
    outputColumns = [
      ...groupBySpecs.map((g) => g.name),
      ...aggregateSpecs.map((a) => a.alias),
    ]
  } else if (Array.isArray(plan.columns) && plan.columns.length > 0) {
    outputColumns = plan.columns
  } else {
    outputColumns = [...allHeaderNames]
  }

  const projectCols = !hasAggregates
    ? outputColumns.map((colName) => {
      const info = headerMap.get(colName.trim().toLowerCase())
      return info ? info.colIndex : -1
    })
    : []

  // Fast cell reader: returns raw text for non-formulas, computed for formulas
  const readCell = (r, colIdx) => {
    const cell = engine.getCell(r, colIdx)
    return cell.raw && cell.raw.startsWith('=')
      ? (cell.computed !== null && cell.computed !== '' ? cell.computed : cell.raw)
      : cell.raw
  }

  // 5. Pipelined Single-Pass Execution
  const groups = new Map() // groupKey -> { labels: [], aggStates: [] }
  if (hasAggregates && groupBySpecs.length === 0) {
    groups.set('', {
      labels: [],
      states: aggregateSpecs.map((agg) => {
        if (agg.fn === 'countDistinct') return new Set()
        if (agg.fn === 'count') return 0
        return { sum: 0, min: Infinity, max: -Infinity, count: 0 }
      }),
    })
  }

  const rowResults = []

  for (let r = bodyStartRow; r <= bodyEndRow; r++) {
    // 5a. Skip rows where all cells are empty (after trim) per AI_CONTRACT §3.1
    let isBlankRow = true
    for (let c = used.minCol; c <= used.maxCol; c++) {
      const v = readCell(r, c)
      if (v !== null && v !== undefined && String(v).trim() !== '') {
        isBlankRow = false
        break
      }
    }
    if (isBlankRow) continue

    // 5b. Check filters first (skip non-matching rows with minimal lookups)
    let passes = true
    for (let f = 0; f < filterSpecs.length; f++) {
      const spec = filterSpecs[f]
      const cellVal = readCell(r, spec.colIndex)
      if (!evaluateFilter(cellVal, spec.op, spec.value)) {
        passes = false
        break
      }
    }
    if (!passes) continue

    // 5b. Aggregate or project directly
    if (hasAggregates) {
      let groupKey = ''
      const labels = []
      if (groupBySpecs.length > 0) {
        const keyParts = []
        for (let g = 0; g < groupBySpecs.length; g++) {
          const val = readCell(r, groupBySpecs[g].colIndex)
          keyParts.push(norm(val))
          labels.push(String(val ?? '').trim())
        }
        groupKey = keyParts.join('\x1F')
      }

      let grp = groups.get(groupKey)
      if (!grp) {
        grp = {
          labels,
          states: aggregateSpecs.map((agg) => {
            if (agg.fn === 'countDistinct') return new Set()
            if (agg.fn === 'count') return 0
            return { sum: 0, min: Infinity, max: -Infinity, count: 0 }
          }),
        }
        groups.set(groupKey, grp)
      }

      // Update aggregate states in-place
      for (let a = 0; a < aggregateSpecs.length; a++) {
        const agg = aggregateSpecs[a]
        const val = readCell(r, agg.colIndex)
        const state = grp.states[a]

        if (agg.fn === 'count') {
          if (String(val ?? '').trim() !== '') {
            grp.states[a]++
          }
        } else if (agg.fn === 'countDistinct') {
          const n = norm(val)
          if (n !== '') {
            state.add(n)
          }
        } else {
          const num = toNum(val)
          if (num !== null) {
            state.sum += num
            state.count++
            if (num < state.min) state.min = num
            if (num > state.max) state.max = num
          }
        }
      }
    } else {
      const row = []
      for (let p = 0; p < projectCols.length; p++) {
        row.push(readCell(r, projectCols[p]))
      }
      rowResults.push(row)
    }
  }

  // 6. Finalize aggregated results
  let finalResultRows = []
  if (hasAggregates) {
    for (const [, grp] of groups) {
      const row = [...grp.labels]
      for (let a = 0; a < aggregateSpecs.length; a++) {
        const agg = aggregateSpecs[a]
        const state = grp.states[a]

        if (agg.fn === 'count') {
          row.push(state)
        } else if (agg.fn === 'countDistinct') {
          row.push(state.size)
        } else if (agg.fn === 'sum') {
          row.push(state.count === 0 ? null : roundTo2(state.sum))
        } else if (agg.fn === 'avg') {
          row.push(state.count === 0 ? null : roundTo2(state.sum / state.count))
        } else if (agg.fn === 'min') {
          row.push(state.count === 0 ? null : roundTo2(state.min))
        } else if (agg.fn === 'max') {
          row.push(state.count === 0 ? null : roundTo2(state.max))
        }
      }
      finalResultRows.push(row)
    }
  } else {
    finalResultRows = rowResults
  }

  // 7. Multi-key Stable Sort
  if (Array.isArray(plan.sort) && plan.sort.length > 0) {
    const colCriteria = []
    for (const s of plan.sort) {
      const idx = outputColumns.findIndex(
        (col) => col.trim().toLowerCase() === s.column.trim().toLowerCase(),
      )
      if (idx === -1) {
        return {
          error: 'UNKNOWN_SORT_COLUMN',
          detail: `UNKNOWN_SORT_COLUMN:${s.column}`,
        }
      }
      colCriteria.push({
        idx,
        dir: s.dir === 'desc' ? -1 : 1,
      })
    }


    finalResultRows.sort((a, b) => {
      for (const { idx, dir } of colCriteria) {
        const valA = a[idx]
        const valB = b[idx]

        const numA = toNum(valA)
        const numB = toNum(valB)

        if (numA !== null && numB !== null) {
          if (numA !== numB) return (numA - numB) * dir
        } else if (numA !== null) {
          return -1 * dir
        } else if (numB !== null) {
          return 1 * dir
        } else {
          const strA = norm(valA)
          const strB = norm(valB)
          const cmp = strA.localeCompare(strB)
          if (cmp !== 0) return cmp * dir
        }
      }
      return 0
    })
  }

  // 8. Limit and Truncation (Capped at MAX_RESULT_ROWS = 500)
  const limit = Math.min(MAX_RESULT_ROWS, plan.limit || MAX_RESULT_ROWS)
  const truncated = finalResultRows.length > limit
  const rows = truncated ? finalResultRows.slice(0, limit) : finalResultRows

  return {
    columns: outputColumns,
    rows,
    rowCount: rows.length,
    truncated,
  }
}
