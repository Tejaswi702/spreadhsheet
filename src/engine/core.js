// ─────────────────────────────────────────────────────────────
//  Operator precedence for expression parsing
// ─────────────────────────────────────────────────────────────
import { SizeIndex } from "./virtualization.js";
export { SizeIndex } from "./virtualization.js";

const OPERATOR_PRECEDENCE = { "+": 1, "-": 1, "*": 2, "/": 2 };
const MAX_UNDO_HISTORY = 100;

// ─────────────────────────────────────────────────────────────
//  Column / Cell coordinate utilities
// ─────────────────────────────────────────────────────────────

export function columnLetterToIndex(columnLetter) {
  let index = 0;
  for (let i = 0; i < columnLetter.length; i++) {
    index = index * 26 + (columnLetter.charCodeAt(i) - 64);
  }
  return index - 1;
}

export function columnLetterFromIndex(col) {
  let columnLabel = "";
  let colNumber = col + 1;
  while (colNumber > 0) {
    colNumber--;
    columnLabel = String.fromCharCode(65 + (colNumber % 26)) + columnLabel;
    colNumber = Math.floor(colNumber / 26);
  }
  return columnLabel;
}

function indexToCellKey(row, col) {
  return columnLetterFromIndex(col) + (row + 1);
}

export function parseCellKey(cellKey) {
  const match = cellKey.match(/^(\$?)([A-Z]+)(\$?)(\d+)$/);
  if (!match) return null;
  return {
    row: parseInt(match[4], 10) - 1,
    col: columnLetterToIndex(match[2]),
    absCol: match[1] === "$",
    absRow: match[3] === "$",
  };
}

// ─────────────────────────────────────────────────────────────
//  Dependency graph (tracks which cells depend on which)
// ─────────────────────────────────────────────────────────────

function createDependencyGraph() {
  const forwardEdges = new Map();
  const reverseEdges = new Map();

  function addDependency(cell, dependsOn) {
    if (!forwardEdges.has(cell)) forwardEdges.set(cell, new Set());
    if (!reverseEdges.has(dependsOn)) reverseEdges.set(dependsOn, new Set());
    forwardEdges.get(cell).add(dependsOn);
    reverseEdges.get(dependsOn).add(cell);
  }

  function removeAllDependencies(cell) {
    const deps = forwardEdges.get(cell);
    if (deps) {
      for (const dep of deps) {
        if (reverseEdges.has(dep)) {
          reverseEdges.get(dep).delete(cell);
          if (reverseEdges.get(dep).size === 0) reverseEdges.delete(dep);
        }
      }
      forwardEdges.delete(cell);
    }
    const dependents = reverseEdges.get(cell);
    if (dependents) {
      for (const dependent of dependents) {
        if (forwardEdges.has(dependent)) {
          forwardEdges.get(dependent).delete(cell);
          if (forwardEdges.get(dependent).size === 0)
            forwardEdges.delete(dependent);
        }
      }
      reverseEdges.delete(cell);
    }
  }

  function getDependencies(cell) {
    return forwardEdges.get(cell) || new Set();
  }

  function getDependents(cell) {
    return reverseEdges.get(cell) || new Set();
  }

  function getAllDependentsRecursive(cell, visited = new Set()) {
    if (visited.has(cell)) return new Set();
    visited.add(cell);
    const result = new Set();
    for (const dependent of getDependents(cell)) {
      result.add(dependent);
      for (const indirect of getAllDependentsRecursive(dependent, visited)) {
        result.add(indirect);
      }
    }
    return result;
  }

  function hasCycle(startCell) {
    const startDeps = forwardEdges.get(startCell);
    if (!startDeps || startDeps.size === 0) return false;

    let anyDepHasDeps = false;
    for (const dep of startDeps) {
      const d = forwardEdges.get(dep);
      if (d && d.size > 0) {
        anyDepHasDeps = true;
        break;
      }
    }
    if (!anyDepHasDeps) return false;

    const visited = new Set();
    const recursionStack = new Set();
    const dfs = (node) => {
      if (recursionStack.has(node)) return true;
      if (visited.has(node)) return false;
      visited.add(node);
      recursionStack.add(node);
      for (const dep of getDependencies(node)) {
        if (dfs(dep)) return true;
      }
      recursionStack.delete(node);
      return false;
    };
    return dfs(startCell);
  }

  function topologicalSort(affectedCells) {
    const inDegree = new Map();
    const queue = [];
    const sorted = [];

    for (const cell of affectedCells) inDegree.set(cell, 0);
    for (const cell of affectedCells) {
      for (const dep of getDependencies(cell)) {
        if (affectedCells.has(dep)) {
          inDegree.set(cell, (inDegree.get(cell) || 0) + 1);
        }
      }
    }
    for (const cell of affectedCells) {
      if (inDegree.get(cell) === 0) queue.push(cell);
    }
    let qHead = 0;
    while (qHead < queue.length) {
      const cell = queue[qHead++];
      sorted.push(cell);
      for (const dependent of getDependents(cell)) {
        if (affectedCells.has(dependent)) {
          inDegree.set(dependent, inDegree.get(dependent) - 1);
          if (inDegree.get(dependent) === 0) queue.push(dependent);
        }
      }
    }
    return sorted;
  }

  function clear() {
    forwardEdges.clear();
    reverseEdges.clear();
  }

  return {
    addDependency,
    removeAllDependencies,
    getDependencies,
    getDependents,
    getAllDependentsRecursive,
    hasCycle,
    topologicalSort,
    clear,
  };
}

// ─────────────────────────────────────────────────────────────
//  Tokenizer — converts formula string into tokens
// ─────────────────────────────────────────────────────────────

function tokenize(expression) {
  const tokens = [];
  let position = 0;

  while (position < expression.length) {
    const char = expression[position];

    if (char === " ") {
      position++;
      continue;
    }

    if (char === "(" || char === ")") {
      tokens.push({ type: "paren", value: char });
      position++;
      continue;
    }

    if ("+-*/,".includes(char)) {
      tokens.push({ type: "operator", value: char });
      position++;
      continue;
    }

    if (char === ":") {
      tokens.push({ type: "range", value: ":" });
      position++;
      continue;
    }

    if ((char >= "0" && char <= "9") || char === ".") {
      let numberStr = "";
      while (
        position < expression.length &&
        ((expression[position] >= "0" && expression[position] <= "9") ||
          expression[position] === ".")
      ) {
        numberStr += expression[position];
        position++;
      }
      tokens.push({ type: "number", value: parseFloat(numberStr) });
      continue;
    }

    if (
      char === "$" ||
      (char >= "A" && char <= "Z") ||
      (char >= "a" && char <= "z")
    ) {
      let identifier = "";
      while (
        position < expression.length &&
        (expression[position] === "$" ||
          (expression[position] >= "A" && expression[position] <= "Z") ||
          (expression[position] >= "a" && expression[position] <= "z") ||
          (expression[position] >= "0" && expression[position] <= "9"))
      ) {
        identifier += expression[position].toUpperCase();
        position++;
      }
      if (position < expression.length && expression[position] === ":") {
        tokens.push({ type: "cell", value: identifier });
      } else {
        const cellMatch = identifier.match(/^(\$?)([A-Z]+)(\$?)(\d+)$/);
        if (cellMatch) {
          tokens.push({ type: "cell", value: identifier });
        } else {
          tokens.push({ type: "function", value: identifier });
        }
      }
      continue;
    }

    throw new Error(`Unexpected character: ${char}`);
  }

  return tokens;
}

// ─────────────────────────────────────────────────────────────
//  Parser — converts tokens into an AST using shunting-yard
// ─────────────────────────────────────────────────────────────

function parseTokensToAST(tokens) {
  const outputQueue = [];
  const operatorStack = [];
  let position = 0;

  while (position < tokens.length) {
    const token = tokens[position];

    if (token.type === "number" || token.type === "cell") {
      outputQueue.push(token);
      position++;
    } else if (token.type === "function") {
      operatorStack.push(token);
      position++;
    } else if (token.type === "operator") {
      while (
        operatorStack.length > 0 &&
        operatorStack[operatorStack.length - 1].type === "operator" &&
        OPERATOR_PRECEDENCE[operatorStack[operatorStack.length - 1].value] >=
          OPERATOR_PRECEDENCE[token.value]
      ) {
        outputQueue.push(operatorStack.pop());
      }
      operatorStack.push(token);
      position++;
    } else if (token.type === "paren" && token.value === "(") {
      operatorStack.push(token);
      position++;
    } else if (token.type === "paren" && token.value === ")") {
      while (
        operatorStack.length > 0 &&
        operatorStack[operatorStack.length - 1].value !== "("
      ) {
        outputQueue.push(operatorStack.pop());
      }
      if (
        operatorStack.length > 0 &&
        operatorStack[operatorStack.length - 1].value === "("
      ) {
        operatorStack.pop();
      }
      if (
        operatorStack.length > 0 &&
        operatorStack[operatorStack.length - 1].type === "function"
      ) {
        const funcToken = operatorStack.pop();
        if (
          outputQueue.length > 0 &&
          outputQueue[outputQueue.length - 1].type === "range"
        ) {
          const rangeToken = outputQueue.pop();
          outputQueue.push({
            type: "function",
            name: funcToken.value,
            range: rangeToken,
          });
        } else {
          outputQueue.push(funcToken);
        }
      }
      position++;
    } else if (token.type === "range") {
      const startCell = outputQueue.pop();
      const endCell = tokens[position + 1];

      if (
        !startCell ||
        startCell.type !== "cell" ||
        !endCell ||
        endCell.type !== "cell"
      ) {
        throw new Error("Invalid range syntax");
      }

      outputQueue.push({
        type: "range",
        start: startCell.value,
        end: endCell.value,
      });

      // Consume both the colon and the ending cell token.
      position += 2;
    } else {
      position++;
    }
  }

  while (operatorStack.length > 0) {
    if (operatorStack[operatorStack.length - 1].value === "(") {
      throw new Error("Mismatched parentheses");
    }
    outputQueue.push(operatorStack.pop());
  }

  return buildASTFromRPN(outputQueue);
}

