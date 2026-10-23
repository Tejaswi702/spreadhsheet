import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import "./App.css";
import { createEngine, columnLetterToIndex } from "./engine/core.js";
import { loadSampleSmall, loadSampleLarge } from "./fixtures/loadSample.js";
import AiPanel from "./components/AiPanel.jsx";
import { formatCellValue } from "./ai/formatter.js";
import { applyFormatSheet } from "./ai/applier.js";

const TOTAL_ROWS = 100000;
const TOTAL_COLS = 200;

export default function App() {
  // Engine instance is created once and reused across renders
  // Note: The engine maintains its own internal state, so React state is only used for UI updates
  const [engine] = useState(() =>
    createEngine(TOTAL_ROWS, TOTAL_COLS, {
      defaultColWidth: 100,
      defaultRowHeight: 24,
      frozenRows: 1,
      frozenCols: 1,
    }),
  );
  const [version, setVersion] = useState(0);
  const [isAiPanelOpen, setIsAiPanelOpen] = useState(false);

  // Global Ctrl+K / Cmd+K shortcut to toggle AI Side Panel (Task 4.4)
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setIsAiPanelOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);
  const [selectedCell, setSelectedCell] = useState(null);
  const [editingCell, setEditingCell] = useState(null);
  const [selectionRange, setSelectionRange] = useState(null);
  const [editValue, setEditValue] = useState("");
  // Cell styles are stored separately from engine data
  // Format: { "row,col": { bold: bool, italic: bool, ... } }
  const [cellStyles, setCellStyles] = useState({});
  const styleUndoStackRef = useRef([]);
  const styleRedoStackRef = useRef([]);
  const cellInputRef = useRef(null);
  const isSelectingRef = useRef(false);
  const selectionAnchorRef = useRef(null);
  const gridScrollRef = useRef(null);
  const scrollCellIntoViewRef = useRef(null);

  // ────── Name Box State (Challenge 3 Task 3.5) ──────
  const [nameBoxText, setNameBoxText] = useState("");
  const [isEditingNameBox, setIsEditingNameBox] = useState(false);

  // ────── Filter State (Challenge 2) ──────
  const [columnFilters, setColumnFilters] = useState({});
  const [filterPopupCol, setFilterPopupCol] = useState(null);
  const [filterPopupPos, setFilterPopupPos] = useState({ top: 100, left: 100 });
  const [filterSearch, setFilterSearch] = useState("");
  const [filterTempSelected, setFilterTempSelected] = useState(new Set());
  const [filterTempConditionType, setFilterTempConditionType] = useState("");
  const [filterTempConditionValue, setFilterTempConditionValue] = useState("");
  const filterPopupRef = useRef(null);

  const [fillPreview, setFillPreview] = useState(null);
  const fillPreviewRef = useRef(null);
  const isFillingRef = useRef(false);
  const fillSeedRef = useRef(null);

  // ────── Column & Row Resize State (Challenge 3 Task 3.4) ──────
  const [resizingCol, setResizingCol] = useState(null);
  const [resizingRow, setResizingRow] = useState(null);
  const colResizeRef = useRef(null);
  const rowResizeRef = useRef(null);

  const updateFillPreview = useCallback((preview) => {
    fillPreviewRef.current = preview;
    setFillPreview(preview);
  }, []);

  const commitFillRef = useRef(null);
  const handleFillDragRef = useRef(null);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isFillingRef.current && fillSeedRef.current) {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const td = el?.closest("td[data-row]");
        if (td && handleFillDragRef.current) {
          const r = parseInt(td.getAttribute("data-row"), 10);
          const c = parseInt(td.getAttribute("data-col"), 10);
          if (!isNaN(r) && !isNaN(c)) {
            handleFillDragRef.current(r, c);
          }
        }
      } else if (isSelectingRef.current && selectionAnchorRef.current) {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const td = el?.closest("td[data-row]");
        if (td) {
          const r = parseInt(td.getAttribute("data-row"), 10);
          const c = parseInt(td.getAttribute("data-col"), 10);
          if (!isNaN(r) && !isNaN(c)) {
            setSelectionRange({
              start: selectionAnchorRef.current,
              end: { r, c },
            });
          }
        }
      }
    };

    const handleMouseUp = () => {
      isSelectingRef.current = false;
      if (isFillingRef.current && commitFillRef.current) {
        commitFillRef.current();
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const forceRerender = useCallback(() => setVersion((v) => v + 1), []);

  // ────── Cell style helpers ──────

  const getCellStyle = useCallback(
    (row, col) => {
      const key = `${row},${col}`;
      return (
        cellStyles[key] || {
          bold: false,
          italic: false,
          underline: false,
          bg: "white",
          color: "#202124",
          align: "left",
          fontSize: 13,
        }
      );
    },
    [cellStyles],
  );

  // ────── Fill handle logic (Challenge 1 Row 4.2 & 4.3) ──────

  const handleFillHandleMouseDown = useCallback(
    (e, minR, maxR, minC, maxC) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();

      isFillingRef.current = true;
      fillSeedRef.current = {
        minRow: minR,
        maxRow: maxR,
        minCol: minC,
        maxCol: maxC,
      };
      updateFillPreview(null);
    },
    [updateFillPreview],
  );

  const handleFillDrag = useCallback(
    (rowIndex, colIndex) => {
      if (!fillSeedRef.current) return;
      const {
        minRow: minR,
        maxRow: maxR,
        minCol: minC,
        maxCol: maxC,
      } = fillSeedRef.current;
      const rowDiffDown = rowIndex - maxR;
      const rowDiffUp = minR - rowIndex;
      const colDiffRight = colIndex - maxC;
      const colDiffLeft = minC - colIndex;

      const maxRowDiff = Math.max(rowDiffDown, rowDiffUp);
      const maxColDiff = Math.max(colDiffRight, colDiffLeft);

      if (maxRowDiff <= 0 && maxColDiff <= 0) {
        updateFillPreview(null);
      } else if (maxRowDiff >= maxColDiff) {
        if (rowDiffDown > 0) {
          updateFillPreview({
            direction: "down",
            startRow: maxR + 1,
            endRow: rowIndex,
            startCol: minC,
            endCol: maxC,
          });
        } else if (rowDiffUp > 0) {
          updateFillPreview({
            direction: "up",
            startRow: rowIndex,
            endRow: minR - 1,
            startCol: minC,
            endCol: maxC,
          });
        }
      } else {
        if (colDiffRight > 0) {
          updateFillPreview({
            direction: "right",
            startRow: minR,
            endRow: maxR,
            startCol: maxC + 1,
            endCol: colIndex,
          });
        } else if (colDiffLeft > 0) {
          updateFillPreview({
            direction: "left",
            startRow: minR,
            endRow: maxR,
            startCol: colIndex,
            endCol: minC - 1,
          });
        }
      }
    },
    [updateFillPreview],
  );

  const commitFill = useCallback(() => {
    if (
      !isFillingRef.current ||
      !fillSeedRef.current ||
      !fillPreviewRef.current
    ) {
      isFillingRef.current = false;
      fillSeedRef.current = null;
      updateFillPreview(null);
      return;
    }

    const {
      minRow: minR,
      maxRow: maxR,
      minCol: minC,
      maxCol: maxC,
    } = fillSeedRef.current;
    const preview = fillPreviewRef.current;
    isFillingRef.current = false;
    fillSeedRef.current = null;
    updateFillPreview(null);

    const changes = [];
    const newStyles = {};

    if (preview.direction === "down") {
      const count = preview.endRow - maxR;
      engine.ensureCapacity(preview.endRow + 1, maxC + 1);
      for (let c = minC; c <= maxC; c++) {
        const seedValues = [];
        const seedStylesList = [];
        for (let r = minR; r <= maxR; r++) {
          seedValues.push(engine.getCell(r, c).raw);
          seedStylesList.push(cellStyles[`${r},${c}`] || getCellStyle(r, c));
        }
        const filledValues = engine.extrapolateSeries(seedValues, count, {
          direction: "down",
        });
        for (let k = 0; k < count; k++) {
          const targetR = maxR + 1 + k;
          changes.push({ row: targetR, col: c, value: filledValues[k] });
          newStyles[`${targetR},${c}`] = {
            ...seedStylesList[k % seedStylesList.length],
          };
        }
      }
      setSelectionRange({
        start: { r: minR, c: minC },
        end: { r: preview.endRow, c: maxC },
      });
    } else if (preview.direction === "right") {
      const count = preview.endCol - maxC;
      engine.ensureCapacity(maxR + 1, preview.endCol + 1);
      for (let r = minR; r <= maxR; r++) {
        const seedValues = [];
        const seedStylesList = [];
        for (let c = minC; c <= maxC; c++) {
          seedValues.push(engine.getCell(r, c).raw);
          seedStylesList.push(cellStyles[`${r},${c}`] || getCellStyle(r, c));
        }
        const filledValues = engine.extrapolateSeries(seedValues, count, {
          direction: "right",
        });
        for (let k = 0; k < count; k++) {
          const targetC = maxC + 1 + k;
          changes.push({ row: r, col: targetC, value: filledValues[k] });
          newStyles[`${r},${targetC}`] = {
            ...seedStylesList[k % seedStylesList.length],
          };
        }
      }
      setSelectionRange({
        start: { r: minR, c: minC },
        end: { r: maxR, c: preview.endCol },
      });
    } else if (preview.direction === "up") {
      const count = minR - preview.startRow;
      for (let c = minC; c <= maxC; c++) {
        const seedValues = [];
        const seedStylesList = [];
        for (let r = minR; r <= maxR; r++) {
          seedValues.push(engine.getCell(r, c).raw);
          seedStylesList.push(cellStyles[`${r},${c}`] || getCellStyle(r, c));
        }
        const filledValues = engine.extrapolateSeries(seedValues, count, {
          direction: "up",
        });
        for (let k = 0; k < count; k++) {
          const targetR = minR - 1 - k;
          changes.push({ row: targetR, col: c, value: filledValues[k] });
          newStyles[`${targetR},${c}`] = {
            ...seedStylesList[
              (seedStylesList.length - 1 - (k % seedStylesList.length)) %
                seedStylesList.length
            ],
          };
        }
      }
      setSelectionRange({
        start: { r: preview.startRow, c: minC },
        end: { r: maxR, c: maxC },
      });
    } else if (preview.direction === "left") {
      const count = minC - preview.startCol;
      for (let r = minR; r <= maxR; r++) {
        const seedValues = [];
        const seedStylesList = [];
        for (let c = minC; c <= maxC; c++) {
          seedValues.push(engine.getCell(r, c).raw);
          seedStylesList.push(cellStyles[`${r},${c}`] || getCellStyle(r, c));
        }
        const filledValues = engine.extrapolateSeries(seedValues, count, {
          direction: "left",
        });
        for (let k = 0; k < count; k++) {
          const targetC = minC - 1 - k;
          changes.push({ row: r, col: targetC, value: filledValues[k] });
          newStyles[`${r},${targetC}`] = {
            ...seedStylesList[
              (seedStylesList.length - 1 - (k % seedStylesList.length)) %
                seedStylesList.length
            ],
          };
        }
      }
      setSelectionRange({
        start: { r: minR, c: preview.startCol },
        end: { r: maxR, c: maxC },
      });
    }

    if (changes.length > 0) {
      engine.setCells(changes);
      setCellStyles((prev) => ({ ...prev, ...newStyles }));
      forceRerender();
    }
  }, [
    engine,
    cellStyles,
    getCellStyle,
    updateFillPreview,
    forceRerender,
  ]);

  useEffect(() => {
    commitFillRef.current = commitFill;
  }, [commitFill]);

  useEffect(() => {
    handleFillDragRef.current = handleFillDrag;
  }, [handleFillDrag]);

  const handleFillDown = useCallback(() => {
    let startRow, endRow, startCol, endCol;
    if (selectionRange) {
      const minRow = Math.min(selectionRange.start.r, selectionRange.end.r);
      const maxRow = Math.max(selectionRange.start.r, selectionRange.end.r);
      const minCol = Math.min(selectionRange.start.c, selectionRange.end.c);
      const maxCol = Math.max(selectionRange.start.c, selectionRange.end.c);
      if (minRow === maxRow) {
        startRow = minRow;
        startCol = minCol;
        endCol = maxCol;
        const adjCol = minCol > 0 ? minCol - 1 : minCol + 1;
        let lastPopulated = minRow;
        const used = engine.getUsedRange();
        for (let r = minRow + 1; r <= used.maxRow; r++) {
          const val = engine.getCell(r, adjCol).raw;
          if (val && val.trim() !== "") {
            lastPopulated = r;
          } else if (lastPopulated > minRow) {
            break;
          }
        }
        endRow = lastPopulated > minRow ? lastPopulated : engine.rows - 1;
      } else {
        startRow = minRow;
        endRow = maxRow;
        startCol = minCol;
        endCol = maxCol;
      }
    } else if (selectedCell) {
      startRow = selectedCell.r;
      startCol = selectedCell.c;
      endCol = selectedCell.c;
      const adjCol = selectedCell.c > 0 ? selectedCell.c - 1 : selectedCell.c + 1;
      let lastPopulated = startRow;
      const used = engine.getUsedRange();
      for (let r = startRow + 1; r <= used.maxRow; r++) {
        const val = engine.getCell(r, adjCol).raw;
        if (val && val.trim() !== "") {
          lastPopulated = r;
        } else if (lastPopulated > startRow) {
          break;
        }
      }
      endRow = lastPopulated > startRow ? lastPopulated : engine.rows - 1;
    } else {
      return;
    }

    if (endRow <= startRow) return;

    engine.ensureCapacity(endRow + 1, endCol + 1);
    const count = endRow - startRow;
    const changes = [];
    const newStyles = {};

    for (let c = startCol; c <= endCol; c++) {
      const seedCell = engine.getCell(startRow, c);
      const seedRaw = seedCell.raw;
      const seedStyle = cellStyles[`${startRow},${c}`] || getCellStyle(startRow, c);
      const filledValues = engine.extrapolateSeries([seedRaw], count, {
        direction: "down",
      });
      for (let k = 0; k < count; k++) {
        const targetR = startRow + 1 + k;
        changes.push({ row: targetR, col: c, value: filledValues[k] });
        if (seedStyle && Object.keys(seedStyle).length > 0) {
          newStyles[`${targetR},${c}`] = { ...seedStyle };
        }
      }
    }

    if (changes.length > 0) {
      engine.setCells(changes);
      if (Object.keys(newStyles).length > 0) {
        setCellStyles((prev) => ({ ...prev, ...newStyles }));
      }
      setSelectionRange({
        start: { r: startRow, c: startCol },
        end: { r: endRow, c: endCol },
      });
      forceRerender();
    }
  }, [
    engine,
    selectionRange,
    selectedCell,
    cellStyles,
    getCellStyle,
    forceRerender,
  ]);




  // ────── Cell editing ──────

  const startEditing = useCallback(
    (row, col, initialValue) => {
      setSelectedCell({ r: row, c: col });
      setEditingCell({ r: row, c: col });
      const cellData = engine.getCell(row, col);
      setEditValue(initialValue !== undefined ? initialValue : cellData.raw);
      scrollCellIntoViewRef.current?.(row, col);
      setTimeout(() => cellInputRef.current?.focus(), 0);
    },
    [engine],
  );

  const commitEdit = useCallback(
    (row, col) => {
      // Only commit if the value actually changed to avoid unnecessary recalculations
      const currentCell = engine.getCell(row, col);
      if (currentCell.raw !== editValue) {
        engine.setCell(row, col, editValue);
        forceRerender();
      }
      setEditingCell(null);
    },
    [engine, editValue, forceRerender],
  );

  // ────── Undo / Redo ──────

  const handleUndo = useCallback(() => {
    let didSomething = false;
    if (styleUndoStackRef.current.length > 0) {
      const entry = styleUndoStackRef.current.pop();
      styleRedoStackRef.current.push({
        styles: { ...cellStyles },
        structural: {
          prevFreezeRows: engine.getFrozenRows(),
        },
      });
      if (entry?.structural?.prevFreezeRows !== undefined) {
        engine.setFrozenRows(entry.structural.prevFreezeRows);
      }
      if (Array.isArray(entry?.structural?.columnWidths)) {
        for (const cw of entry.structural.columnWidths) {
          engine.setColWidth(cw.col, cw.prevWidth);
        }
      }
      setCellStyles(entry?.styles || entry || {});
      didSomething = true;
    }
    if (engine.undo()) {
      didSomething = true;
    }
    if (didSomething) {
      forceRerender();
    }
  }, [engine, cellStyles, forceRerender]);

  const handleRedo = useCallback(() => {
    let didSomething = false;
    if (styleRedoStackRef.current.length > 0) {
      const entry = styleRedoStackRef.current.pop();
      styleUndoStackRef.current.push({
        styles: { ...cellStyles },
        structural: {
          prevFreezeRows: engine.getFrozenRows(),
        },
      });
      if (entry?.structural?.prevFreezeRows !== undefined) {
        engine.setFrozenRows(entry.structural.prevFreezeRows);
      }
      setCellStyles(entry?.styles || entry || {});
      didSomething = true;
    }
    if (engine.redo()) {
      didSomething = true;
    }
    if (didSomething) {
      forceRerender();
    }
  }, [engine, cellStyles, forceRerender]);

  // ────── AI Sheet Format Applier (Challenge 5 Task 5.3) ──────
  const handleApplyFormat = useCallback(
    (action) => {
      const result = applyFormatSheet(engine, cellStyles, action);
      if (!result.success) {
        return result;
      }
      if (result.code === "NO_CHANGES") {
        return result;
      }

      // Record snapshot on styleUndoStack for single-step Ctrl+Z undo
      styleUndoStackRef.current.push({
        styles: { ...cellStyles },
        structural: {
          prevFreezeRows:
            result.structuralChanges?.prevFreezeRows !== undefined
              ? result.structuralChanges.prevFreezeRows
              : engine.getFrozenRows(),
          columnWidths: result.structuralChanges?.columnWidths,
        },
      });
      styleRedoStackRef.current = [];

      // Apply structural changes to engine
      if (result.structuralChanges?.freezeRows !== undefined) {
        engine.setFrozenRows(result.structuralChanges.freezeRows);
      }
      if (Array.isArray(result.structuralChanges?.columnWidths)) {
        for (const cw of result.structuralChanges.columnWidths) {
          engine.setColWidth(cw.col, cw.width);
        }
      }
      if (result.structuralChanges?.autoFitColumns) {
        const used = engine.getUsedRange();
        for (let c = used.minCol; c <= used.maxCol; c++) {
          engine.autoFitColumn(c);
        }
      }

      setCellStyles(result.newStyles);
      forceRerender();
      return result;
    },
    [engine, cellStyles, forceRerender],
  );

  // ────── Clear selected cell/range ──────

  const clearSelectedCell = useCallback(() => {
    if (!selectedCell) return;

    const start = selectionRange?.start || selectedCell;
    const end = selectionRange?.end || selectedCell;

    const minRow = Math.min(start.r, end.r);
    const maxRow = Math.max(start.r, end.r);
    const minCol = Math.min(start.c, end.c);
    const maxCol = Math.max(start.c, end.c);

    const changes = [];
    const clearedKeys = [];

    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const cell = engine.getCell(r, c);
        if (cell.raw !== "") {
          changes.push({ row: r, col: c, value: "" });
        }
        clearedKeys.push(`${r},${c}`);
      }
    }

    if (changes.length > 0) {
      engine.setCells(changes);
      forceRerender();
    }

    setCellStyles((prev) => {
      const next = { ...prev };
      for (const key of clearedKeys) {
        delete next[key];
      }
      return next;
    });

    setEditValue("");
  }, [selectedCell, selectionRange, engine, forceRerender]);

  const handleCellDoubleClick = useCallback(
    (row, col) => {
      startEditing(row, col);
    },
    [startEditing],
  );

  const handleGridKeyDown = useCallback(
    (event, row, col) => {
      if (editingCell || event.target !== event.currentTarget) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        const used = engine.getUsedRange();
        const start = { r: used.minRow, c: used.minCol };
        const end = { r: used.maxRow, c: used.maxCol };
        selectionAnchorRef.current = start;
        setSelectedCell(start);
        setSelectionRange({ start, end });
        setEditingCell(null);
        return;
      }

      if (event.key === "F2" || event.key === "Enter") {
        event.preventDefault();
        startEditing(row, col);
        return;
      }

      if (
        event.key.length === 1 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        startEditing(row, col, event.key);
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        clearSelectedCell();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        handleRedo();
        return;
      }

      // Ctrl+D / Cmd+D: Fill Down selection or series
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        handleFillDown();
        return;
      }

      // Ctrl+Home / Cmd+Home: Jump to origin (A1 or top-left)
      if ((event.ctrlKey || event.metaKey) && event.key === "Home") {
        event.preventDefault();
        const nextRow = 0;
        const nextCol = 0;
        const anchor = event.shiftKey
          ? (selectionAnchorRef.current || { r: row, c: col })
          : { r: nextRow, c: nextCol };
        selectionAnchorRef.current = anchor;
        setSelectedCell({ r: nextRow, c: nextCol });
        setSelectionRange(
          event.shiftKey
            ? { start: anchor, end: { r: nextRow, c: nextCol } }
            : null,
        );
        if (gridScrollRef.current) {
          gridScrollRef.current.scrollTop = 0;
          gridScrollRef.current.scrollLeft = 0;
        }
        return;
      }

      // Ctrl+End / Cmd+End: Jump to bottom-right of used range (or grid limit)
      if ((event.ctrlKey || event.metaKey) && event.key === "End") {
        event.preventDefault();
        const used = engine.getUsedRange();
        const nextRow = Math.max(0, used.maxRow);
        const nextCol = Math.max(0, used.maxCol);
        const anchor = event.shiftKey
          ? (selectionAnchorRef.current || { r: row, c: col })
          : { r: nextRow, c: nextCol };
        selectionAnchorRef.current = anchor;
        setSelectedCell({ r: nextRow, c: nextCol });
        setSelectionRange(
          event.shiftKey
            ? { start: anchor, end: { r: nextRow, c: nextCol } }
            : null,
        );
        scrollCellIntoViewRef.current?.(nextRow, nextCol);
        return;
      }

      // PageDown: Jump down by one viewport height of rows
      if (event.key === "PageDown") {
        event.preventDefault();
        const vpHeight = gridScrollRef.current?.clientHeight || 600;
        const pageSize = Math.max(1, Math.floor(vpHeight / 24) - 2);
        const nextRow = Math.min(engine.rows - 1, row + pageSize);
        const anchor = event.shiftKey
          ? (selectionAnchorRef.current || { r: row, c: col })
          : { r: nextRow, c: col };
        selectionAnchorRef.current = anchor;
        setSelectedCell({ r: nextRow, c: col });
        setSelectionRange(
          event.shiftKey
            ? { start: anchor, end: { r: nextRow, c: col } }
            : null,
        );
        scrollCellIntoViewRef.current?.(nextRow, col);
        return;
      }

      // PageUp: Jump up by one viewport height of rows
      if (event.key === "PageUp") {
        event.preventDefault();
        const vpHeight = gridScrollRef.current?.clientHeight || 600;
        const pageSize = Math.max(1, Math.floor(vpHeight / 24) - 2);
        const nextRow = Math.max(0, row - pageSize);
        const anchor = event.shiftKey
          ? (selectionAnchorRef.current || { r: row, c: col })
          : { r: nextRow, c: col };
        selectionAnchorRef.current = anchor;
        setSelectedCell({ r: nextRow, c: col });
        setSelectionRange(
          event.shiftKey
            ? { start: anchor, end: { r: nextRow, c: col } }
            : null,
        );
        scrollCellIntoViewRef.current?.(nextRow, col);
        return;
      }

      // Home: Jump to first column (Col A) in current row
      if (event.key === "Home" && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        const nextCol = 0;
        const anchor = event.shiftKey
          ? (selectionAnchorRef.current || { r: row, c: col })
          : { r: row, c: nextCol };
        selectionAnchorRef.current = anchor;
        setSelectedCell({ r: row, c: nextCol });
        setSelectionRange(
          event.shiftKey
            ? { start: anchor, end: { r: row, c: nextCol } }
            : null,
        );
        scrollCellIntoViewRef.current?.(row, nextCol);
        return;
      }

      // End: Jump to last populated column in used range for current row
      if (event.key === "End" && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        const used = engine.getUsedRange();
        const nextCol = Math.min(engine.cols - 1, Math.max(0, used.maxCol));
        const anchor = event.shiftKey
          ? (selectionAnchorRef.current || { r: row, c: col })
          : { r: row, c: nextCol };
        selectionAnchorRef.current = anchor;
        setSelectedCell({ r: row, c: nextCol });
        setSelectionRange(
          event.shiftKey
            ? { start: anchor, end: { r: row, c: nextCol } }
            : null,
        );
        scrollCellIntoViewRef.current?.(row, nextCol);
        return;
      }

      // Arrow keys (with or without Shift)
      if (
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)
      ) {
        event.preventDefault();
        let nextRow = row;
        let nextCol = col;

        if (event.key === "ArrowUp") nextRow = Math.max(0, row - 1);
        if (event.key === "ArrowDown")
          nextRow = Math.min(engine.rows - 1, row + 1);
        if (event.key === "ArrowLeft") nextCol = Math.max(0, col - 1);
        if (event.key === "ArrowRight")
          nextCol = Math.min(engine.cols - 1, col + 1);

        const anchor = event.shiftKey
          ? (selectionAnchorRef.current || { r: row, c: col })
          : { r: nextRow, c: nextCol };
        selectionAnchorRef.current = anchor;
        setSelectedCell({ r: nextRow, c: nextCol });
        setSelectionRange(
          event.shiftKey
            ? { start: anchor, end: { r: nextRow, c: nextCol } }
            : null,
        );

        scrollCellIntoViewRef.current?.(nextRow, nextCol);

        requestAnimationFrame(() => {
          const nextCell = document.querySelector(
            `td[data-row="${nextRow}"][data-col="${nextCol}"]`,
          );
          nextCell?.focus();
        });
        return;
      }
    },
    [
      engine,
      startEditing,
      editingCell,
      clearSelectedCell,
      handleUndo,
      handleRedo,
      handleFillDown,
    ],
  );

  // ────── Keyboard navigation ──────

  const handleKeyDown = useCallback(
    (event, row, col) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        commitEdit(row, col);
        startEditing(Math.min(row + 1, engine.rows - 1), col);
      } else if (event.key === "Tab") {
        event.preventDefault();
        commitEdit(row, col);
        startEditing(row, Math.min(col + 1, engine.cols - 1));
      } else if (event.key === "Escape") {
        setEditValue(engine.getCell(row, col).raw);
        setEditingCell(null);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        commitEdit(row, col);
        startEditing(Math.min(row + 1, engine.rows - 1), col);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        commitEdit(row, col);
        startEditing(Math.max(row - 1, 0), col);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        commitEdit(row, col);
        if (col > 0) {
          startEditing(row, col - 1);
        } else if (row > 0) {
          startEditing(row - 1, engine.cols - 1);
        }
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        commitEdit(row, col);
        startEditing(row, Math.min(col + 1, engine.cols - 1));
      }
    },
    [engine, commitEdit, startEditing],
  );

  // ────── Formula bar handlers ──────

  const handleFormulaBarKeyDown = useCallback(
    (event) => {
      if (!editingCell) return;
      handleKeyDown(event, editingCell.r, editingCell.c);
    },
    [editingCell, handleKeyDown],
  );

  const handleFormulaBarFocus = useCallback(() => {
    if (selectedCell && !editingCell) {
      setEditingCell(selectedCell);
      setEditValue(engine.getCell(selectedCell.r, selectedCell.c).raw);
    }
  }, [selectedCell, editingCell, engine]);

  const handleFormulaBarChange = useCallback(
    (value) => {
      if (!editingCell && selectedCell) setEditingCell(selectedCell);
      setEditValue(value);
    },
    [editingCell, selectedCell],
  );



  // ────── Formatting toggles ──────

  
const toggleBold = useCallback(() => {
  if (!selectedCell) return;

  const start = selectionRange?.start || selectedCell;
  const end = selectionRange?.end || selectedCell;

  const minRow = Math.min(start.r, end.r);
  const maxRow = Math.max(start.r, end.r);
  const minCol = Math.min(start.c, end.c);
  const maxCol = Math.max(start.c, end.c);

  const currentStyle = getCellStyle(selectedCell.r, selectedCell.c);
  const nextBold = !currentStyle.bold;

  setCellStyles((prev) => {
    const next = { ...prev };

    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const key = `${r},${c}`;
        const style = prev[key] || getCellStyle(r, c);
        next[key] = { ...style, bold: nextBold };
      }
    }

    return next;
  });
}, [selectedCell, selectionRange, getCellStyle]);


  
const toggleItalic = useCallback(() => {
  if (!selectedCell) return;

  const start = selectionRange?.start || selectedCell;
  const end = selectionRange?.end || selectedCell;

  const minRow = Math.min(start.r, end.r);
  const maxRow = Math.max(start.r, end.r);
  const minCol = Math.min(start.c, end.c);
  const maxCol = Math.max(start.c, end.c);

  const currentStyle = getCellStyle(selectedCell.r, selectedCell.c);
  const nextItalic = !currentStyle.italic;

  setCellStyles((prev) => {
    const next = { ...prev };

    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const key = `${r},${c}`;
        const style = prev[key] || getCellStyle(r, c);
        next[key] = { ...style, italic: nextItalic };
      }
    }

    return next;
  });
}, [selectedCell, selectionRange, getCellStyle]);

  
const toggleUnderline = useCallback(() => {
  if (!selectedCell) return;

  const start = selectionRange?.start || selectedCell;
  const end = selectionRange?.end || selectedCell;

  const minRow = Math.min(start.r, end.r);
  const maxRow = Math.max(start.r, end.r);
  const minCol = Math.min(start.c, end.c);
  const maxCol = Math.max(start.c, end.c);

  const currentStyle = getCellStyle(selectedCell.r, selectedCell.c);
  const nextUnderline = !currentStyle.underline;

  setCellStyles((prev) => {
    const next = { ...prev };

    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const key = `${r},${c}`;
        const style = prev[key] || getCellStyle(r, c);
        next[key] = { ...style, underline: nextUnderline };
      }
    }

    return next;
  });
}, [selectedCell, selectionRange, getCellStyle]);



  const changeFontSize = useCallback(
    (size) => {
      if (!selectedCell) return;

      const start = selectionRange?.start || selectedCell;
      const end = selectionRange?.end || selectedCell;

      const minRow = Math.min(start.r, end.r);
      const maxRow = Math.max(start.r, end.r);
      const minCol = Math.min(start.c, end.c);
      const maxCol = Math.max(start.c, end.c);

      setCellStyles((prev) => {
        const next = { ...prev };
        for (let r = minRow; r <= maxRow; r++) {
          for (let c = minCol; c <= maxCol; c++) {
            const key = `${r},${c}`;
            const style = prev[key] || getCellStyle(r, c);
            next[key] = { ...style, fontSize: size };
          }
        }
        return next;
      });
    },
    [selectedCell, selectionRange, getCellStyle],
  );

  const changeAlignment = useCallback(
    (align) => {
      if (!selectedCell) return;

      const start = selectionRange?.start || selectedCell;
      const end = selectionRange?.end || selectedCell;

      const minRow = Math.min(start.r, end.r);
      const maxRow = Math.max(start.r, end.r);
      const minCol = Math.min(start.c, end.c);
      const maxCol = Math.max(start.c, end.c);

      setCellStyles((prev) => {
        const next = { ...prev };
        for (let r = minRow; r <= maxRow; r++) {
          for (let c = minCol; c <= maxCol; c++) {
            const key = `${r},${c}`;
            const style = prev[key] || getCellStyle(r, c);
            next[key] = { ...style, align };
          }
        }
        return next;
      });
    },
    [selectedCell, selectionRange, getCellStyle],
  );

  const changeFontColor = useCallback(
    (color) => {
      if (!selectedCell) return;

      const start = selectionRange?.start || selectedCell;
      const end = selectionRange?.end || selectedCell;

      const minRow = Math.min(start.r, end.r);
      const maxRow = Math.max(start.r, end.r);
      const minCol = Math.min(start.c, end.c);
      const maxCol = Math.max(start.c, end.c);

      setCellStyles((prev) => {
        const next = { ...prev };
        for (let r = minRow; r <= maxRow; r++) {
          for (let c = minCol; c <= maxCol; c++) {
            const key = `${r},${c}`;
            const style = prev[key] || getCellStyle(r, c);
            next[key] = { ...style, color };
          }
        }
        return next;
      });
    },
    [selectedCell, selectionRange, getCellStyle],
  );

  const changeBackgroundColor = useCallback(
    (color) => {
      if (!selectedCell) return;

      const start = selectionRange?.start || selectedCell;
      const end = selectionRange?.end || selectedCell;

      const minRow = Math.min(start.r, end.r);
      const maxRow = Math.max(start.r, end.r);
      const minCol = Math.min(start.c, end.c);
      const maxCol = Math.max(start.c, end.c);

      setCellStyles((prev) => {
        const next = { ...prev };
        for (let r = minRow; r <= maxRow; r++) {
          for (let c = minCol; c <= maxCol; c++) {
            const key = `${r},${c}`;
            const style = prev[key] || getCellStyle(r, c);
            next[key] = { ...style, bg: color };
          }
        }
        return next;
      });
    },
    [selectedCell, selectionRange, getCellStyle],
  );

  // ────── Clear operations ──────



  const clearAllCells = useCallback(() => {
    const used = engine.getUsedRange();
    const changes = [];
    for (let r = used.minRow; r <= used.maxRow; r++) {
      for (let c = used.minCol; c <= used.maxCol; c++) {
        const val = engine.getCell(r, c).raw;
        if (val !== "") {
          changes.push({ row: r, col: c, value: "" });
        }
      }
    }
    if (changes.length > 0) {
      engine.setCells(changes);
    }
    forceRerender();
    setCellStyles({});
    setSelectedCell(null);
    setEditingCell(null);
    setEditValue("");
  }, [engine, forceRerender]);

  // ────── Sample data (fixtures/sales.tsv) ──────

  const loadSample = useCallback(
    (loader) => {
      loader(engine);
      forceRerender();
      setSelectedCell({ r: 0, c: 0 });
      setEditingCell(null);
      setEditValue("");
    },
    [engine, forceRerender],
  );

  // ────── Row / Column operations ──────

  const insertRow = useCallback(() => {
    if (!selectedCell) return;
    engine.insertRow(selectedCell.r + 1);
    forceRerender();
    setSelectedCell({ r: selectedCell.r + 1, c: selectedCell.c });
  }, [selectedCell, engine, forceRerender]);

  const deleteRow = useCallback(() => {
    if (!selectedCell) return;
    engine.deleteRow(selectedCell.r);
    forceRerender();
    setSelectedCell((prev) =>
      prev
        ? {
            r: Math.max(0, Math.min(engine.rows - 1, prev.r - 1)),
            c: prev.c,
          }
        : null,
    );
  }, [selectedCell, engine, forceRerender]);

  const insertColumn = useCallback(() => {
    if (!selectedCell) return;
    engine.insertColumn(selectedCell.c + 1);
    forceRerender();
    setSelectedCell({ r: selectedCell.r, c: selectedCell.c + 1 });
  }, [selectedCell, engine, forceRerender]);

  const deleteColumn = useCallback(() => {
    if (!selectedCell) return;
    engine.deleteColumn(selectedCell.c);
    forceRerender();
    setSelectedCell((prev) =>
      prev
        ? {
            r: prev.r,
            c: Math.max(0, Math.min(engine.cols - 1, prev.c - 1)),
          }
        : null,
    );
  }, [selectedCell, engine, forceRerender]);

  const toggleFreezeRow = useCallback(() => {
    const current = engine.getFrozenRows();
    const next = current > 0 ? 0 : 1;
    engine.setFrozenRows(next, { undoable: true });
    forceRerender();
  }, [engine, forceRerender]);

  const toggleFreezeCol = useCallback(() => {
    const current = engine.getFrozenCols();
    const next = current > 0 ? 0 : 1;
    engine.setFrozenCols(next, { undoable: true });
    forceRerender();
  }, [engine, forceRerender]);

  // ────── Derived state ──────

  const selectedCellStyle = useMemo(() => {
    return selectedCell ? getCellStyle(selectedCell.r, selectedCell.c) : null;
  }, [selectedCell, getCellStyle]);

  const getColumnLabel = useCallback((col) => {
    let label = "";
    let num = col + 1;
    while (num > 0) {
      num--;
      label = String.fromCharCode(65 + (num % 26)) + label;
      num = Math.floor(num / 26);
    }
    return label;
  }, []);

  // ────── Column & Row Resizing (Challenge 3 Task 3.4) ──────

  const handleColResizeMouseDown = useCallback(
    (e, colIndex) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();

      const startX = e.clientX;
      const startWidth = engine.getColWidth(colIndex);
      colResizeRef.current = { colIndex, startX, startWidth, lastWidth: startWidth };
      setResizingCol(colIndex);
      document.body.classList.add("resizing-col");

      const handleMouseMove = (moveEvent) => {
        if (!colResizeRef.current) return;
        const deltaX = moveEvent.clientX - colResizeRef.current.startX;
        const newWidth = Math.max(40, colResizeRef.current.startWidth + deltaX);
        colResizeRef.current.lastWidth = newWidth;
        engine.setColWidth(colResizeRef.current.colIndex, newWidth, { undoable: false });
        forceRerender();
      };

      const handleMouseUp = () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        document.body.classList.remove("resizing-col");
        if (colResizeRef.current) {
          const { colIndex: c, startWidth, lastWidth } = colResizeRef.current;
          colResizeRef.current = null;
          setResizingCol(null);
          if (startWidth !== lastWidth) {
            engine.setColWidth(c, lastWidth, { undoable: true, oldWidth: startWidth });
            forceRerender();
          }
        }
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [engine, forceRerender],
  );

  const handleColAutoFit = useCallback(
    (e, colIndex) => {
      e.stopPropagation();
      e.preventDefault();

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      ctx.font = "13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

      let maxTextWidth = ctx.measureText(getColumnLabel(colIndex)).width + 36;

      const used = engine.getUsedRange();
      for (let r = used.minRow; r <= used.maxRow; r++) {
        const cell = engine.getCell(r, colIndex);
        const text =
          cell.error ||
          (cell.computed !== null && cell.computed !== ""
            ? String(cell.computed)
            : cell.raw) ||
          "";
        if (text) {
          const w = ctx.measureText(text).width;
          if (w > maxTextWidth) maxTextWidth = w;
        }
      }

      const newWidth = Math.min(600, Math.max(50, Math.ceil(maxTextWidth + 24)));
      const oldWidth = engine.getColWidth(colIndex);
      if (newWidth !== oldWidth) {
        engine.setColWidth(colIndex, newWidth, { undoable: true, oldWidth });
        forceRerender();
      }
    },
    [engine, getColumnLabel, forceRerender],
  );

  const handleRowResizeMouseDown = useCallback(
    (e, rowIndex) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();

      const startY = e.clientY;
      const startHeight = engine.getRowHeight(rowIndex);
      rowResizeRef.current = { rowIndex, startY, startHeight, lastHeight: startHeight };
      setResizingRow(rowIndex);
      document.body.classList.add("resizing-row");

      const handleMouseMove = (moveEvent) => {
        if (!rowResizeRef.current) return;
        const deltaY = moveEvent.clientY - rowResizeRef.current.startY;
        const newHeight = Math.max(18, rowResizeRef.current.startHeight + deltaY);
        rowResizeRef.current.lastHeight = newHeight;
        engine.setRowHeight(rowResizeRef.current.rowIndex, newHeight, { undoable: false });
        forceRerender();
      };

      const handleMouseUp = () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        document.body.classList.remove("resizing-row");
        if (rowResizeRef.current) {
          const { rowIndex: r, startHeight, lastHeight } = rowResizeRef.current;
          rowResizeRef.current = null;
          setResizingRow(null);
          if (startHeight !== lastHeight) {
            engine.setRowHeight(r, lastHeight, { undoable: true, oldHeight: startHeight });
            forceRerender();
          }
        }
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [engine, forceRerender],
  );

  const handleRowAutoFit = useCallback(
    (e, rowIndex) => {
      e.stopPropagation();
      e.preventDefault();
      const defaultHeight = 24;
      const oldHeight = engine.getRowHeight(rowIndex);
      if (oldHeight !== defaultHeight) {
        engine.setRowHeight(rowIndex, defaultHeight, { undoable: true, oldHeight });
        forceRerender();
      }
    },
    [engine, forceRerender],
  );

  useEffect(() => {
    return () => {
      document.body.classList.remove("resizing-col");
      document.body.classList.remove("resizing-row");
    };
  }, []);

  // ────── Filter Evaluation (Challenge 2) ──────
  const filterResult = useMemo(() => {
    void version;
    return engine.evaluateFilters(columnFilters);
  }, [engine, columnFilters, version]);

  const hiddenRowSet = useMemo(() => {
    return new Set(filterResult.hiddenRows);
  }, [filterResult.hiddenRows]);

  const handleOpenFilterPopup = useCallback(
    (colIndex, e) => {
      e.stopPropagation();
      if (e.currentTarget) {
        const rect = e.currentTarget.getBoundingClientRect();
        const popupWidth = 280;
        const left = Math.min(
          Math.max(10, rect.left - 120),
          window.innerWidth - popupWidth - 20,
        );
        const top = rect.bottom + 6;
        setFilterPopupPos({ top, left });
      }

      setFilterPopupCol(colIndex);
      setFilterSearch("");

      const existing = columnFilters[colIndex];
      const distinct = engine.getFilterDistinctValues(colIndex);

      if (existing && existing.selectedValues) {
        setFilterTempSelected(new Set(existing.selectedValues));
      } else {
        const allVals = new Set(distinct.values);
        if (distinct.hasBlanks) {
          allVals.add("(Blanks)");
        }
        setFilterTempSelected(allVals);
      }

      if (existing && existing.condition) {
        setFilterTempConditionType(existing.condition.type || "");
        setFilterTempConditionValue(existing.condition.value || "");
      } else {
        setFilterTempConditionType("");
        setFilterTempConditionValue("");
      }
    },
    [engine, columnFilters],
  );

  const handleClearColumnFilter = useCallback((colIndex) => {
    setColumnFilters((prev) => {
      const next = { ...prev };
      delete next[colIndex];
      return next;
    });
    setFilterPopupCol(null);
  }, []);

  const handleClearAllFilters = useCallback(() => {
    setColumnFilters({});
    setFilterPopupCol(null);
  }, []);

  const currentDistinct = useMemo(() => {
    void version;
    if (filterPopupCol === null) return { values: [], hasBlanks: false };
    return engine.getFilterDistinctValues(filterPopupCol);
  }, [engine, filterPopupCol, version]);

  const filteredChecklistValues = useMemo(() => {
    const searchLower = filterSearch.toLowerCase().trim();
    const list = [];
    for (const val of currentDistinct.values) {
      if (!searchLower || String(val).toLowerCase().includes(searchLower)) {
        list.push(val);
      }
    }
    if (currentDistinct.hasBlanks) {
      if (!searchLower || "(blanks)".includes(searchLower)) {
        list.push("(Blanks)");
      }
    }
    return list;
  }, [currentDistinct, filterSearch]);

  const handleApplyFilter = useCallback(() => {
    if (filterPopupCol === null) return;
    const colIndex = filterPopupCol;
    const distinct = engine.getFilterDistinctValues(colIndex);

    const allPossibleVals = [...distinct.values];
    if (distinct.hasBlanks) allPossibleVals.push("(Blanks)");

    const isAllSelected = allPossibleVals.every((val) =>
      filterTempSelected.has(val),
    );
    const hasCondition =
      filterTempConditionType && filterTempConditionType.trim() !== "";

    if (isAllSelected && !hasCondition) {
      setColumnFilters((prev) => {
        const next = { ...prev };
        delete next[colIndex];
        return next;
      });
    } else {
      setColumnFilters((prev) => ({
        ...prev,
        [colIndex]: {
          selectedValues: isAllSelected ? null : Array.from(filterTempSelected),
          searchQuery: filterSearch.trim(),
          condition: hasCondition
            ? {
                type: filterTempConditionType,
                value: filterTempConditionValue,
              }
            : null,
        },
      }));
    }

    setFilterPopupCol(null);
  }, [
    filterPopupCol,
    engine,
    filterTempSelected,
    filterTempConditionType,
    filterTempConditionValue,
    filterSearch,
  ]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        filterPopupRef.current &&
        !filterPopupRef.current.contains(e.target)
      ) {
        setFilterPopupCol(null);
      }
    };
    if (filterPopupCol !== null) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [filterPopupCol]);

  const handleColumnHeaderClick = useCallback(
    (colIndex) => {
      // If user had an existing multi-row selection, sort that selection;
      // otherwise sort the data block (used range with row 1 as header, totals pinned)
      let sortRange = null;
      if (
        selectionRange &&
        Math.abs(selectionRange.end.r - selectionRange.start.r) >= 1
      ) {
        sortRange = {
          startRow: Math.min(selectionRange.start.r, selectionRange.end.r),
          endRow: Math.max(selectionRange.start.r, selectionRange.end.r),
          minCol: Math.min(selectionRange.start.c, selectionRange.end.c),
          maxCol: Math.max(selectionRange.start.c, selectionRange.end.c),
        };
      }

      // Save styles snapshot before sort for single-step undo
      styleUndoStackRef.current.push({ ...cellStyles });
      styleRedoStackRef.current = [];

      const sortResult = engine.sortDataBlock(colIndex, "cycle", {
        range: sortRange,
        visibleRowIndices: filterResult.hasActiveFilters
          ? filterResult.visibleRows
          : null,
      });

      if (sortResult.success) {
        // Remap cell styles to follow moved rows
        if (
          sortResult.oldRowToNewRowMap &&
          sortResult.oldRowToNewRowMap.size > 0
        ) {
          setCellStyles((prev) => {
            const next = {};
            for (const [key, style] of Object.entries(prev)) {
              const [rStr, cStr] = key.split(",");
              const r = parseInt(rStr, 10);
              const c = parseInt(cStr, 10);
              const newR = sortResult.oldRowToNewRowMap.has(r)
                ? sortResult.oldRowToNewRowMap.get(r)
                : r;
              next[`${newR},${c}`] = style;
            }
            return next;
          });
        }
      }

      // Select the column (satisfying Challenge 1: clicking column header selects the whole column)
      const start = { r: 0, c: colIndex };
      const end = { r: engine.rows - 1, c: colIndex };
      selectionAnchorRef.current = start;
      setSelectedCell(start);
      setSelectionRange({ start, end });
      setEditingCell(null);

      forceRerender();
    },
    [engine, selectionRange, cellStyles, filterResult, forceRerender],
  );

  const selectedCellLabel = useMemo(() => {
    if (
      selectionRange &&
      (selectionRange.start.r !== selectionRange.end.r ||
        selectionRange.start.c !== selectionRange.end.c)
    ) {
      const minR = Math.min(selectionRange.start.r, selectionRange.end.r);
      const maxR = Math.max(selectionRange.start.r, selectionRange.end.r);
      const minC = Math.min(selectionRange.start.c, selectionRange.end.c);
      const maxC = Math.max(selectionRange.start.c, selectionRange.end.c);
      return `${getColumnLabel(minC)}${minR + 1}:${getColumnLabel(maxC)}${maxR + 1}`;
    }
    return selectedCell
      ? `${getColumnLabel(selectedCell.c)}${selectedCell.r + 1}`
      : "";
  }, [selectedCell, selectionRange, getColumnLabel]);

  const nameBoxDisplayValue = isEditingNameBox ? nameBoxText : selectedCellLabel;

  // Formula bar shows the raw formula text, not the computed value
  // When editing, show the current editValue; otherwise show the cell's raw content
  // Note: This is different from the cell display, which shows computed values
  const formulaBarValue = editingCell
    ? editValue
    : selectedCell
      ? engine.getCell(selectedCell.r, selectedCell.c).raw
      : "";

  // ────── Virtualization & Sizing State (Challenge 3) ──────
  const scrollRafRef = useRef(null);
  const [scrollState, setScrollState] = useState({
    scrollTop: 0,
    scrollLeft: 0,
    viewportHeight: 600,
    viewportWidth: 1000,
  });

  // ────── Name Box & Far-Origin Navigation (Challenge 3 Task 3.5) ──────

  const scrollCellIntoView = useCallback(
    (row, col) => {
      if (!gridScrollRef.current) return;
      const el = gridScrollRef.current;
      const frozenTop = engine.getRowOffset(engine.getFrozenRows());
      const frozenLeft = engine.getColOffset(engine.getFrozenCols());
      const rowOffset = engine.getRowOffset(row);
      const colOffset = engine.getColOffset(col);
      const rowHeight = engine.getRowHeight(row);
      const colWidth = engine.getColWidth(col);

      const currentTop = el.scrollTop;
      const currentLeft = el.scrollLeft;
      const vpHeight = el.clientHeight || 600;
      const vpWidth = el.clientWidth || 1000;

      // Vertical auto-scroll
      if (rowOffset < currentTop + frozenTop) {
        el.scrollTop = Math.max(0, rowOffset - frozenTop);
      } else if (rowOffset + rowHeight > currentTop + vpHeight) {
        el.scrollTop = Math.max(0, rowOffset + rowHeight - vpHeight);
      }

      // Horizontal auto-scroll
      if (colOffset < currentLeft + frozenLeft) {
        el.scrollLeft = Math.max(0, colOffset - frozenLeft);
      } else if (colOffset + colWidth > currentLeft + vpWidth) {
        el.scrollLeft = Math.max(0, colOffset + colWidth - vpWidth);
      }
    },
    [engine],
  );

  useEffect(() => {
    scrollCellIntoViewRef.current = scrollCellIntoView;
  }, [scrollCellIntoView]);

  const jumpToCell = useCallback(
    (cellStr) => {
      if (!cellStr || typeof cellStr !== "string") return false;
      const trimmed = cellStr.trim().toUpperCase();

      // Range jump (e.g. K2:K100000)
      const rangeMatch = trimmed.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
      if (rangeMatch) {
        const col1 = columnLetterToIndex(rangeMatch[1]);
        const row1 = parseInt(rangeMatch[2], 10) - 1;
        const col2 = columnLetterToIndex(rangeMatch[3]);
        const row2 = parseInt(rangeMatch[4], 10) - 1;

        if (
          row1 < 0 || row1 >= engine.rows || col1 < 0 || col1 >= engine.cols ||
          row2 < 0 || row2 >= engine.rows || col2 < 0 || col2 >= engine.cols
        ) {
          return false;
        }

        if (editingCell) {
          commitEdit(editingCell.r, editingCell.c);
        }

        const start = { r: row1, c: col1 };
        const end = { r: row2, c: col2 };
        setSelectedCell(start);
        selectionAnchorRef.current = start;
        setSelectionRange({ start, end });
        setEditingCell(null);

        if (gridScrollRef.current) {
          const el = gridScrollRef.current;
          const frozenTop = engine.getRowOffset(engine.getFrozenRows());
          const frozenLeft = engine.getColOffset(engine.getFrozenCols());
          const rowOffset = engine.getRowOffset(row1);
          const colOffset = engine.getColOffset(col1);

          el.scrollTop = Math.max(0, rowOffset - frozenTop - 10);
          el.scrollLeft = Math.max(0, colOffset - frozenLeft - 20);
        }

        forceRerender();
        return true;
      }

      // Single cell jump (e.g. AZ5000, J95000)
      const match = trimmed.match(/^([A-Z]+)(\d+)$/);
      if (!match) return false;

      const col = columnLetterToIndex(match[1]);
      const row = parseInt(match[2], 10) - 1;

      if (row < 0 || row >= engine.rows || col < 0 || col >= engine.cols) {
        return false;
      }

      if (editingCell) {
        commitEdit(editingCell.r, editingCell.c);
      }

      const target = { r: row, c: col };
      setSelectedCell(target);
      selectionAnchorRef.current = target;
      setSelectionRange(null);
      setEditingCell(null);

      // Scroll so target cell is positioned directly in view
      if (gridScrollRef.current) {
        const el = gridScrollRef.current;
        const frozenTop = engine.getRowOffset(engine.getFrozenRows());
        const frozenLeft = engine.getColOffset(engine.getFrozenCols());
        const rowOffset = engine.getRowOffset(row);
        const colOffset = engine.getColOffset(col);

        el.scrollTop = Math.max(0, rowOffset - frozenTop - 10);
        el.scrollLeft = Math.max(0, colOffset - frozenLeft - 20);
      }

      forceRerender();
      return true;
    },
    [engine, editingCell, commitEdit, forceRerender],
  );

  const handleNameBoxFocus = useCallback(() => {
    setIsEditingNameBox(true);
    setNameBoxText(selectedCellLabel);
  }, [selectedCellLabel]);

  const handleNameBoxKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        jumpToCell(nameBoxText);
        setIsEditingNameBox(false);
        e.currentTarget.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setIsEditingNameBox(false);
        e.currentTarget.blur();
      }
    },
    [nameBoxText, jumpToCell],
  );

  const handleNameBoxBlur = useCallback(() => {
    setIsEditingNameBox(false);
  }, []);

  const handleGridScroll = useCallback((e) => {
    const target = e.currentTarget;
    const top = target.scrollTop;
    const left = target.scrollLeft;
    const height = target.clientHeight || 600;
    const width = target.clientWidth || 1000;

    if (scrollRafRef.current) {
      cancelAnimationFrame(scrollRafRef.current);
    }

    scrollRafRef.current = requestAnimationFrame(() => {
      setScrollState((prev) => {
        if (
          Math.abs(prev.scrollTop - top) < 2 &&
          Math.abs(prev.scrollLeft - left) < 2 &&
          prev.viewportHeight === height &&
          prev.viewportWidth === width
        ) {
          return prev;
        }
        return {
          scrollTop: top,
          scrollLeft: left,
          viewportHeight: height,
          viewportWidth: width,
        };
      });
    });
  }, []);

  useEffect(() => {
    const el = gridScrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { height, width } = entry.contentRect;
        setScrollState((prev) => ({
          ...prev,
          viewportHeight: height || prev.viewportHeight,
          viewportWidth: width || prev.clientWidth,
        }));
      }
    });
    ro.observe(el);
    if (el.clientHeight && el.clientWidth) {
      setScrollState((prev) => ({
        ...prev,
        viewportHeight: el.clientHeight,
        viewportWidth: el.clientWidth,
      }));
    }
    return () => {
      ro.disconnect();
      if (scrollRafRef.current) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  const visibleRowRange = useMemo(() => {
    void version;
    return engine.getVisibleRowRange(
      scrollState.scrollTop,
      scrollState.viewportHeight,
      8,
    );
  }, [engine, scrollState.scrollTop, scrollState.viewportHeight, version]);

  const visibleColRange = useMemo(() => {
    void version;
    return engine.getVisibleColRange(
      scrollState.scrollLeft,
      scrollState.viewportWidth,
      5,
    );
  }, [engine, scrollState.scrollLeft, scrollState.viewportWidth, version]);

  const frozenRowsCount = useMemo(() => {
    void version;
    return engine.getFrozenRows();
  }, [engine, version]);

  const frozenColsCount = useMemo(() => {
    void version;
    return engine.getFrozenCols();
  }, [engine, version]);

  const frozenRowIndices = useMemo(() => {
    const list = [];
    for (let r = 0; r < Math.min(engine.rows, frozenRowsCount); r++) {
      list.push(r);
    }
    return list;
  }, [engine.rows, frozenRowsCount]);

  const scrollableRowIndices = useMemo(() => {
    const list = [];
    const start = Math.max(frozenRowsCount, visibleRowRange.startIndex);
    const end = Math.min(engine.rows - 1, visibleRowRange.endIndex);
    for (let r = start; r <= end; r++) {
      list.push(r);
    }
    return list;
  }, [frozenRowsCount, visibleRowRange.startIndex, visibleRowRange.endIndex, engine.rows]);

  const frozenColIndices = useMemo(() => {
    const list = [];
    for (let c = 0; c < Math.min(engine.cols, frozenColsCount); c++) {
      list.push(c);
    }
    return list;
  }, [engine.cols, frozenColsCount]);

  const scrollableColIndices = useMemo(() => {
    const list = [];
    const start = Math.max(frozenColsCount, visibleColRange.startIndex);
    const end = Math.min(engine.cols - 1, visibleColRange.endIndex);
    for (let c = start; c <= end; c++) {
      list.push(c);
    }
    return list;
  }, [frozenColsCount, visibleColRange.startIndex, visibleColRange.endIndex, engine.cols]);

  const topSpacerHeight =
    visibleRowRange.startIndex <= frozenRowsCount
      ? 0
      : Math.max(
          0,
          engine.getRowOffset(visibleRowRange.startIndex) -
            engine.getRowOffset(frozenRowsCount),
        );

  const bottomSpacerHeight = Math.max(
    0,
    engine.getTotalGridHeight() - visibleRowRange.endOffset,
  );

  const leftSpacerWidth =
    visibleColRange.startIndex <= frozenColsCount
      ? 0
      : Math.max(
          0,
          engine.getColOffset(visibleColRange.startIndex) -
            engine.getColOffset(frozenColsCount),
        );

  const rightSpacerWidth = Math.max(
    0,
    engine.getTotalGridWidth() - visibleColRange.endOffset,
  );

  const totalColsSpan =
    1 +
    frozenColIndices.length +
    (leftSpacerWidth > 0 ? 1 : 0) +
    scrollableColIndices.length +
    (rightSpacerWidth > 0 ? 1 : 0);

  const renderColHeader = (colIndex, isFrozenCol) => {
    const sortState = engine.getSortState();
    const isSorted = sortState.col === colIndex && sortState.direction !== null;
    const isFiltered = Boolean(columnFilters[colIndex]);
    const colWidth = engine.getColWidth(colIndex);
    const isLastFrozenCol = isFrozenCol && colIndex === frozenColsCount - 1;
    const colStickyLeft = isFrozenCol ? 50 + engine.getColOffset(colIndex) : undefined;

    return (
      <th
        key={colIndex}
        className={`col-header ${isSorted ? "sorted" : ""} ${isFiltered ? "filtered" : ""} ${
          isFrozenCol ? "frozen-col-header" : ""
        } ${isLastFrozenCol ? "freeze-col-divider" : ""}`}
        style={{
          width: `${colWidth}px`,
          minWidth: `${colWidth}px`,
          maxWidth: `${colWidth}px`,
          ...(isFrozenCol
            ? { position: "sticky", top: 0, left: `${colStickyLeft}px`, zIndex: 35 }
            : {}),
        }}
        onClick={() => handleColumnHeaderClick(colIndex)}
        title="Click to sort: Ascending → Descending → Original"
      >
        <span className="col-header-content">
          <span>{getColumnLabel(colIndex)}</span>
          {isSorted && (
            <span
              className="sort-indicator"
              data-direction={sortState.direction}
            >
              {sortState.direction === "asc" ? "▲" : "▼"}
            </span>
          )}
          <button
            type="button"
            className={`col-filter-btn ${isFiltered ? "active" : ""}`}
            onClick={(e) => handleOpenFilterPopup(colIndex, e)}
            title={
              isFiltered
                ? `Filtered (${getColumnLabel(colIndex)}). Click to modify.`
                : `Filter ${getColumnLabel(colIndex)}`
            }
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 16 16"
              fill="currentColor"
            >
              <path d="M1.5 1.5A.5.5 0 0 1 2 1h12a.5.5 0 0 1 .4.8l-4.9 6.125V13.5a.5.5 0 0 1-.2.4l-2 1.5A.5.5 0 0 1 6.5 15V7.925L1.6 1.8a.5.5 0 0 1-.1-.3z" />
            </svg>
          </button>
        </span>
        <div
          className={`col-resize-handle ${resizingCol === colIndex ? "active" : ""}`}
          onMouseDown={(e) => handleColResizeMouseDown(e, colIndex)}
          onDoubleClick={(e) => handleColAutoFit(e, colIndex)}
          title="Drag to resize column, double-click to auto-fit"
        />
      </th>
    );
  };

  const renderCell = (rowIndex, colIndex, isFrozenRow, isFrozenCol) => {
    const colWidth = engine.getColWidth(colIndex);
    const rowHeight = engine.getRowHeight(rowIndex);
    const isSelected = selectedCell?.r === rowIndex && selectedCell?.c === colIndex;

    const rangeStart = selectionRange?.start || selectedCell;
    const rangeEnd = selectionRange?.end || selectedCell;

    const minRow = rangeStart ? Math.min(rangeStart.r, rangeEnd.r) : -1;
    const maxRow = rangeStart ? Math.max(rangeStart.r, rangeEnd.r) : -1;
    const minCol = rangeStart ? Math.min(rangeStart.c, rangeEnd.c) : -1;
    const maxCol = rangeStart ? Math.max(rangeStart.c, rangeEnd.c) : -1;

    const isInRange =
      rangeStart &&
      rowIndex >= minRow &&
      rowIndex <= maxRow &&
      colIndex >= minCol &&
      colIndex <= maxCol;

    const isBottomRight =
      selectedCell &&
      rowIndex === maxRow &&
      colIndex === maxCol &&
      !editingCell;

    const isFillTarget =
      fillPreview &&
      rowIndex >= fillPreview.startRow &&
      rowIndex <= fillPreview.endRow &&
      colIndex >= fillPreview.startCol &&
      colIndex <= fillPreview.endCol;

    const isEditing =
      editingCell?.r === rowIndex &&
      editingCell?.c === colIndex;
    const cellData = engine.getCell(rowIndex, colIndex);
    const style = cellStyles[`${rowIndex},${colIndex}`] || {};
    const rawDisplay = cellData.error
      ? cellData.error
      : cellData.computed !== null && cellData.computed !== ""
        ? String(cellData.computed)
        : cellData.raw;
    const displayValue = !cellData.error && style.numberFormat
      ? formatCellValue(rawDisplay, style.numberFormat)
      : rawDisplay;

    const isLastFrozenRow = isFrozenRow && rowIndex === frozenRowsCount - 1;
    const isLastFrozenCol = isFrozenCol && colIndex === frozenColsCount - 1;
    const rowStickyTop = isFrozenRow ? 28 + engine.getRowOffset(rowIndex) : undefined;
    const colStickyLeft = isFrozenCol ? 50 + engine.getColOffset(colIndex) : undefined;

    let stickyStyle = {};
    let freezeClass = "";
    if (isFrozenRow && isFrozenCol) {
      freezeClass = "frozen-corner";
      stickyStyle = {
        position: "sticky",
        top: `${rowStickyTop}px`,
        left: `${colStickyLeft}px`,
        zIndex: 30,
      };
    } else if (isFrozenRow) {
      freezeClass = "frozen-row";
      stickyStyle = {
        position: "sticky",
        top: `${rowStickyTop}px`,
        zIndex: 20,
      };
    } else if (isFrozenCol) {
      freezeClass = "frozen-col";
      stickyStyle = {
        position: "sticky",
        left: `${colStickyLeft}px`,
        zIndex: 15,
      };
    }

    return (
      <td
        key={colIndex}
        data-row={rowIndex}
        data-col={colIndex}
        tabIndex={0}
        onKeyDown={(e) => handleGridKeyDown(e, rowIndex, colIndex)}
        className={`cell ${freezeClass} ${isLastFrozenRow ? "freeze-row-divider" : ""} ${
          isLastFrozenCol ? "freeze-col-divider" : ""
        } ${isSelected ? "selected" : ""} ${isInRange ? "in-range" : ""} ${
          isFillTarget ? "fill-preview" : ""
        }`}
        style={{
          width: `${colWidth}px`,
          minWidth: `${colWidth}px`,
          maxWidth: `${colWidth}px`,
          height: `${rowHeight}px`,
          background: style.bg || "#ffffff",
          ...stickyStyle,
        }}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          if (
            editingCell &&
            (editingCell.r !== rowIndex || editingCell.c !== colIndex)
          ) {
            commitEdit(editingCell.r, editingCell.c);
          }
          const anchor =
            e.shiftKey && selectionAnchorRef.current
              ? selectionAnchorRef.current
              : { r: rowIndex, c: colIndex };
          selectionAnchorRef.current = anchor;
          isSelectingRef.current = true;
          setSelectedCell({ r: rowIndex, c: colIndex });
          setSelectionRange({
            start: anchor,
            end: { r: rowIndex, c: colIndex },
          });
          setEditingCell(null);
          e.currentTarget.focus();
        }}
        onMouseEnter={() => {
          if (isFillingRef.current && fillSeedRef.current) {
            handleFillDrag(rowIndex, colIndex);
          } else if (
            isSelectingRef.current &&
            selectionAnchorRef.current
          ) {
            setSelectionRange({
              start: selectionAnchorRef.current,
              end: { r: rowIndex, c: colIndex },
            });
          }
        }}
        onDoubleClick={() => handleCellDoubleClick(rowIndex, colIndex)}
      >
        {isEditing ? (
          <input
            autoFocus
            className="cell-input"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => commitEdit(rowIndex, colIndex)}
            onKeyDown={(e) => handleKeyDown(e, rowIndex, colIndex)}
            ref={isSelected ? cellInputRef : undefined}
            style={{
              fontWeight: style.bold ? "bold" : "normal",
              fontStyle: style.italic ? "italic" : "normal",
              textDecoration: style.underline ? "underline" : "none",
              color: style.color || "#202124",
              fontSize: (style.fontSize || 13) + "px",
              textAlign: style.align || "left",
              background: style.bg || "#ffffff",
            }}
          />
        ) : (
          <div
            className={`cell-display align-${style.align || "left"} ${cellData.error ? "error" : ""}`}
            style={{
              fontWeight: style.bold ? "bold" : "normal",
              fontStyle: style.italic ? "italic" : "normal",
              textDecoration: style.underline ? "underline" : "none",
              color: cellData.error
                ? "#d93025"
                : style.color || "#202124",
              fontSize: (style.fontSize || 13) + "px",
            }}
          >
            {displayValue}
          </div>
        )}
        {isBottomRight && (
          <div
            className="fill-handle"
            title="Drag to fill, or double-click to fill down"
            onDoubleClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              handleFillDown();
            }}
            onMouseDown={(e) =>
              handleFillHandleMouseDown(
                e,
                minRow,
                maxRow,
                minCol,
                maxCol,
              )
            }
          />
        )}
      </td>
    );
  };

  const renderRow = (rowIndex, isFrozenRow) => {
    if (filterResult.hasActiveFilters && hiddenRowSet.has(rowIndex)) {
      return null;
    }
    const rowHeight = engine.getRowHeight(rowIndex);
    const isLastFrozenRow = isFrozenRow && rowIndex === frozenRowsCount - 1;
    const rowStickyTop = isFrozenRow ? 28 + engine.getRowOffset(rowIndex) : undefined;

    return (
      <tr key={rowIndex} style={{ height: `${rowHeight}px` }}>
        <td
          className={`row-header ${isFrozenRow ? "frozen-row-header" : ""} ${
            isLastFrozenRow ? "freeze-row-divider" : ""
          }`}
          style={
            isFrozenRow
              ? {
                  position: "sticky",
                  top: `${rowStickyTop}px`,
                  left: 0,
                  zIndex: 35,
                }
              : undefined
          }
          onClick={() => {
            const start = { r: rowIndex, c: 0 };
            const end = { r: rowIndex, c: engine.cols - 1 };
            selectionAnchorRef.current = start;
            setSelectedCell(start);
            setSelectionRange({ start, end });
            setEditingCell(null);
          }}
        >
          {rowIndex + 1}
          <div
            className={`row-resize-handle ${resizingRow === rowIndex ? "active" : ""}`}
            onMouseDown={(e) => handleRowResizeMouseDown(e, rowIndex)}
            onDoubleClick={(e) => handleRowAutoFit(e, rowIndex)}
            title="Drag to resize row height, double-click to reset"
          />
        </td>
        {frozenColIndices.map((colIndex) =>
          renderCell(rowIndex, colIndex, isFrozenRow, true),
        )}
        {leftSpacerWidth > 0 && (
          <td
            className="col-spacer"
            style={{
              width: `${leftSpacerWidth}px`,
              minWidth: `${leftSpacerWidth}px`,
              maxWidth: `${leftSpacerWidth}px`,
            }}
          />
        )}
        {scrollableColIndices.map((colIndex) =>
          renderCell(rowIndex, colIndex, isFrozenRow, false),
        )}
        {rightSpacerWidth > 0 && (
          <td
            className="col-spacer"
            style={{
              width: `${rightSpacerWidth}px`,
              minWidth: `${rightSpacerWidth}px`,
              maxWidth: `${rightSpacerWidth}px`,
            }}
          />
        )}
      </tr>
    );
  };

  // ────── Render ──────

  return (
    <div className="app-wrapper">
      <div className="app-header">
        <h2 className="app-title">📊 Spreadsheet App</h2>
      </div>

      <div className="main-content">
        {/* ── Toolbar ── */}
        <div className="toolbar">
          <div className="toolbar-group">
            <button
              className={`toolbar-btn bold-btn ${selectedCellStyle?.bold ? "active" : ""}`}
              onClick={toggleBold}
              title="Bold"
            >
              B
            </button>
            <button
              className={`toolbar-btn italic-btn ${selectedCellStyle?.italic ? "active" : ""}`}
              onClick={toggleItalic}
              title="Italic"
            >
              I
            </button>
            <button
              className={`toolbar-btn underline-btn ${selectedCellStyle?.underline ? "active" : ""}`}
              onClick={toggleUnderline}
              title="Underline"
            >
              U
            </button>
          </div>

          <div className="toolbar-group">
            <span className="toolbar-label">Size:</span>
            <select
              className="toolbar-select"
              value={selectedCellStyle?.fontSize || 13}
              onChange={(e) => changeFontSize(parseInt(e.target.value))}
            >
              {[8, 10, 11, 12, 13, 14, 16, 18, 20, 24].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="toolbar-group">
            <button
              className={`align-btn ${selectedCellStyle?.align === "left" ? "active" : ""}`}
              onClick={() => changeAlignment("left")}
              title="Align Left"
            >
              ⬤←
            </button>
            <button
              className={`align-btn ${selectedCellStyle?.align === "center" ? "active" : ""}`}
              onClick={() => changeAlignment("center")}
              title="Align Center"
            >
              ⬤
            </button>
            <button
              className={`align-btn ${selectedCellStyle?.align === "right" ? "active" : ""}`}
              onClick={() => changeAlignment("right")}
              title="Align Right"
            >
              ⬤→
            </button>
          </div>

          <div className="toolbar-group">
            <span className="toolbar-label">Text:</span>
            <input
              type="color"
              value={selectedCellStyle?.color || "#000000"}
              onChange={(e) => changeFontColor(e.target.value)}
              title="Font color"
              style={{
                width: "32px",
                height: "32px",
                border: "1px solid #dadce0",
                cursor: "pointer",
                borderRadius: "4px",
              }}
            />
          </div>

          <div className="toolbar-group">
            <span className="toolbar-label">Fill:</span>
            <select
              className="toolbar-select"
              value={selectedCellStyle?.bg || "white"}
              onChange={(e) => changeBackgroundColor(e.target.value)}
            >
              <option value="white">White</option>
              <option value="#ffff99">Yellow</option>
              <option value="#99ffcc">Green</option>
              <option value="#ffcccc">Red</option>
              <option value="#cce5ff">Blue</option>
              <option value="#e0ccff">Purple</option>
              <option value="#ffd9b3">Orange</option>
              <option value="#f0f0f0">Gray</option>
            </select>
          </div>

          <div className="toolbar-group">
            <button
              className="toolbar-btn"
              onClick={handleUndo}
              disabled={!engine.canUndo()}
              title="Undo"
            >
              ↶ Undo
            </button>
            <button
              className="toolbar-btn"
              onClick={handleRedo}
              disabled={!engine.canRedo()}
              title="Redo"
            >
              ↷ Redo
            </button>
          </div>

          <div className="toolbar-group">
            <button
              className="toolbar-btn"
              onClick={insertRow}
              title="Insert Row"
            >
              + Row
            </button>
            <button
              className="toolbar-btn"
              onClick={deleteRow}
              title="Delete Row"
            >
              - Row
            </button>
            <button
              className="toolbar-btn"
              onClick={insertColumn}
              title="Insert Column"
            >
              + Col
            </button>
            <button
              className="toolbar-btn"
              onClick={deleteColumn}
              title="Delete Column"
            >
              - Col
            </button>
          </div>

          <div className="toolbar-group">
            <button
              className={`toolbar-btn ${engine.getFrozenRows() > 0 ? "active" : ""}`}
              onClick={toggleFreezeRow}
              title="Toggle freeze first row (Row 1 stays pinned when scrolling vertically)"
            >
              {engine.getFrozenRows() > 0 ? "❄ Unfreeze Row 1" : "❄ Freeze Row 1"}
            </button>
            <button
              className={`toolbar-btn ${engine.getFrozenCols() > 0 ? "active" : ""}`}
              onClick={toggleFreezeCol}
              title="Toggle freeze first column (Col A stays pinned when scrolling horizontally)"
            >
              {engine.getFrozenCols() > 0 ? "❄ Unfreeze Col A" : "❄ Freeze Col A"}
            </button>
          </div>

          <div className="toolbar-group">
            <button className="toolbar-btn danger" onClick={clearSelectedCell}>
              ✕ Cell
            </button>
            <button className="toolbar-btn danger" onClick={clearAllCells}>
              ✕ All
            </button>
          </div>

          <div className="toolbar-group">
            <button
              className="toolbar-btn"
              onClick={() => loadSample(loadSampleSmall)}
              title="Load fixtures/sales.tsv (33 rows) at A1"
            >
              ⬇ Sample 33
            </button>
            <button
              className="toolbar-btn"
              onClick={() => loadSample(loadSampleLarge)}
              title="Load fixtures/sales-large.tsv (~3,000 rows) at A1"
            >
              ⬇ Sample 3k
            </button>
          </div>

          <div className="toolbar-group">
            <button
              className={`toolbar-btn ai-toggle-btn ${isAiPanelOpen ? "active" : ""}`}
              onClick={() => setIsAiPanelOpen((prev) => !prev)}
              title="Open Ask AI Query Panel (Ctrl+K)"
            >
              ✨ Ask AI (Ctrl+K)
            </button>
          </div>

          {filterResult.hasActiveFilters && (
            <div className="toolbar-group">
              <button
                className="toolbar-btn filter-clear-all-btn"
                onClick={handleClearAllFilters}
                title="Clear all active column filters"
              >
                ✕ Clear all filters ({filterResult.statusText})
              </button>
            </div>
          )}
        </div>

        {/* ── Formula Bar ── */}
        <div className="formula-bar">
          <input
            className="formula-bar-name-box"
            value={nameBoxDisplayValue}
            onChange={(e) => setNameBoxText(e.target.value)}
            onFocus={handleNameBoxFocus}
            onBlur={handleNameBoxBlur}
            onKeyDown={handleNameBoxKeyDown}
            title="Name Box: type a cell coordinate (e.g. AZ5000, J95000) and press Enter to jump"
            placeholder="A1"
          />
          <input
            className="formula-bar-input"
            value={formulaBarValue}
            onChange={(e) => handleFormulaBarChange(e.target.value)}
            onKeyDown={handleFormulaBarKeyDown}
            onFocus={handleFormulaBarFocus}
            placeholder="Select a cell then type, or enter a formula like =SUM(A1:A5)"
          />
        </div>

        {/* ── Workspace Body (Grid + AI Side Panel) ── */}
        <div className="workspace-body">
          <div
            className="grid-scroll"
            ref={gridScrollRef}
            onScroll={handleGridScroll}
          >
          <table className="grid-table">
            <thead>
              <tr>
                <th
                  className={`col-header-blank ${frozenColsCount > 0 ? "freeze-col-divider" : ""}`}
                />
                {frozenColIndices.map((colIndex) =>
                  renderColHeader(colIndex, true),
                )}
                {leftSpacerWidth > 0 && (
                  <th
                    className="col-spacer"
                    style={{
                      width: `${leftSpacerWidth}px`,
                      minWidth: `${leftSpacerWidth}px`,
                      maxWidth: `${leftSpacerWidth}px`,
                    }}
                  />
                )}
                {scrollableColIndices.map((colIndex) =>
                  renderColHeader(colIndex, false),
                )}
                {rightSpacerWidth > 0 && (
                  <th
                    className="col-spacer"
                    style={{
                      width: `${rightSpacerWidth}px`,
                      minWidth: `${rightSpacerWidth}px`,
                      maxWidth: `${rightSpacerWidth}px`,
                    }}
                  />
                )}
              </tr>
            </thead>
            <tbody>
              {frozenRowIndices.map((rowIndex) => renderRow(rowIndex, true))}
              {topSpacerHeight > 0 && (
                <tr
                  className="row-spacer"
                  style={{ height: `${topSpacerHeight}px` }}
                >
                  <td
                    colSpan={totalColsSpan}
                    style={{ height: `${topSpacerHeight}px` }}
                  />
                </tr>
              )}
              {scrollableRowIndices.map((rowIndex) =>
                renderRow(rowIndex, false),
              )}
              {bottomSpacerHeight > 0 && (
                <tr
                  className="row-spacer"
                  style={{ height: `${bottomSpacerHeight}px` }}
                >
                  <td
                    colSpan={totalColsSpan}
                    style={{ height: `${bottomSpacerHeight}px` }}
                  />
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {isAiPanelOpen && (
          <AiPanel
            engine={engine}
            selectedCell={selectedCell}
            selectionRange={selectionRange}
            onClose={() => setIsAiPanelOpen(false)}
            onInsertCells={(changes) => {
              engine.setCells(changes);
              forceRerender();
            }}
            onApplyFormat={handleApplyFormat}
          />
        )}
      </div>

        {/* ── Filter Dropdown Popup Modal ── */}
        {filterPopupCol !== null && (
          <div
            ref={filterPopupRef}
            className="filter-popup"
            style={{
              top: filterPopupPos.top,
              left: filterPopupPos.left,
            }}
          >
            <div className="filter-popup-header">
              <span className="filter-popup-title">
                Filter Column {getColumnLabel(filterPopupCol)}
              </span>
              <button
                type="button"
                className="filter-popup-close"
                onClick={() => setFilterPopupCol(null)}
              >
                ✕
              </button>
            </div>

            {/* Search Box */}
            <div className="filter-section">
              <input
                type="text"
                className="filter-search-input"
                placeholder="Search values..."
                value={filterSearch}
                onChange={(e) => setFilterSearch(e.target.value)}
                autoFocus
              />
            </div>

            {/* Values Checklist */}
            <div className="filter-section">
              <div className="filter-checklist-toolbar">
                <span className="filter-section-subtitle">Values</span>
                <div className="filter-quick-selects">
                  <button
                    type="button"
                    className="filter-link-btn"
                    onClick={() => {
                      const allVals = new Set(currentDistinct.values);
                      if (currentDistinct.hasBlanks) allVals.add("(Blanks)");
                      setFilterTempSelected(allVals);
                    }}
                  >
                    Select All
                  </button>
                  <span className="filter-divider">·</span>
                  <button
                    type="button"
                    className="filter-link-btn"
                    onClick={() => setFilterTempSelected(new Set())}
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="filter-checklist">
                {filteredChecklistValues.length === 0 ? (
                  <div className="filter-checklist-empty">
                    No matching values
                  </div>
                ) : (
                  filteredChecklistValues.map((val) => {
                    const isChecked = filterTempSelected.has(val);
                    return (
                      <label key={val} className="filter-checklist-item">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            setFilterTempSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(val)) next.delete(val);
                              else next.add(val);
                              return next;
                            });
                          }}
                        />
                        <span
                          className={
                            val === "(Blanks)" ? "filter-blank-label" : ""
                          }
                        >
                          {val}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            {/* Condition Filter */}
            <div className="filter-section">
              <span className="filter-section-subtitle">
                Filter by condition
              </span>
              <select
                className="filter-condition-select"
                value={filterTempConditionType}
                onChange={(e) => setFilterTempConditionType(e.target.value)}
              >
                <option value="">None</option>
                <option value="contains">Text contains</option>
                <option value="does not contain">Text does not contain</option>
                <option value="greater than">Greater than (&gt;)</option>
                <option value="less than">Less than (&lt;)</option>
                <option value="is empty">Is empty</option>
                <option value="not empty">Is not empty</option>
              </select>

              {filterTempConditionType &&
                !["is empty", "not empty"].includes(
                  filterTempConditionType,
                ) && (
                  <input
                    type="text"
                    className="filter-condition-input"
                    placeholder="Value..."
                    value={filterTempConditionValue}
                    onChange={(e) =>
                      setFilterTempConditionValue(e.target.value)
                    }
                  />
                )}
            </div>

            {/* Action buttons */}
            <div className="filter-popup-actions">
              <button
                type="button"
                className="filter-btn-clear"
                onClick={() => handleClearColumnFilter(filterPopupCol)}
              >
                Clear filter
              </button>
              <div className="filter-actions-right">
                <button
                  type="button"
                  className="filter-btn-cancel"
                  onClick={() => setFilterPopupCol(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="filter-btn-apply"
                  onClick={handleApplyFilter}
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Status Bar / Footer ── */}
        <div className="app-footer">
          <p className="footer-hint">
            Click a cell to edit · Enter/Tab/Arrow keys to navigate · Formulas:
            =A1+B1 · =SUM(A1:A5) · =AVG(A1:A5) · =MAX(A1:A5) · =MIN(A1:A5)
          </p>
          <div className="footer-badges">
            <div className="grid-dimension-badge" title="Virtualized Grid Dimensions">
              <span>⚡ {engine.rows.toLocaleString()} rows × {engine.cols.toLocaleString()} cols</span>
            </div>
            {filterResult.hasActiveFilters && (
              <div
                className="filter-status-indicator"
                title="Active filter status"
              >
                <span className="filter-status-icon">🔍</span>
                <span>{filterResult.statusText}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