function buildASTFromRPN(rpnTokens) {
  const stack = [];

  for (const token of rpnTokens) {
    if (
      token.type === "number" ||
      token.type === "cell" ||
      token.type === "range"
    ) {
      stack.push(token);
    } else if (token.type === "operator") {
      if (stack.length < 2) throw new Error("Invalid expression");
      const right = stack.pop();
      const left = stack.pop();
      stack.push({ type: "binary", operator: token.value, left, right });
    } else if (token.type === "function") {
      if (token.range) {
        stack.push(token);
      } else {
        if (stack.length === 0)
          throw new Error(`Function ${token.value} requires arguments`);
        const argument = stack.pop();
        if (argument.type === "range") {
          stack.push({ type: "function", name: token.value, range: argument });
        } else {
          throw new Error(`Function ${token.value} requires a range`);
        }
      }
    }
  }

  if (stack.length !== 1) throw new Error("Invalid expression");
  return stack[0];
}

// ─────────────────────────────────────────────────────────────
//  Evaluator — walks the AST and computes values
// ─────────────────────────────────────────────────────────────

function expandCellRange(startKey, endKey) {
  const startMatch = startKey.match(/^(\$?)([A-Z]+)(\$?)(\d+)$/);
  const endMatch = endKey.match(/^(\$?)([A-Z]+)(\$?)(\d+)$/);
  if (!startMatch || !endMatch) throw new Error("REF");

  const startCol = columnLetterToIndex(startMatch[2]);
  const startRow = parseInt(startMatch[4]) - 1;
  const endCol = columnLetterToIndex(endMatch[2]);
  const endRow = parseInt(endMatch[4]) - 1;

  const cells = [];
  for (
    let r = Math.min(startRow, endRow);
    r <= Math.max(startRow, endRow);
    r++
  ) {
    for (
      let c = Math.min(startCol, endCol);
      c <= Math.max(startCol, endCol);
      c++
    ) {
      cells.push(indexToCellKey(r, c));
    }
  }
  return cells;
}

function evaluateAST(ast, getCellValue, visited = new Set()) {
  if (!ast) return 0;

  if (ast.type === "number") return ast.value;

  if (ast.type === "cell") {
    const key = ast.value.replace(/\$/g, "");
    if (visited.has(key)) throw new Error("CIRCULAR");
    visited.add(key);
    const value = getCellValue(key, visited);
    visited.delete(key);
    return value;
  }

  if (ast.type === "range") throw new Error("VALUE");

  if (ast.type === "binary") {
    let leftVal = evaluateAST(ast.left, getCellValue, visited);
    let rightVal = evaluateAST(ast.right, getCellValue, visited);
    if (typeof leftVal !== "number") {
      const coerced = toNumericValue(leftVal);
      if (coerced !== null) leftVal = coerced;
    }
    if (typeof rightVal !== "number") {
      const coerced = toNumericValue(rightVal);
      if (coerced !== null) rightVal = coerced;
    }
    if (typeof leftVal !== "number" || typeof rightVal !== "number")
      throw new Error("VALUE");
    switch (ast.operator) {
      case "+":
        return leftVal + rightVal;
      case "-":
        return leftVal - rightVal;
      case "*":
        return leftVal * rightVal;
      case "/":
        if (rightVal === 0) throw new Error("VALUE");
        return leftVal / rightVal;
      default:
        throw new Error("VALUE");
    }
  }

  if (ast.type === "function") {
    const rangeCells = expandCellRange(ast.range.start, ast.range.end);
    const values = rangeCells.map((cellKey) => {
      if (visited.has(cellKey)) throw new Error("CIRCULAR");
      visited.add(cellKey);
      const value = getCellValue(cellKey, visited);
      visited.delete(cellKey);
      const num = toNumericValue(value);
      return num !== null ? num : 0;
    });

    switch (ast.name) {
      case "SUM":
        return values.reduce((sum, val) => sum + val, 0);
      case "AVG":
        return values.length === 0
          ? 0
          : values.reduce((sum, val) => sum + val, 0) / values.length;
      case "MIN":
        return values.length === 0 ? 0 : Math.min(...values);
      case "MAX":
        return values.length === 0 ? 0 : Math.max(...values);
      default:
        throw new Error("VALUE");
    }
  }

  throw new Error("VALUE");
}

function evaluateFormula(expression, getCellValue) {
  try {
    if (!expression || expression.trim() === "")
      return { value: "", error: null };
    if (!expression.startsWith("=")) return { value: expression, error: null };

    const formulaBody = expression.slice(1).trim();
    if (formulaBody === "") return { value: "", error: null };

    const tokens = tokenize(formulaBody);
    const ast = parseTokensToAST(tokens);
    const result = evaluateAST(ast, getCellValue);
    return { value: result, error: null };
  } catch (error) {
    if (error.message === "CIRCULAR") return { value: null, error: "#CYCLE!" };
    if (error.message === "REF") return { value: null, error: "#REF!" };
    if (error.message === "VALUE") return { value: null, error: "#VALUE!" };
    return { value: null, error: "#PARSE!" };
  }
}

// ─────────────────────────────────────────────────────────────
//  Reference shifting (for insert/delete row/col)
// ─────────────────────────────────────────────────────────────

export function shiftFormulaReferences(formula, rowDelta, colDelta) {
  if (!formula || !formula.startsWith("=")) return formula;

  return formula.replace(
    /(\$?)([A-Z]+)(\$?)(\d+)/g,
    (match, colDollar, colLetter, rowDollar, rowStr) => {
      const colIdx = columnLetterToIndex(colLetter);
      const rowIdx = parseInt(rowStr) - 1;

      // Pinned coordinates do not shift with fill handle deltas
      const newCol = colDollar === "$" ? colIdx : colIdx + colDelta;
      const newRow = rowDollar === "$" ? rowIdx : rowIdx + rowDelta;

      if (newRow < 0 || newCol < 0) return match;
      return (
        (colDollar || "") +
        columnLetterFromIndex(newCol) +
        (rowDollar || "") +
        (newRow + 1)
      );
    },
  );
}

function shiftCellReferences(
  formula,
  rowShift,
  colShift,
  atIndex,
  isColumnOperation = false,
) {
  if (!formula || !formula.startsWith("=")) return formula;

  // Shift cell references in formulas when rows/columns are inserted or deleted
  // Note: This function modifies ALL cell references in the formula, including those
  // in ranges. The logic ensures references shift correctly based on the operation type.
  return formula.replace(
    /(\$?)([A-Z]+)(\$?)(\d+)/g,
    (match, colDollar, colLetter, rowDollar, rowStr) => {
      const colIdx = columnLetterToIndex(colLetter);
      const rowIdx = parseInt(rowStr) - 1;
      let newRow = rowIdx;
      let newCol = colIdx;

      if (isColumnOperation) {
        // For column operations, only shift columns at or after the insertion/deletion point
        if (colIdx >= atIndex) newCol = colIdx + colShift;
      } else {
        // For row operations, only shift rows at or after the insertion/deletion point
        if (rowIdx >= atIndex) newRow = rowIdx + rowShift;
      }

      // Preserve original reference if shifting would result in invalid coordinates
      // This prevents formulas from breaking when rows/cols are deleted at boundaries
      if (newRow < 0 || newCol < 0) return match;
      return (
        (colDollar || "") +
        columnLetterFromIndex(newCol) +
        (rowDollar || "") +
        (newRow + 1)
      );
    },
  );
}

function extractCellReferences(formula) {
  const references = new Set();
  const regex = /(\$?)([A-Z]+)(\$?)(\d+)/g;
  let match;
  while ((match = regex.exec(formula)) !== null) {
    references.add(match[2] + match[4]);
  }
  return references;
}

// ─────────────────────────────────────────────────────────────
//  Series Extrapolation (Fill Handle logic)
// ─────────────────────────────────────────────────────────────

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_FULL = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const MONTHS_FULL = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const MONTH_NAMES_MAP = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

function parseSeriesDate(str) {
  const trimmed = str.trim();
  // 1. YYYY-MM-DD
  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10) - 1;
    const day = parseInt(isoMatch[3], 10);
    const dt = new Date(Date.UTC(year, month, day));
    if (
      !isNaN(dt.getTime()) &&
      dt.getUTCMonth() === month &&
      dt.getUTCDate() === day
    ) {
      return {
        utcMs: dt.getTime(),
        format: {
          type: 'iso',
          padMonth: isoMatch[2].length === 2,
          padDay: isoMatch[3].length === 2,
        },
      };
    }
  }

  // 2. M/D/YYYY
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const month = parseInt(slashMatch[1], 10) - 1;
    const day = parseInt(slashMatch[2], 10);
    const year = parseInt(slashMatch[3], 10);
    const dt = new Date(Date.UTC(year, month, day));
    if (
      !isNaN(dt.getTime()) &&
      dt.getUTCMonth() === month &&
      dt.getUTCDate() === day
    ) {
      return {
        utcMs: dt.getTime(),
        format: {
          type: 'slash',
          padMonth: slashMatch[1].length === 2,
          padDay: slashMatch[2].length === 2,
        },
      };
    }
  }

  // 3. D MMM YYYY
  const namedMatch = trimmed.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (namedMatch) {
    const day = parseInt(namedMatch[1], 10);
    const mName = namedMatch[2].toLowerCase();
    const month = MONTH_NAMES_MAP[mName];
    const year = parseInt(namedMatch[3], 10);
    if (month !== undefined) {
      const dt = new Date(Date.UTC(year, month, day));
      if (
        !isNaN(dt.getTime()) &&
        dt.getUTCMonth() === month &&
        dt.getUTCDate() === day
      ) {
        return {
          utcMs: dt.getTime(),
          format: {
            type: 'named',
            padDay: namedMatch[1].length === 2,
          },
        };
      }
    }
  }

  return null;
}

function formatSeriesDate(utcMs, format) {
  const dt = new Date(utcMs);
  const year = dt.getUTCFullYear();
  const month = dt.getUTCMonth();
  const day = dt.getUTCDate();

  if (format.type === 'iso') {
    const mStr = String(month + 1).padStart(format.padMonth ? 2 : 1, '0');
    const dStr = String(day).padStart(format.padDay ? 2 : 1, '0');
    return `${year}-${mStr}-${dStr}`;
  }
  if (format.type === 'slash') {
    const mStr = format.padMonth
      ? String(month + 1).padStart(2, '0')
      : String(month + 1);
    const dStr = format.padDay ? String(day).padStart(2, '0') : String(day);
    return `${mStr}/${dStr}/${year}`;
  }
  if (format.type === 'named') {
    const dStr = format.padDay ? String(day).padStart(2, '0') : String(day);
    const mStr = MONTHS_SHORT[month];
    return `${dStr} ${mStr} ${year}`;
  }
  return dt.toISOString().slice(0, 10);
}

function getWeekdayMatch(str) {
  const lower = str.trim().toLowerCase();
  let idx = WEEKDAYS_SHORT.findIndex((w) => w.toLowerCase() === lower);
  if (idx !== -1) return { index: idx, isShort: true };
  idx = WEEKDAYS_FULL.findIndex((w) => w.toLowerCase() === lower);
  if (idx !== -1) return { index: idx, isShort: false };
  if (lower === 'tues') return { index: 2, isShort: true };
  if (lower === 'thurs') return { index: 4, isShort: true };
  return null;
}

function getMonthMatch(str) {
  const lower = str.trim().toLowerCase();
  let idx = MONTHS_SHORT.findIndex((m) => m.toLowerCase() === lower);
  if (idx !== -1) return { index: idx, isShort: true };
  idx = MONTHS_FULL.findIndex((m) => m.toLowerCase() === lower);
  if (idx !== -1) return { index: idx, isShort: false };
  if (lower === 'sept') return { index: 8, isShort: true };
  return null;
}

function getCaseStyle(str) {
  const trimmed = str.trim();
  if (trimmed === trimmed.toUpperCase()) return 'upper';
  if (trimmed === trimmed.toLowerCase()) return 'lower';
  return 'title';
}

function formatWithCase(name, caseStyle) {
  if (caseStyle === 'upper') return name.toUpperCase();
  if (caseStyle === 'lower') return name.toLowerCase();
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

function isPureNumber(str) {
  const trimmed = str.trim();
  if (trimmed === '') return false;
  return !isNaN(Number(trimmed));
}

function getDecimalPlaces(str) {
  const parts = str.trim().split('.');
  return parts.length === 2 ? parts[1].length : 0;
}

export function extrapolateSeries(seeds, count, options = {}) {
  if (!count || count <= 0) return [];
  if (!seeds || seeds.length === 0) return Array(count).fill('');

  const seedStrs = seeds.map((s) => String(s ?? ''));
  if (seedStrs.every((s) => s.trim() === '')) {
    return Array(count).fill('');
  }

  const direction = options.direction || 'down';
  const isReverse = direction === 'up' || direction === 'left';
  const S = seedStrs.length;

  // 1. Formulas: shift relative cell references preserving absolute pinned references ($)
  if (seedStrs.every((s) => s.startsWith('='))) {
    let stepRow = options.stepRow;
    let stepCol = options.stepCol;
    if (stepRow === undefined || stepCol === undefined) {
      if (direction === 'down') {
        stepRow = 1;
        stepCol = 0;
      } else if (direction === 'up') {
        stepRow = -1;
        stepCol = 0;
      } else if (direction === 'right') {
        stepRow = 0;
        stepCol = 1;
      } else if (direction === 'left') {
        stepRow = 0;
        stepCol = -1;
      } else {
        stepRow = 1;
        stepCol = 0;
      }
    }

    const result = [];
    for (let i = 0; i < count; i++) {
      const seedIdx = isReverse
        ? ((S - 1 - (i % S)) % S + S) % S
        : i % S;
      const multiplier = isReverse
        ? -(Math.floor(i / S) + 1)
        : Math.floor(i / S) + 1;
      const deltaRow = S * multiplier * stepRow;
      const deltaCol = S * multiplier * stepCol;
      result.push(shiftFormulaReferences(seedStrs[seedIdx], deltaRow, deltaCol));
    }
    return result;
  }

  // 2. Dates: YYYY-MM-DD, M/D/YYYY, D MMM YYYY stepped by seed day delta preserving formats
  const parsedDates = seedStrs.map(parseSeriesDate);
  if (parsedDates.every((p) => p !== null)) {
    let deltaDays = 1;
    if (S >= 2) {
      const diffMs = parsedDates[S - 1].utcMs - parsedDates[0].utcMs;
      const avgDays = Math.round(diffMs / (86400000 * (S - 1)));
      deltaDays = avgDays === 0 ? 1 : avgDays;
    }

    const result = [];
    for (let i = 0; i < count; i++) {
      const stepNum = i + 1;
      const targetUtcMs = isReverse
        ? parsedDates[0].utcMs - stepNum * deltaDays * 86400000
        : parsedDates[S - 1].utcMs + stepNum * deltaDays * 86400000;
      const fmt = isReverse
        ? parsedDates[(S - 1 - (i % S)) % S].format
        : parsedDates[i % S].format;
      result.push(formatSeriesDate(targetUtcMs, fmt));
    }
    return result;
  }

  // 3. Weekdays: Sun..Sat cycling with case preservation
  const weekdayMatches = seedStrs.map(getWeekdayMatch);
  if (weekdayMatches.every((m) => m !== null)) {
    let step = 1;
    if (S >= 2) {
      const diff = weekdayMatches[S - 1].index - weekdayMatches[0].index;
      const calcStep = diff / (S - 1);
      if (Number.isInteger(calcStep) && calcStep !== 0) {
        step = calcStep;
      } else {
        step = ((weekdayMatches[1].index - weekdayMatches[0].index) % 7 + 7) % 7 || 1;
      }
    }

    const result = [];
    for (let i = 0; i < count; i++) {
      const stepNum = i + 1;
      const baseIdx = isReverse
        ? weekdayMatches[0].index - stepNum * step
        : weekdayMatches[S - 1].index + stepNum * step;
      const nextIdx = ((baseIdx % 7) + 7) % 7;
      const seedRef = isReverse
        ? seedStrs[(S - 1 - (i % S)) % S]
        : seedStrs[i % S];
      const matchRef = isReverse
        ? weekdayMatches[(S - 1 - (i % S)) % S]
        : weekdayMatches[i % S];
      const list = matchRef.isShort ? WEEKDAYS_SHORT : WEEKDAYS_FULL;
      result.push(formatWithCase(list[nextIdx], getCaseStyle(seedRef)));
    }
    return result;
  }

  // 4. Months: Jan..Dec cycling with case preservation
  const monthMatches = seedStrs.map(getMonthMatch);
  if (monthMatches.every((m) => m !== null)) {
    let step = 1;
    if (S >= 2) {
      const diff = monthMatches[S - 1].index - monthMatches[0].index;
      const calcStep = diff / (S - 1);
      if (Number.isInteger(calcStep) && calcStep !== 0) {
        step = calcStep;
      } else {
        step = ((monthMatches[1].index - monthMatches[0].index) % 12 + 12) % 12 || 1;
      }
    }

    const result = [];
    for (let i = 0; i < count; i++) {
      const stepNum = i + 1;
      const baseIdx = isReverse
        ? monthMatches[0].index - stepNum * step
        : monthMatches[S - 1].index + stepNum * step;
      const nextIdx = ((baseIdx % 12) + 12) % 12;
      const seedRef = isReverse
        ? seedStrs[(S - 1 - (i % S)) % S]
        : seedStrs[i % S];
      const matchRef = isReverse
        ? monthMatches[(S - 1 - (i % S)) % S]
        : monthMatches[i % S];
      const list = matchRef.isShort ? MONTHS_SHORT : MONTHS_FULL;
      result.push(formatWithCase(list[nextIdx], getCaseStyle(seedRef)));
    }
    return result;
  }

  // 5. Pure Numbers: one seed -> copy; 2+ seeds -> arithmetic progression
  const allPureNumbers = seedStrs.every(isPureNumber);
  if (allPureNumbers) {
    const isPadded =
      seedStrs[0].trim().length > 1 &&
      seedStrs[0].trim().startsWith('0') &&
      !seedStrs[0].trim().includes('.');

    if (S === 1 && !isPadded) {
      return Array(count).fill(seedStrs[0]);
    }

    if (S >= 2) {
      const nums = seedStrs.map((s) => Number(s.trim()));
      const delta = (nums[S - 1] - nums[0]) / (S - 1);
      const maxDecimals = Math.max(...seedStrs.map(getDecimalPlaces));
      const deltaDecimals = getDecimalPlaces(String(delta));
      const decimals = Math.max(maxDecimals, deltaDecimals);

      const result = [];
      for (let i = 0; i < count; i++) {
        const stepNum = i + 1;
        const val = isReverse
          ? nums[0] - stepNum * delta
          : nums[S - 1] + stepNum * delta;

        if (decimals > 0) {
          result.push(val.toFixed(decimals));
        } else if (isPadded) {
          const padLen = seedStrs[S - 1].trim().length;
          const rounded = Math.round(val);
          result.push(
            rounded >= 0
              ? String(rounded).padStart(padLen, '0')
              : '-' + String(Math.abs(rounded)).padStart(padLen, '0')
          );
        } else {
          result.push(String(Number(val.toPrecision(12))));
        }
      }
      return result;
    }
  }

  // 6. Text Ending in a Number (Item 1, Q4, 2024-W01, ORD-1001)
  const alphaMatches = seedStrs.map((s) => s.match(/^(.*?)(\d+)$/));
  if (alphaMatches.every((m) => m !== null)) {
    const commonPrefix = alphaMatches[0][1];
    const samePrefix = alphaMatches.every((m) => m[1] === commonPrefix);
    if (samePrefix) {
      let delta = 1;
      const firstNum = parseInt(alphaMatches[0][2], 10);
      const lastNum = parseInt(alphaMatches[S - 1][2], 10);

      if (S >= 2) {
        delta = Math.round((lastNum - firstNum) / (S - 1)) || 1;
      }

      const padLen = isReverse
        ? alphaMatches[0][2].length
        : alphaMatches[S - 1][2].length;

      const result = [];
      for (let i = 0; i < count; i++) {
        const stepNum = i + 1;
        const val = isReverse
          ? firstNum - stepNum * delta
          : lastNum + stepNum * delta;
        const formattedNum =
          val >= 0
            ? String(val).padStart(padLen, '0')
            : '-' + String(Math.abs(val)).padStart(padLen, '0');
        result.push(`${commonPrefix}${formattedNum}`);
      }
      return result;
    }
  }

  // 7. Plain Copy / Cyclic Fallback
  const result = [];
  for (let i = 0; i < count; i++) {
    const idx = isReverse
      ? ((S - 1 - (i % S)) % S + S) % S
      : i % S;
    result.push(seedStrs[idx]);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
//  Multi-Type Value Comparator (Challenge 2)
// ─────────────────────────────────────────────────────────────

export function isBlankValue(val) {
  if (val === null || val === undefined) return true;
  return String(val).trim() === '';
}

export function toNumericValue(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') {
    return isNaN(val) ? null : val;
  }
  const s = String(val).trim();
  if (s === '') return null;

  const isPercent = s.endsWith('%');
  // Strip currency symbols, commas, and whitespace
  const cleaned = s.replace(/[$,\s]/g, '').replace(/%$/, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
    return null;
  }
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  return isPercent ? num / 100 : num;
}

export function toDateValue(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return null;
  const s = String(val).trim();
  if (s === '') return null;

  const parsed = parseSeriesDate(s);
  if (parsed && typeof parsed.utcMs === 'number' && !isNaN(parsed.utcMs)) {
    return parsed.utcMs;
  }
  return null;
}

function extractComparableValue(cellOrVal) {
  if (cellOrVal !== null && typeof cellOrVal === 'object') {
    if (cellOrVal.computed !== undefined && cellOrVal.computed !== null && cellOrVal.computed !== '') {
      return cellOrVal.computed;
    }
    if (cellOrVal.raw !== undefined) {
      return cellOrVal.raw;
    }
  }
  return cellOrVal;
}

/**
 * Pure multi-type comparator according to Challenge 2 specification:
 * - blanks last (regardless of sort direction)
 * - numbers before text
 * - dates as dates (chronological)
 * - text case-insensitive
 * - stable
 *
 * @param {*} a - First value or cell object
 * @param {*} b - Second value or cell object
 * @param {'asc'|'desc'} [direction='asc'] - Sort direction
 * @returns {number} - Negative if a < b, positive if a > b, 0 if equal
 */
export function compareCells(a, b, direction = 'asc') {
  const valA = extractComparableValue(a);
  const valB = extractComparableValue(b);

  const isBlankA = isBlankValue(valA);
  const isBlankB = isBlankValue(valB);

  // 1. Blanks last: always placed at the bottom in both asc and desc
  if (isBlankA && isBlankB) return 0;
  if (isBlankA) return 1;
  if (isBlankB) return -1;

  const numA = toNumericValue(valA);
  const numB = toNumericValue(valB);
  const isNumA = numA !== null;
  const isNumB = numB !== null;

  const dateA = !isNumA ? toDateValue(valA) : null;
  const dateB = !isNumB ? toDateValue(valB) : null;
  const isDateA = dateA !== null;
  const isDateB = dateB !== null;

  // Determine type rank:
  // 1: Number (including currency and percent)
  // 2: Date
  // 3: Text
  const typeRankA = isNumA ? 1 : isDateA ? 2 : 3;
  const typeRankB = isNumB ? 1 : isDateB ? 2 : 3;

  const dirMultiplier = direction === 'desc' ? -1 : 1;

  // 2. Different types: numbers before dates before text
  if (typeRankA !== typeRankB) {
    return typeRankA - typeRankB;
  }

  // 3. Both are numbers: numeric compare
  if (isNumA && isNumB) {
    if (numA === numB) return 0;
    return (numA > numB ? 1 : -1) * dirMultiplier;
  }

  // 4. Both are dates: chronological compare
  if (isDateA && isDateB) {
    if (dateA === dateB) return 0;
    return (dateA > dateB ? 1 : -1) * dirMultiplier;
  }

  // 5. Both are text: case-insensitive string compare
  const strA = String(valA).trim();
  const strB = String(valB).trim();
  const lowerA = strA.toLowerCase();
  const lowerB = strB.toLowerCase();

  const cmp = lowerA.localeCompare(lowerB);
  if (cmp !== 0) {
    return cmp * dirMultiplier;
  }

  return 0;
}

// ─────────────────────────────────────────────────────────────
//  Main engine factory
// ─────────────────────────────────────────────────────────────

export function createEngine(initialRows = 50, initialCols = 50, options = {}) {
  let rows = initialRows;
  let cols = initialCols;
  const cells = new Map();
  const graph = createDependencyGraph();
  const dirtyCells = new Set();
  const computedCache = new Map();
  const undoStack = [];
  const redoStack = [];

  // Virtualization size indexing (Challenge 3)
  const DEFAULT_ROW_HEIGHT = options.defaultRowHeight || 24;
  const DEFAULT_COL_WIDTH = options.defaultColWidth || 100;
  const rowSizes = new SizeIndex(
    initialRows,
    DEFAULT_ROW_HEIGHT,
    options.customRowHeights || {},
  );
  const colSizes = new SizeIndex(
    initialCols,
    DEFAULT_COL_WIDTH,
    options.customColWidths || {},
  );

  // Freeze state tracking (Challenge 3 & Challenge 5)
  let frozenRows = Math.max(0, options.frozenRows || 0);
  let frozenCols = Math.max(0, options.frozenCols || 0);

  // Stable row identity tracking
  let rowIdentities = Array.from({ length: initialRows }, (_, i) => i);
  let nextRowId = initialRows;

  // Sort state tracking
  let _currentSort = { col: null, direction: null };
  let _blockOriginalOrder = null;

  // Internal generation counter — incremented on every structural mutation.
  // Used by the cache to validate entries and by the engine to track state integrity.
  let _generation = 0;
  let _batchMode = false;
  let _batchCallbacks = [];

  // ── Internal helpers ──

  function cellKey(row, col) {
    return indexToCellKey(row, col);
  }

  function cellCoords(key) {
    return parseCellKey(key);
  }

  function isValidCellKey(key) {
    const coords = cellCoords(key);
    return (
      coords &&
      coords.row >= 0 &&
      coords.row < rows &&
      coords.col >= 0 &&
      coords.col < cols
    );
  }

  function updateDependencies(cell, rawFormula) {
    const references = extractCellReferences(rawFormula);
    const rangeRegex = /(\$?[A-Z]+\$?\d+):(\$?[A-Z]+\$?\d+)/g;
    let match;

    while ((match = rangeRegex.exec(rawFormula)) !== null) {
      for (const rangeCell of expandCellRange(match[1], match[2])) {
        references.add(rangeCell);
      }
    }

    for (const ref of references) {
      if (isValidCellKey(ref)) {
        graph.addDependency(cell, ref);
      }
    }
  }

  function markCellDirty(cell) {
    dirtyCells.add(cell);
    for (const dependent of graph.getAllDependentsRecursive(cell)) {
      dirtyCells.add(dependent);
    }
  }

  function markAllCellsDirty() {
    for (const [key, value] of cells.entries()) {
      if (value.raw && value.raw.startsWith("=")) {
        dirtyCells.add(key);
      }
    }
  }

  // ── Value resolution ──

  function resolveCellValue(cellKey, visited = new Set()) {
    if (visited.has(cellKey)) return "#CYCLE!";
    visited.add(cellKey);

    if (computedCache.has(cellKey)) {
      const cached = computedCache.get(cellKey);
      // Validate cache generation — stale entries from a previous generation are discarded
      // Note: _generation is incremented on structural changes, but cache validation
      // must account for cells that may have been invalidated by dependency changes
      if (cached._gen === _generation && !dirtyCells.has(cellKey)) {
        visited.delete(cellKey);
        return cached.error || cached.computed;
      }
      computedCache.delete(cellKey);
    }

    const cell = cells.get(cellKey);
    if (!cell || !cell.raw) {
      visited.delete(cellKey);
      return "";
    }

    if (!cell.raw.startsWith("=")) {
      const s = cell.raw.trim();
      const isPureNumber = /^-?\d+(\.\d+)?$/.test(s);
      visited.delete(cellKey);
      return isPureNumber ? parseFloat(s) : cell.raw;
    }

    const result = evaluateFormula(cell.raw, (key) =>
      resolveCellValue(key, visited),
    );
    visited.delete(cellKey);

    if (result.error) {
      computedCache.set(cellKey, {
        computed: null,
        error: result.error,
        _gen: _generation,
      });
      return result.error;
    }

    computedCache.set(cellKey, {
      computed: result.value,
      error: null,
      _gen: _generation,
    });
    return result.value;
  }

  // ── Recalculation ──

  function recalculate() {
    if (dirtyCells.size === 0) return;

    const affected = new Set(dirtyCells);
    const sorted = graph.topologicalSort(affected);
    const sortedSet = new Set(sorted);

    // Process sorted cells first (topological order ensures dependencies are resolved)
    for (const cell of sorted) {
      if (dirtyCells.has(cell)) {
        computedCache.delete(cell);
        resolveCellValue(cell);
      }
    }
    // Process any remaining affected cells that weren't in the sorted list
    // (e.g., cells with no dependencies or circular dependencies)
    for (const cell of affected) {
      if (!sortedSet.has(cell)) {
        computedCache.delete(cell);
        const cellData = cells.get(cell);
        if (cellData && cellData.raw && cellData.raw.startsWith("=")) {
          resolveCellValue(cell);
        }
      }
    }

    dirtyCells.clear();

    // Notify batch listeners if in batch mode
    // WARNING: Batch mode is currently unused but may be needed for future features
    if (_batchMode) {
      _batchCallbacks.forEach((cb) => cb());
    }
  }

  // ── Core cell operations ──

  function setCellRaw(row, col, raw) {
    const key = cellKey(row, col);
    graph.removeAllDependencies(key);
    computedCache.delete(key);

    if (!raw || raw.trim() === "") {
      cells.delete(key);
      markCellDirty(key);
      return;
    }

    if (raw.startsWith("=")) {
      cells.set(key, { raw, computed: null, error: null });
      updateDependencies(key, raw);
      if (graph.hasCycle(key)) {
        graph.removeAllDependencies(key);
        cells.set(key, { raw, computed: null, error: "#CYCLE!" });
        markCellDirty(key);
        return;
      }
    } else {
      cells.set(key, { raw, computed: null, error: null });
    }

    markCellDirty(key);
  }

  function getCellRaw(row, col) {
    const key = cellKey(row, col);
    const cell = cells.get(key);
    if (!cell) return { raw: "", computed: null, error: null };
    return { ...cell };
  }

  // ── Snapshot / Restore (for undo of structural changes) ──

  function takeSnapshot() {
    // Create a deep copy of all cell data for undo/redo operations
    // Note: This only captures cell data, not the dependency graph or cache
    // The dependency graph is rebuilt from the cell formulas when restoring
    const snapshot = new Map();
    for (const [key, value] of cells.entries()) {
      // Create a shallow copy of the cell object
      // The cell object contains: { raw: string, computed: number|null, error: string|null }
      // Note: computed and error are not persisted in snapshots - they're recalculated on restore
      snapshot.set(key, { ...value });
    }
    snapshot._rows = rows;
    snapshot._cols = cols;
    snapshot._rowIdentities = [...rowIdentities];
    snapshot._nextRowId = nextRowId;
    snapshot._currentSort = { ..._currentSort };
    snapshot._blockOriginalOrder = _blockOriginalOrder
      ? [..._blockOriginalOrder]
      : null;
    snapshot._rowSizes = rowSizes.getCustomSizes();
    snapshot._colSizes = colSizes.getCustomSizes();
    snapshot._frozenRows = frozenRows;
    snapshot._frozenCols = frozenCols;
    return snapshot;
  }

  function restoreSnapshot(snapshot) {
    cells.clear();
    for (const [key, value] of snapshot.entries()) {
      cells.set(key, { ...value });
    }
    if (snapshot._rows !== undefined) {
      rows = snapshot._rows;
      rowSizes.setCount(rows);
    }
    if (snapshot._cols !== undefined) {
      cols = snapshot._cols;
      colSizes.setCount(cols);
    }
    if (snapshot._frozenRows !== undefined) {
      frozenRows = snapshot._frozenRows;
    }
    if (snapshot._frozenCols !== undefined) {
      frozenCols = snapshot._frozenCols;
    }
    if (snapshot._rowIdentities) {
      rowIdentities = [...snapshot._rowIdentities];
    }
    if (snapshot._nextRowId !== undefined) {
      nextRowId = snapshot._nextRowId;
    }
    if (snapshot._currentSort) {
      _currentSort = { ...snapshot._currentSort };
    }
    if (snapshot._blockOriginalOrder !== undefined) {
      _blockOriginalOrder = snapshot._blockOriginalOrder
        ? [...snapshot._blockOriginalOrder]
        : null;
    }
    if (snapshot._rowSizes) {
      rowSizes.setCustomSizes(snapshot._rowSizes);
    }
    if (snapshot._colSizes) {
      colSizes.setCustomSizes(snapshot._colSizes);
    }
    graph.clear();
    computedCache.clear();
    dirtyCells.clear();
    _generation++;
    // Rebuild dependency graph from restored cells
    // Important: This must happen before marking cells dirty to ensure correct dependency tracking
    for (const [key, value] of cells.entries()) {
      if (value.raw && value.raw.startsWith("="))
        updateDependencies(key, value.raw);
    }
    markAllCellsDirty();
  }

  // ── Row / Column structural operations ──

  function performInsertRow(atIndex) {
    const snapshot = takeSnapshot();
    cells.clear();
    graph.clear();
    computedCache.clear();
    dirtyCells.clear();
    _generation++;

    for (const [key, value] of snapshot.entries()) {
      const coords = cellCoords(key);
      if (!coords) continue;
      if (coords.row >= atIndex) {
        const newKey = cellKey(coords.row + 1, coords.col);
        cells.set(newKey, {
          ...value,
          raw: shiftCellReferences(value.raw, 1, 0, atIndex),
        });
      } else {
        cells.set(key, {
          ...value,
          raw: shiftCellReferences(value.raw, 1, 0, atIndex),
        });
      }
    }
    rows++;
    rowIdentities.splice(atIndex, 0, nextRowId++);
    rowSizes.insertItem(atIndex);
    if (atIndex < frozenRows) frozenRows++;
    for (const [key, value] of cells.entries()) {
      if (value.raw.startsWith("=")) updateDependencies(key, value.raw);
    }
    markAllCellsDirty();
  }

  function performDeleteRow(atIndex) {
    const snapshot = takeSnapshot();
    cells.clear();
    graph.clear();
    computedCache.clear();
    dirtyCells.clear();
    _generation++;

    for (const [key, value] of snapshot.entries()) {
      const coords = cellCoords(key);
      if (!coords) continue;
      if (coords.row === atIndex) continue;
      if (coords.row > atIndex) {
        const newKey = cellKey(coords.row - 1, coords.col);
        cells.set(newKey, {
          ...value,
          raw: shiftCellReferences(value.raw, -1, 0, atIndex),
        });
      } else {
        cells.set(key, {
          ...value,
          raw: shiftCellReferences(value.raw, -1, 0, atIndex),
        });
      }
    }
    rows--;
    rowIdentities.splice(atIndex, 1);
    rowSizes.deleteItem(atIndex);
    if (atIndex < frozenRows) frozenRows = Math.max(0, frozenRows - 1);
    for (const [key, value] of cells.entries()) {
      if (value.raw.startsWith("=")) updateDependencies(key, value.raw);
    }
    markAllCellsDirty();
  }

  function performInsertColumn(atIndex) {
    const snapshot = takeSnapshot();
    cells.clear();
    graph.clear();
    computedCache.clear();
    dirtyCells.clear();
    _generation++;

    for (const [key, value] of snapshot.entries()) {
      const coords = cellCoords(key);
      if (!coords) continue;
      if (coords.col >= atIndex) {
        const newKey = cellKey(coords.row, coords.col + 1);
        cells.set(newKey, {
          ...value,
          raw: shiftCellReferences(value.raw, 0, 1, atIndex, true),
        });
      } else {
        cells.set(key, {
          ...value,
          raw: shiftCellReferences(value.raw, 0, 1, atIndex, true),
        });
      }
    }
    cols++;
    colSizes.insertItem(atIndex);
    if (atIndex < frozenCols) frozenCols++;
    for (const [key, value] of cells.entries()) {
      if (value.raw.startsWith("=")) updateDependencies(key, value.raw);
    }
    markAllCellsDirty();
  }

  function performDeleteColumn(atIndex) {
    const snapshot = takeSnapshot();
    cells.clear();
    graph.clear();
    computedCache.clear();
    dirtyCells.clear();
    _generation++;

    for (const [key, value] of snapshot.entries()) {
      const coords = cellCoords(key);
      if (!coords) continue;
      if (coords.col === atIndex) continue;
      if (coords.col > atIndex) {
        const newKey = cellKey(coords.row, coords.col - 1);
        cells.set(newKey, {
          ...value,
          raw: shiftCellReferences(value.raw, 0, -1, atIndex, true),
        });
      } else {
        cells.set(key, {
          ...value,
          raw: shiftCellReferences(value.raw, 0, -1, atIndex, true),
        });
      }
    }
    cols--;
    colSizes.deleteItem(atIndex);
    if (atIndex < frozenCols) frozenCols = Math.max(0, frozenCols - 1);
    for (const [key, value] of cells.entries()) {
      if (value.raw.startsWith("=")) updateDependencies(key, value.raw);
    }
    markAllCellsDirty();
  }

  // ── Undo / Redo ──

  function pushToUndoStack(entry) {
    undoStack.push({ ...entry, _gen: _generation });
    if (undoStack.length > MAX_UNDO_HISTORY) undoStack.shift();
    redoStack.length = 0;
  }
  function executeSetCell(row, col, value) {
    const previousValue = getCellRaw(row, col).raw;
    const nextValue = String(value ?? "");

    if (previousValue !== nextValue) {
      pushToUndoStack({
        type: "set",
        r: row,
        c: col,
        oldVal: previousValue,
        newVal: nextValue,
      });
    }

    _generation++;

    setCellRaw(row, col, nextValue);
    recalculate();
  }

  function executeSetCells(changes) {
    const batchChanges = [];

    for (const change of changes) {
      const { row, col, value } = change;
      const previousValue = getCellRaw(row, col).raw;
      const nextValue = String(value ?? "");

      if (previousValue !== nextValue) {
        batchChanges.push({
          row,
          col,
          oldVal: previousValue,
          newVal: nextValue,
        });
      }
    }

    if (batchChanges.length === 0) return;

    pushToUndoStack({
      type: "batch",
      changes: batchChanges,
    });

    _generation++;

    for (const change of batchChanges) {
      setCellRaw(change.row, change.col, change.newVal);
    }

    recalculate();
  }
  function executeInsertRow(atIndex) {
    const snapshot = takeSnapshot();
    const previousRows = rows;
    pushToUndoStack({ type: "rowins", snap: snapshot, oldRows: previousRows });
    performInsertRow(atIndex);
    recalculate();
  }

  function executeDeleteRow(atIndex) {
    const snapshot = takeSnapshot();
    const previousRows = rows;
    pushToUndoStack({ type: "rowdel", snap: snapshot, oldRows: previousRows });
    performDeleteRow(atIndex);
    recalculate();
  }

  function executeInsertColumn(atIndex) {
    const snapshot = takeSnapshot();
    const previousCols = cols;
    pushToUndoStack({ type: "colins", snap: snapshot, oldCols: previousCols });
    performInsertColumn(atIndex);
    recalculate();
  }

  function executeDeleteColumn(atIndex) {
    const snapshot = takeSnapshot();
    const previousCols = cols;
    pushToUndoStack({ type: "coldel", snap: snapshot, oldCols: previousCols });
    performDeleteColumn(atIndex);
    recalculate();
  }

  function executeSetColWidth(col, width, oldWidthOverride) {
    const oldWidth =
      oldWidthOverride !== undefined
        ? oldWidthOverride
        : colSizes.getSize(col);
    if (oldWidth === width) return;
    pushToUndoStack({
      type: "colresize",
      col,
      oldWidth,
      newWidth: width,
    });
    colSizes.setSize(col, width);
    _generation++;
  }

  function executeSetRowHeight(row, height, oldHeightOverride) {
    const oldHeight =
      oldHeightOverride !== undefined
        ? oldHeightOverride
        : rowSizes.getSize(row);
    if (oldHeight === height) return;
    pushToUndoStack({
      type: "rowresize",
      row,
      oldHeight,
      newHeight: height,
    });
    rowSizes.setSize(row, height);
    _generation++;
  }

  function autoFitColumn(colIndex, options = {}) {
    const minWidth = options.minWidth || 50;
    const maxWidth = options.maxWidth || 600;
    const padding = options.padding !== undefined ? options.padding : 30;
    const colLetter = columnLetterFromIndex(colIndex);
    let maxLen = colLetter.length;

    for (const [key, cell] of cells.entries()) {
      const coords = cellCoords(key);
      if (coords && coords.col === colIndex) {
        const text =
          cell.error ||
          (cell.computed !== null && cell.computed !== ""
            ? String(cell.computed)
            : cell.raw) ||
          "";
        if (text.length > maxLen) {
          maxLen = text.length;
        }
      }
    }

    const estimatedWidth = Math.min(
      maxWidth,
      Math.max(minWidth, Math.ceil(maxLen * 8.5) + padding),
    );

    const oldWidth = colSizes.getSize(colIndex);
    if (oldWidth !== estimatedWidth) {
      executeSetColWidth(colIndex, estimatedWidth);
    }
    return estimatedWidth;
  }

  function executeSetFrozenRows(n) {
    const oldVal = frozenRows;
    const newVal = Math.max(0, n);
    if (oldVal === newVal) return;
    pushToUndoStack({
      type: "freezerows",
      oldVal,
      newVal,
    });
    frozenRows = newVal;
    _generation++;
  }

  function executeSetFrozenCols(n) {
    const oldVal = frozenCols;
    const newVal = Math.max(0, n);
    if (oldVal === newVal) return;
    pushToUndoStack({
      type: "freezecols",
      oldVal,
      newVal,
    });
    frozenCols = newVal;
    _generation++;
  }

  function undo() {
    if (undoStack.length === 0) return false;

    const entry = undoStack.pop();

    if (entry.type === "set") {
      const currentValue = getCellRaw(entry.r, entry.c).raw;

      redoStack.push({ ...entry, newVal: currentValue });

      _generation++;
      setCellRaw(entry.r, entry.c, entry.oldVal);

      recalculate();
    } else if (entry.type === "batch") {
      redoStack.push({ ...entry });
      _generation++;

      for (const change of entry.changes) {
        setCellRaw(change.row, change.col, change.oldVal);
      }

      recalculate();
    } else if (entry.type === "colresize") {
      redoStack.push({ ...entry });
      colSizes.setSize(entry.col, entry.oldWidth);
      _generation++;
    } else if (entry.type === "rowresize") {
      redoStack.push({ ...entry });
      rowSizes.setSize(entry.row, entry.oldHeight);
      _generation++;
    } else if (entry.type === "freezerows") {
      redoStack.push({ ...entry });
      frozenRows = entry.oldVal;
      _generation++;
    } else if (entry.type === "freezecols") {
      redoStack.push({ ...entry });
      frozenCols = entry.oldVal;
      _generation++;
    } else {
      redoStack.push({
        ...entry,
        restoreSnap: takeSnapshot(),
        restoreRows: rows,
        restoreCols: cols,
      });

      restoreSnapshot(entry.snap);

      if (entry.type === "rowins" || entry.type === "rowdel") {
        rows = entry.oldRows;
        rowSizes.setCount(rows);
      } else if (entry.type === "colins" || entry.type === "coldel") {
        cols = entry.oldCols;
        colSizes.setCount(cols);
      }

      recalculate();
    }

    return true;
  }

  function redo() {
    if (redoStack.length === 0) return false;

    const entry = redoStack.pop();

    if (entry.type === "set") {
      const currentValue = getCellRaw(entry.r, entry.c).raw;

      undoStack.push({ ...entry, oldVal: currentValue });
      _generation++;
      setCellRaw(entry.r, entry.c, entry.newVal);
      recalculate();
    } else if (entry.type === "batch") {
      undoStack.push({ ...entry });
      _generation++;

      for (const change of entry.changes) {
        setCellRaw(change.row, change.col, change.newVal);
      }

      recalculate();
    } else if (entry.type === "colresize") {
      undoStack.push({ ...entry });
      colSizes.setSize(entry.col, entry.newWidth);
      _generation++;
    } else if (entry.type === "rowresize") {
      undoStack.push({ ...entry });
      rowSizes.setSize(entry.row, entry.newHeight);
      _generation++;
    } else if (entry.type === "freezerows") {
      undoStack.push({ ...entry });
      frozenRows = entry.newVal;
      _generation++;
    } else if (entry.type === "freezecols") {
      undoStack.push({ ...entry });
      frozenCols = entry.newVal;
      _generation++;
    } else {
      undoStack.push({
        ...entry,
        snap: takeSnapshot(),
        oldRows: rows,
        oldCols: cols,
      });

      restoreSnapshot(entry.restoreSnap);

      rows = entry.restoreRows;
      cols = entry.restoreCols;
      rowSizes.setCount(rows);
      colSizes.setCount(cols);

      recalculate();
    }

    return true;
  }

  // ── Public cell display (returns raw + computed + error) ──

  function getCellForDisplay(row, col) {
    const cell = getCellRaw(row, col);
    const key = cellKey(row, col);
    // Resolve the computed value (this may trigger recalculation if the cell is dirty)
    // The resolveCellValue function handles caching and dependency resolution
    const value = resolveCellValue(key);

    // Error values are strings starting with '#' (e.g., '#CYCLE!', '#VALUE!')
    if (typeof value === "string" && value.startsWith("#")) {
      return { raw: cell.raw, computed: null, error: value };
    }
    // Return the computed value (which may be a number or string)
    // Note: Empty cells return '' as computed value, not null
    return { raw: cell.raw, computed: value, error: null };
  }

  function getUsedRange() {
    if (cells.size === 0) {
      return {
        minRow: 0,
        maxRow: 0,
        minCol: 0,
        maxCol: 0,
        startRow: 0,
        endRow: 0,
        startCol: 0,
        endCol: 0,
      };
    }
    let minRow = Infinity;
    let maxRow = -1;
    let minCol = Infinity;
    let maxCol = -1;

    for (const key of cells.keys()) {
      const coords = cellCoords(key);
      if (!coords) continue;
      if (coords.row < minRow) minRow = coords.row;
      if (coords.row > maxRow) maxRow = coords.row;
      if (coords.col < minCol) minCol = coords.col;
      if (coords.col > maxCol) maxCol = coords.col;
    }

    if (maxRow === -1) {
      return {
        minRow: 0,
        maxRow: 0,
        minCol: 0,
        maxCol: 0,
        startRow: 0,
        endRow: 0,
        startCol: 0,
        endCol: 0,
      };
    }

    return {
      minRow,
      maxRow,
      minCol,
      maxCol,
      startRow: minRow,
      endRow: maxRow,
      startCol: minCol,
      endCol: maxCol,
    };
  }

  // ── Stable Row Identity & Data Block Detection ──

  const TOTALS_ROW_REGEX = /^(grand\s+)?(total|totals|subtotal|sum)\b/i;

  function isTotalsRow(rowIndex, minCol = 0, maxCol = cols - 1) {
    if (rowIndex < 0 || rowIndex >= rows) return false;
    let firstNonEmptyRaw = null;
    let filledCount = 0;
    let hasSummaryFormula = false;
    let hasNumber = false;

    for (let c = minCol; c <= maxCol; c++) {
      const raw = getCellRaw(rowIndex, c).raw.trim();
      if (raw !== "") {
        filledCount++;
        if (firstNonEmptyRaw === null) {
          firstNonEmptyRaw = raw;
        }
        if (/^=(SUM|SUBTOTAL|AVERAGE)\b/i.test(raw)) {
          hasSummaryFormula = true;
        }
        const num = parseFloat(raw.replace(/[$,%]/g, ""));
        if (!isNaN(num)) {
          hasNumber = true;
        }
      }
    }

    if (filledCount === 0 || firstNonEmptyRaw === null) return false;

    // 1. Direct label match on the first non-empty cell (e.g. "Total", "Grand Total", "Subtotal", "Sum")
    if (TOTALS_ROW_REGEX.test(firstNonEmptyRaw)) {
      return true;
    }

    // 2. Contains summary formula (e.g. =SUM)
    if (hasSummaryFormula) {
      return true;
    }

    // 3. Summary line heuristic from AI Contract §4.2:
    // non-numeric label first, then numbers, with at least one column left empty,
    // and at least two filled cells, not all cells filled.
    const totalCols = maxCol - minCol + 1;
    const firstIsNum = !isNaN(parseFloat(firstNonEmptyRaw.replace(/[$,%]/g, "")));
    if (!firstIsNum && hasNumber && filledCount >= 2 && filledCount < totalCols) {
      if (TOTALS_ROW_REGEX.test(firstNonEmptyRaw)) {
        return true;
      }
    }

    return false;
  }

  function getDataBlock(selectedRange = null) {
    // If a multi-row range is explicitly selected, sort that block
    const hasMultiRowSelection =
      selectedRange &&
      typeof selectedRange === "object" &&
      selectedRange.startRow !== undefined &&
      selectedRange.endRow !== undefined &&
      Math.abs(selectedRange.endRow - selectedRange.startRow) >= 1;

    if (hasMultiRowSelection) {
      const minRow = Math.min(selectedRange.startRow, selectedRange.endRow);
      const maxRow = Math.max(selectedRange.startRow, selectedRange.endRow);
      const minCol = Math.min(
        selectedRange.startCol ?? selectedRange.minCol ?? 0,
        selectedRange.endCol ?? selectedRange.maxCol ?? (cols - 1),
      );
      const maxCol = Math.max(
        selectedRange.startCol ?? selectedRange.minCol ?? 0,
        selectedRange.endCol ?? selectedRange.maxCol ?? (cols - 1),
      );

      // If selection includes row 0, row 0 is treated as header
      const headerRow = minRow === 0 ? 0 : null;
      const startRow = headerRow !== null ? 1 : minRow;
      let endRow = maxRow;
      let totalsRow = null;

      // Check if the bottom row of selection is a totals row
      if (endRow >= startRow && isTotalsRow(endRow, minCol, maxCol)) {
        totalsRow = endRow;
        endRow = endRow - 1;
      }

      return {
        hasBlock: startRow <= endRow,
        headerRow,
        startRow,
        endRow,
        totalsRow,
        minCol,
        maxCol,
        isSelection: true,
      };
    }

    // Otherwise: used range with row 1 (index 0) as header and trailing totals row pinned
    const used = getUsedRange();
    if (used.maxRow === -1 || cells.size === 0) {
      return {
        hasBlock: false,
        headerRow: null,
        startRow: -1,
        endRow: -1,
        totalsRow: null,
        minCol: 0,
        maxCol: 0,
        isSelection: false,
      };
    }

    const headerRow = used.minRow; // 0 for standard sheet
    const startRow = headerRow + 1;
    let endRow = used.maxRow;
    let totalsRow = null;

    // Check if trailing row is a totals row
    if (endRow >= startRow && isTotalsRow(endRow, used.minCol, used.maxCol)) {
      totalsRow = endRow;
      endRow = endRow - 1;
    }

    return {
      hasBlock: startRow <= endRow,
      headerRow,
      startRow,
      endRow,
      totalsRow,
      minCol: used.minCol,
      maxCol: used.maxCol,
      isSelection: false,
    };
  }

  function getRowId(row) {
    if (row < 0 || row >= rowIdentities.length) return null;
    return rowIdentities[row];
  }

  function getRowIndexById(id) {
    return rowIdentities.indexOf(id);
  }

  function getRowOrder() {
    return rowIdentities.slice(0, rows);
  }

  function sortDataBlock(columnIndex, direction = null, options = {}) {
    const block = getDataBlock(options.range);
    if (!block || !block.hasBlock) {
      return { success: false, reason: "no_data_block" };
    }

    const { startRow, endRow } = block;
    if (startRow >= endRow) {
      return { success: false, reason: "insufficient_rows" };
    }

    // Determine target sort direction
    let targetDir = direction;
    if (!targetDir || targetDir === "cycle") {
      if (_currentSort.col === columnIndex) {
        if (_currentSort.direction === "asc") {
          targetDir = "desc";
        } else if (_currentSort.direction === "desc") {
          targetDir = "original";
        } else {
          targetDir = "asc";
        }
      } else {
        targetDir = "asc";
      }
    }

    // Identify rows to sort (supports visibleRowIndices for filtered sort)
    const visibleSet = options.visibleRowIndices
      ? new Set(options.visibleRowIndices)
      : null;

    const rowsToSort = [];
    for (let r = startRow; r <= endRow; r++) {
      if (!visibleSet || visibleSet.has(r)) {
        rowsToSort.push(r);
      }
    }

    if (rowsToSort.length <= 1) {
      _currentSort = {
        col: targetDir === "original" ? null : columnIndex,
        direction: targetDir === "original" ? null : targetDir,
      };
      return {
        success: true,
        direction: targetDir,
        column: columnIndex,
        sortedRowsCount: rowsToSort.length,
        oldRowToNewRowMap: new Map(),
        startRow,
        endRow,
      };
    }

    // Capture snapshot for undo before mutating
    const snapshot = takeSnapshot();

    // Gather row sort items
    const rowsToSortData = rowsToSort.map((r, slotIdx) => {
      const cell = getCellForDisplay(r, columnIndex);
      const sortVal =
        cell.computed !== null &&
        cell.computed !== undefined &&
        cell.computed !== ""
          ? cell.computed
          : cell.raw;
      return {
        oldRow: r,
        slotIdx,
        rowId: getRowId(r),
        sortVal,
      };
    });

    if (targetDir === "original") {
      // Restore the order recorded at the start of the sort cycle
      if (_blockOriginalOrder && Array.isArray(_blockOriginalOrder)) {
        const orderMap = new Map();
        _blockOriginalOrder.forEach((id, idx) => orderMap.set(id, idx));
        rowsToSortData.sort((a, b) => {
          const posA = orderMap.has(a.rowId) ? orderMap.get(a.rowId) : a.rowId;
          const posB = orderMap.has(b.rowId) ? orderMap.get(b.rowId) : b.rowId;
          return posA - posB;
        });
      } else {
        rowsToSortData.sort((a, b) => a.rowId - b.rowId);
      }
    } else {
      // If beginning a new sort cycle, record original order
      if (
        _currentSort.direction === null ||
        _currentSort.col !== columnIndex ||
        !_blockOriginalOrder
      ) {
        _blockOriginalOrder = rowsToSortData.map((item) => item.rowId);
      }

      rowsToSortData.sort((a, b) => {
        const cmp = compareCells(a.sortVal, b.sortVal, targetDir);
        if (cmp !== 0) return cmp;
        return a.slotIdx - b.slotIdx; // Stable tie-breaker
      });
    }

    // Map old row positions to new row positions
    const oldRowToNewRowMap = new Map();
    for (let i = 0; i < rowsToSort.length; i++) {
      const oldRow = rowsToSortData[i].oldRow;
      const newRow = rowsToSort[i];
      oldRowToNewRowMap.set(oldRow, newRow);
    }

    // Push undo entry
    pushToUndoStack({
      type: "sort",
      snap: snapshot,
      prevSort: { ..._currentSort },
      newSort: {
        col: targetDir === "original" ? null : columnIndex,
        direction: targetDir === "original" ? null : targetDir,
      },
      prevBlockOriginalOrder: _blockOriginalOrder
        ? [..._blockOriginalOrder]
        : null,
      oldRows: rows,
      oldCols: cols,
    });

    // Update row identities to reflect new row positions
    const newRowIdentities = [...rowIdentities];
    for (let i = 0; i < rowsToSort.length; i++) {
      const newRow = rowsToSort[i];
      newRowIdentities[newRow] = rowsToSortData[i].rowId;
    }
    rowIdentities = newRowIdentities;

    // Check if any cells in the sheet contain formulas
    let hasAnyFormulas = false;
    for (const cell of cells.values()) {
      if (cell.raw && cell.raw.startsWith("=")) {
        hasAnyFormulas = true;
        break;
      }
    }

    // Helper to rewrite formulas according to Challenge 2 specification
    function rewriteFormula(formula) {
      if (!formula || !formula.startsWith("=")) return formula;
      return formula.replace(
        /((\$?)([A-Z]+)(\$?)(\d+)):((\$?)([A-Z]+)(\$?)(\d+))|(\$?)([A-Z]+)(\$?)(\d+)/g,
        (
          match,
          _rng,
          cD1,
          cL1,
          rD1,
          rS1,
          _rng2,
          cD2,
          cL2,
          rD2,
          rS2,
          cD,
          cL,
          rD,
          rS,
        ) => {
          if (rS1 !== undefined && rS2 !== undefined) {
            const r1 = parseInt(rS1, 10) - 1;
            const r2 = parseInt(rS2, 10) - 1;
            const minR = Math.min(r1, r2);
            const maxR = Math.max(r1, r2);
            // Range spanning the whole block is unchanged
            if (minR === startRow && maxR === endRow) {
              return match;
            }
            const newR1 = oldRowToNewRowMap.has(r1)
              ? oldRowToNewRowMap.get(r1)
              : r1;
            const newR2 = oldRowToNewRowMap.has(r2)
              ? oldRowToNewRowMap.get(r2)
              : r2;
            if (newR1 > newR2) {
              return `${cD1 || ""}${cL1}${rD1 || ""}${newR2 + 1}:${cD2 || ""}${cL2}${rD2 || ""}${newR1 + 1}`;
            }
            return `${cD1 || ""}${cL1}${rD1 || ""}${newR1 + 1}:${cD2 || ""}${cL2}${rD2 || ""}${newR2 + 1}`;
          } else if (rS !== undefined) {
            const r = parseInt(rS, 10) - 1;
            if (oldRowToNewRowMap.has(r)) {
              const newR = oldRowToNewRowMap.get(r);
              return `${cD || ""}${cL}${rD || ""}${newR + 1}`;
            }
            return match;
          }
          return match;
        },
      );
    }

    // Fast batch cell update:
    // 1. Gather and remove all cells belonging to rowsToSort
    const cellsInBlock = [];
    for (const r of rowsToSort) {
      for (let c = 0; c < cols; c++) {
        const k = cellKey(r, c);
        const cell = cells.get(k);
        if (cell) {
          cellsInBlock.push({ oldRow: r, col: c, cell });
          cells.delete(k);
          graph.removeAllDependencies(k);
          computedCache.delete(k);
        }
      }
    }

    // 2. Put reordered cells into cells Map with rewritten formulas
    for (const item of cellsInBlock) {
      const newRow = oldRowToNewRowMap.get(item.oldRow);
      const newKey = cellKey(newRow, item.col);
      const raw = item.cell.raw;
      const newRaw = hasAnyFormulas ? rewriteFormula(raw) : raw;
      cells.set(newKey, {
        raw: newRaw,
        computed: newRaw === raw ? item.cell.computed : null,
        error: null,
      });
      if (newRaw && newRaw.startsWith("=")) {
        updateDependencies(newKey, newRaw);
      }
    }

    // 3. Rewrite any formulas outside rowsToSort that reference moved rows
    if (hasAnyFormulas) {
      const rowsToSortSet = new Set(rowsToSort);
      for (const [key, cell] of cells.entries()) {
        if (cell.raw && cell.raw.startsWith("=")) {
          const coords = cellCoords(key);
          if (coords && !rowsToSortSet.has(coords.row)) {
            const updated = rewriteFormula(cell.raw);
            if (updated !== cell.raw) {
              cell.raw = updated;
              graph.removeAllDependencies(key);
              updateDependencies(key, updated);
            }
          }
        }
      }
    }

    // Update sort state
    if (targetDir === "original") {
      _currentSort = { col: null, direction: null };
      _blockOriginalOrder = null;
    } else {
      _currentSort = { col: columnIndex, direction: targetDir };
    }

    _generation++;
    if (hasAnyFormulas) {
      markAllCellsDirty();
      recalculate();
    } else {
      dirtyCells.clear();
      computedCache.clear();
    }

    if (typeof options.onRowMove === "function") {
      for (const [oldR, newR] of oldRowToNewRowMap.entries()) {
        if (oldR !== newR) {
          options.onRowMove(oldR, newR);
        }
      }
    }

    return {
      success: true,
      direction: targetDir,
      column: columnIndex,
      sortedRowsCount: rowsToSort.length,
      oldRowToNewRowMap,
      startRow,
      endRow,
    };
  }

  // ── Multi-Column Filter Evaluation (Challenge 2) ──

  function getFilterDistinctValues(columnIndex, options = {}) {
    const block = getDataBlock(options.range);
    if (!block || !block.hasBlock) {
      return { values: [], hasBlanks: false, totalRows: 0 };
    }

    const { startRow, endRow } = block;
    const distinctMap = new Map(); // normKey -> displayLabel
    let hasBlanks = false;

    for (let r = startRow; r <= endRow; r++) {
      const cell = getCellForDisplay(r, columnIndex);
      const raw = cell.raw ?? "";
      const computed = cell.computed;
      const isBlank = isBlankValue(computed) && isBlankValue(raw);

      if (isBlank) {
        hasBlanks = true;
      } else {
        const displayVal = String(
          computed !== null && computed !== undefined && computed !== ""
            ? computed
            : raw,
        ).trim();
        const normKey = displayVal.toLowerCase();
        if (!distinctMap.has(normKey)) {
          distinctMap.set(normKey, displayVal);
        }
      }
    }

    const values = Array.from(distinctMap.values()).sort((a, b) =>
      compareCells(a, b, "asc"),
    );

    return {
      values,
      hasBlanks,
      totalRows: endRow - startRow + 1,
      startRow,
      endRow,
    };
  }

  function evaluateFilters(columnFilters = {}, options = {}) {
    const block = getDataBlock(options.range);
    if (!block || !block.hasBlock) {
      return {
        visibleRows: [],
        hiddenRows: [],
        visibleSet: new Set(),
        visibleCount: 0,
        totalCount: 0,
        statusText: "0 of 0 rows",
        hasActiveFilters: false,
        startRow: 0,
        endRow: 0,
      };
    }

    const { startRow, endRow } = block;
    const totalCount = endRow - startRow + 1;

    // Normalize active filters list
    const activeFilters = [];
    if (columnFilters && typeof columnFilters === "object") {
      for (const [colKey, filter] of Object.entries(columnFilters)) {
        if (!filter) continue;
        const colIdx = parseInt(colKey, 10);
        if (isNaN(colIdx)) continue;

        const hasSelected =
          filter.selectedValues !== undefined &&
          filter.selectedValues !== null &&
          (Array.isArray(filter.selectedValues)
            ? filter.selectedValues.length > 0
            : filter.selectedValues instanceof Set
              ? filter.selectedValues.size > 0
              : true);

        const hasCondition =
          filter.condition &&
          typeof filter.condition.type === "string" &&
          filter.condition.type.trim() !== "";

        const hasSearch =
          typeof filter.searchQuery === "string" &&
          filter.searchQuery.trim() !== "";

        if (hasSelected || hasCondition || hasSearch) {
          // Pre-normalize selected values set for fast lookup
          let selectedNormSet = null;
          let allowsBlanks = false;

          if (filter.selectedValues) {
            selectedNormSet = new Set();
            const list = Array.isArray(filter.selectedValues)
              ? filter.selectedValues
              : Array.from(filter.selectedValues);
            for (const item of list) {
              const str = String(item).trim();
              if (str === "(Blanks)" || str === "" || str === null) {
                allowsBlanks = true;
              } else {
                selectedNormSet.add(str.toLowerCase());
              }
            }
          }

          activeFilters.push({
            colIdx,
            selectedNormSet,
            allowsBlanks,
            condition: filter.condition,
            searchQuery: hasSearch
              ? filter.searchQuery.trim().toLowerCase()
              : null,
          });
        }
      }
    }

    // If no active filters, all rows in data block are visible
    if (activeFilters.length === 0) {
      const visibleRows = [];
      for (let r = startRow; r <= endRow; r++) {
        visibleRows.push(r);
      }
      return {
        visibleRows,
        hiddenRows: [],
        visibleSet: new Set(visibleRows),
        visibleCount: totalCount,
        totalCount,
        statusText: `${totalCount} of ${totalCount} rows`,
        hasActiveFilters: false,
        startRow,
        endRow,
      };
    }

    // Helper: test a cell against a condition
    function matchesCondition(val, condition) {
      if (!condition || !condition.type) return true;
      const type = condition.type.toLowerCase().trim();
      const isBlank = isBlankValue(val);

      if (type === "is_empty" || type === "is empty") {
        return isBlank;
      }
      if (type === "not_empty" || type === "not empty") {
        return !isBlank;
      }

      if (isBlank) return false;

      const condVal =
        condition.value !== undefined ? String(condition.value).trim() : "";
      const valStr = String(val).trim();
      const normVal = valStr.toLowerCase();
      const normCond = condVal.toLowerCase();

      if (type === "contains") {
        return normVal.includes(normCond);
      }
      if (type === "does_not_contain" || type === "does not contain") {
        return !normVal.includes(normCond);
      }

      // Greater than / Less than: compare dates, numbers, or text
      const dateA = toDateValue(valStr);
      const dateB = toDateValue(condVal);
      if (dateA !== null && dateB !== null) {
        if (type === "greater_than" || type === "greater than")
          return dateA > dateB;
        if (type === "less_than" || type === "less than") return dateA < dateB;
      }

      const numA = toNumericValue(valStr);
      const numB = toNumericValue(condVal);
      if (numA !== null && numB !== null) {
        if (type === "greater_than" || type === "greater than")
          return numA > numB;
        if (type === "less_than" || type === "less than") return numA < numB;
      }

      // Text comparison
      const cmp = normVal.localeCompare(normCond);
      if (type === "greater_than" || type === "greater than") return cmp > 0;
      if (type === "less_than" || type === "less than") return cmp < 0;

      return true;
    }

    const visibleRows = [];
    const hiddenRows = [];

    // Evaluate each row in data block across all active filters (AND logic)
    for (let r = startRow; r <= endRow; r++) {
      let rowMatches = true;

      for (const filter of activeFilters) {
        const cell = getCellForDisplay(r, filter.colIdx);
        const raw = cell.raw ?? "";
        const computed = cell.computed;
        const isBlank = isBlankValue(computed) && isBlankValue(raw);
        const cellVal =
          computed !== null && computed !== undefined && computed !== ""
            ? computed
            : raw;
        const normCell = String(cellVal).trim().toLowerCase();

        // 1. Checklist filter
        if (filter.selectedNormSet !== null) {
          if (isBlank) {
            if (!filter.allowsBlanks) {
              rowMatches = false;
              break;
            }
          } else {
            if (!filter.selectedNormSet.has(normCell)) {
              rowMatches = false;
              break;
            }
          }
        }

        // 2. Condition filter
        if (filter.condition) {
          if (!matchesCondition(cellVal, filter.condition)) {
            rowMatches = false;
            break;
          }
        }

        // 3. Search query filter
        if (filter.searchQuery !== null) {
          if (isBlank || !normCell.includes(filter.searchQuery)) {
            rowMatches = false;
            break;
          }
        }
      }

      if (rowMatches) {
        visibleRows.push(r);
      } else {
        hiddenRows.push(r);
      }
    }

    const visibleCount = visibleRows.length;
    return {
      visibleRows,
      hiddenRows,
      visibleSet: new Set(visibleRows),
      visibleCount,
      totalCount,
      statusText: `${visibleCount} of ${totalCount} rows`,
      hasActiveFilters: true,
      startRow,
      endRow,
    };
  }

  // ── Public API ──
  // The engine exposes a limited API to prevent direct access to internal state
  // All cell operations go through the public methods which handle undo/redo,
  // dependency tracking, and cache invalidation automatically

  return {
    get rows() {
      return rows;
    },
    get cols() {
      return cols;
    },
    getCell: getCellForDisplay,
    setCell: executeSetCell,
    setCells: executeSetCells,
    getUsedRange,
    shiftFormula: shiftFormulaReferences,
    extrapolateSeries,
    insertRow: executeInsertRow,
    deleteRow: executeDeleteRow,
    insertColumn: executeInsertColumn,
    deleteColumn: executeDeleteColumn,
    getRowId,
    getRowOrder,
    getRowIndexById,
    isTotalsRow,
    getDataBlock,
    sortDataBlock,
    getSortState: () => ({ ..._currentSort }),
    getFilterDistinctValues,
    evaluateFilters,
    compareCells,
    toNumericValue,
    toDateValue,
    isBlankValue,
    undo,
    redo,
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    ensureCapacity: (minRows, minCols) => {
      if (minRows > rows) {
        while (rowIdentities.length < minRows) {
          rowIdentities.push(nextRowId++);
        }
        rows = minRows;
        rowSizes.setCount(rows);
      }
      if (minCols > cols) {
        cols = minCols;
        colSizes.setCount(cols);
      }
    },
    // Virtualization and sizing APIs (Challenge 3)
    getRowOffset: (r) => rowSizes.getOffset(r),
    getColOffset: (c) => colSizes.getOffset(c),
    getRowHeight: (r) => rowSizes.getSize(r),
    getColWidth: (c) => colSizes.getSize(c),
    setRowHeight: (r, h, opts) =>
      opts?.undoable === false
        ? (rowSizes.setSize(r, h), _generation++)
        : executeSetRowHeight(r, h, opts?.oldHeight),
    setColWidth: (c, w, opts) =>
      opts?.undoable === false
        ? (colSizes.setSize(c, w), _generation++)
        : executeSetColWidth(c, w, opts?.oldWidth),
    autoFitColumn: (c, opts) => autoFitColumn(c, opts),
    getTotalGridHeight: () => rowSizes.getTotalSize(),
    getTotalGridWidth: () => colSizes.getTotalSize(),
    getVisibleRowRange: (scrollTop, viewportHeight, overscan = 5) =>
      rowSizes.findVisibleRange(scrollTop, viewportHeight, overscan),
    getVisibleColRange: (scrollLeft, viewportWidth, overscan = 5) =>
      colSizes.findVisibleRange(scrollLeft, viewportWidth, overscan),
    findRowAtOffset: (y) => rowSizes.findItemIndexAtOffset(y),
    findColAtOffset: (x) => colSizes.findItemIndexAtOffset(x),
    getRowSizesIndex: () => rowSizes,
    getColSizesIndex: () => colSizes,
    // Frozen rows and columns (Challenge 3 Task 3.3)
    getFrozenRows: () => frozenRows,
    getFrozenCols: () => frozenCols,
    setFrozenRows: (n, opts = { undoable: true }) =>
      opts?.undoable === false
        ? ((frozenRows = Math.max(0, n)), _generation++)
        : executeSetFrozenRows(n),
    setFrozenCols: (n, opts = { undoable: true }) =>
      opts?.undoable === false
        ? ((frozenCols = Math.max(0, n)), _generation++)
        : executeSetFrozenCols(n),
  };
}
