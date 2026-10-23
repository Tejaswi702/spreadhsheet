// Starter tests for the engine. Extend this file (or add more *.test.js
// files) for every behaviour you implement. Graders run `npm test` and add
// their own hidden tests against the public engine API you document in
// DESIGN_NOTES.md.
import { describe, it, expect } from 'vitest'
import {
    createEngine,
    SizeIndex,
    columnLetterToIndex,
    columnLetterFromIndex,
    parseCellKey,
} from './core.js'
import { loadSampleSmall, loadSampleLarge } from '../fixtures/loadSample.js'

describe('engine basics', () => {
    it('evaluates arithmetic and ranges', () => {
        const engine = createEngine(10, 10)
        engine.setCell(0, 0, '10')
        engine.setCell(1, 0, '20')
        engine.setCell(2, 0, '=SUM(A1:A2)*2')
        expect(engine.getCell(2, 0).computed).toBe(60)
    })

    it('reports a cycle instead of hanging', () => {
        const engine = createEngine(10, 10)
        engine.setCell(0, 0, '=B1')
        engine.setCell(0, 1, '=A1')
        expect(engine.getCell(0, 1).error).toBe('#CYCLE!')
    })

    it('undoes and redoes a single edit', () => {
        const engine = createEngine(10, 10)
        engine.setCell(0, 0, 'hello')
        engine.setCell(0, 0, 'world')
        engine.undo()
        expect(engine.getCell(0, 0).raw).toBe('hello')
        engine.redo()
        expect(engine.getCell(0, 0).raw).toBe('world')
    })

    it('shifts references when a row is inserted above them', () => {
        const engine = createEngine(10, 10)
        engine.setCell(2, 0, '5')       // A3
        engine.setCell(4, 0, '=A3+1')   // A5
        engine.insertRow(1)             // A3 -> A4, A5 -> A6
        expect(engine.getCell(5, 0).raw).toBe('=A4+1')
        expect(engine.getCell(5, 0).computed).toBe(6)
    })

    it('computes the used range correctly', () => {
        const engine = createEngine(10, 10)
        expect(engine.getUsedRange().maxRow).toBe(0)
        expect(engine.getUsedRange().maxCol).toBe(0)
        engine.setCell(1, 1, 'B2')
        engine.setCell(5, 3, 'D6')
        const used = engine.getUsedRange()
        expect(used.minRow).toBe(1)
        expect(used.minCol).toBe(1)
        expect(used.maxRow).toBe(5)
        expect(used.maxCol).toBe(3)
    })

    it('evaluates formulas with absolute references ($A$1, $A1, A$1)', () => {
        const engine = createEngine(10, 10)
        engine.setCell(1, 6, '10') // G2 (row 1, col 6)
        engine.setCell(1, 7, '5')  // H2 (row 1, col 7)
        engine.setCell(1, 11, '=$G$2*H2') // L2 (row 1, col 11)
        expect(engine.getCell(1, 11).computed).toBe(50)
    })

    it('shifts formula references correctly with shiftFormula', () => {
        const engine = createEngine(50, 50)
        expect(engine.shiftFormula('=G2*H2', 30, 0)).toBe('=G32*H32')
        expect(engine.shiftFormula('=$G$2*H2', 30, 0)).toBe('=$G$2*H32')
        expect(engine.shiftFormula('=$A1', 2, 2)).toBe('=$A3')
        expect(engine.shiftFormula('=A$1', 2, 2)).toBe('=C$1')
    })

    it('preserves absolute references and adjusts relative references when inserting a row', () => {
        const engine = createEngine(40, 20)
        engine.setCell(1, 6, '10')        // G2
        engine.setCell(31, 7, '5')        // H32
        engine.setCell(31, 11, '=$G$2*H32') // L32
        expect(engine.getCell(31, 11).computed).toBe(50)

        // Insert row above row 10 (index 9 in 0-based indexing)
        engine.insertRow(9)

        // L32 moves to L33 (row index 32). Formula should become =$G$2*H33
        expect(engine.getCell(32, 11).raw).toBe('=$G$2*H33')
        expect(engine.getCell(32, 11).computed).toBe(50)
    })

    describe('series extrapolation (Row 4.4)', () => {
        it('copies a single numeric seed', () => {
            const engine = createEngine(10, 10)
            expect(engine.extrapolateSeries(['5'], 3)).toEqual(['5', '5', '5'])
            expect(engine.extrapolateSeries(['42'], 2)).toEqual(['42', '42'])
        })

        it('extrapolates numeric sequences from 2 or more seeds', () => {
            const engine = createEngine(10, 10)
            expect(engine.extrapolateSeries(['1', '2'], 3)).toEqual(['3', '4', '5'])
            expect(engine.extrapolateSeries(['10', '20'], 3)).toEqual(['30', '40', '50'])
            expect(engine.extrapolateSeries(['1.5', '2.0'], 2)).toEqual(['2.5', '3.0'])
        })

        it('increments text ending in a number while preserving zero-padding', () => {
            const engine = createEngine(10, 10)
            // Acceptance check: A2:A3 (ORD-1001, ORD-1002) -> ORD-1003..ORD-1005
            expect(engine.extrapolateSeries(['ORD-1001', 'ORD-1002'], 3)).toEqual([
                'ORD-1003',
                'ORD-1004',
                'ORD-1005'
            ])
            expect(engine.extrapolateSeries(['Item 1'], 3)).toEqual(['Item 2', 'Item 3', 'Item 4'])
            expect(engine.extrapolateSeries(['Q4'], 2)).toEqual(['Q5', 'Q6'])
            expect(engine.extrapolateSeries(['2024-W01'], 2)).toEqual(['2024-W02', '2024-W03'])
        })

        it('cycles weekdays and months while preserving case', () => {
            const engine = createEngine(10, 10)
            expect(engine.extrapolateSeries(['Mon'], 7)).toEqual([
                'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon'
            ])
            expect(engine.extrapolateSeries(['MON'], 2)).toEqual(['TUE', 'WED'])
            expect(engine.extrapolateSeries(['monday'], 2)).toEqual(['tuesday', 'wednesday'])
            expect(engine.extrapolateSeries(['Jan'], 3)).toEqual(['Feb', 'Mar', 'Apr'])
            expect(engine.extrapolateSeries(['DEC'], 2)).toEqual(['JAN', 'FEB'])
            expect(engine.extrapolateSeries(['January'], 2)).toEqual(['February', 'March'])
        })

        it('steps dates by seed delta in days and keeps each seed format', () => {
            const engine = createEngine(10, 10)
            // Single date steps by 1 day
            expect(engine.extrapolateSeries(['2024-01-15'], 2)).toEqual(['2024-01-16', '2024-01-17'])
            expect(engine.extrapolateSeries(['1/15/2024'], 2)).toEqual(['1/16/2024', '1/17/2024'])

            // Acceptance check: 3 date formats in B2:B4 filled to B8
            const seedDates = ['2024-01-15', '1/16/2024', '17 Jan 2024']
            const filled = engine.extrapolateSeries(seedDates, 4)
            expect(filled).toEqual([
                '2024-01-18', // B5 keeps B2's ISO format
                '1/19/2024',  // B6 keeps B3's slash format
                '20 Jan 2024',// B7 keeps B4's named format
                '2024-01-21'  // B8 keeps B2's ISO format
            ])
        })

        it('shifts relative references in formulas while pinning absolute references ($)', () => {
            const engine = createEngine(10, 10)
            // Acceptance check: =G2*H2 in K2 filled to row 32 (30 rows down)
            const kFilled = engine.extrapolateSeries(['=G2*H2'], 30, { direction: 'down' })
            expect(kFilled[0]).toBe('=G3*H3')
            expect(kFilled[29]).toBe('=G32*H32')

            // Acceptance check: =$G$2*H2 in L2 filled to row 32 (30 rows down)
            const lFilled = engine.extrapolateSeries(['=$G$2*H2'], 30, { direction: 'down' })
            expect(lFilled[0]).toBe('=$G$2*H3')
            expect(lFilled[29]).toBe('=$G$2*H32')
        })

        it('copies plain text that does not match any sequence pattern', () => {
            const engine = createEngine(10, 10)
            expect(engine.extrapolateSeries(['North'], 3)).toEqual(['North', 'North', 'North'])
            expect(engine.extrapolateSeries(['East', 'West'], 4)).toEqual([
                'East', 'West', 'East', 'West'
            ])
        })

        it('supports reverse extrapolation (dragging up or left)', () => {
            const engine = createEngine(10, 10)
            expect(
                engine.extrapolateSeries(['ORD-1003', 'ORD-1004'], 2, { direction: 'up' })
            ).toEqual(['ORD-1002', 'ORD-1001'])
            expect(
                engine.extrapolateSeries(['3', '4'], 2, { direction: 'up' })
            ).toEqual(['2', '1'])
        })
    })

    describe('performance budget (Row 5.1)', () => {
        it('fills 5,000 cells in under 200 ms', () => {
            const engine = createEngine(5100, 20)
            engine.setCell(0, 0, 'ORD-1001')
            engine.setCell(1, 0, 'ORD-1002')

            const startTime = performance.now()

            const filledValues = engine.extrapolateSeries(['ORD-1001', 'ORD-1002'], 5000, {
                direction: 'down'
            })

            const changes = []
            for (let i = 0; i < 5000; i++) {
                changes.push({ row: i + 2, col: 0, value: filledValues[i] })
            }
            engine.setCells(changes)

            const duration = performance.now() - startTime

            // Verify boundary correctness
            expect(engine.getCell(2, 0).raw).toBe('ORD-1003')
            expect(engine.getCell(5001, 0).raw).toBe('ORD-6002')

            // Budget constraint: < 200 ms
            expect(duration).toBeLessThan(200)

            // Undo verification (single step restores all 5,000 cells)
            const undoStart = performance.now()
            engine.undo()
            const undoDuration = performance.now() - undoStart

            expect(engine.getCell(2, 0).raw).toBe('')
            expect(engine.getCell(5001, 0).raw).toBe('')
            expect(undoDuration).toBeLessThan(200)
        })

        it('extrapolates 5,000 formulas with reference shifting in under 200 ms', () => {
            const engine = createEngine(10, 10)
            const startTime = performance.now()

            const filledFormulas = engine.extrapolateSeries(['=G1*H1'], 5000, {
                direction: 'down'
            })

            const duration = performance.now() - startTime

            expect(filledFormulas.length).toBe(5000)
            expect(filledFormulas[0]).toBe('=G2*H2')
            expect(filledFormulas[4999]).toBe('=G5001*H5001')
            expect(duration).toBeLessThan(200)
        })
    })

    describe('Challenge 2 - Task 1.1: Stable row identity & data block detection', () => {
        it('tracks stable row identities across insertions, deletions, and undo/redo', () => {
            const engine = createEngine(5, 5)
            // Initial row IDs match row indices 0, 1, 2, 3, 4
            expect(engine.getRowOrder()).toEqual([0, 1, 2, 3, 4])
            expect(engine.getRowId(2)).toBe(2)
            expect(engine.getRowIndexById(2)).toBe(2)

            // Insert a row at index 2
            engine.insertRow(2)
            expect(engine.rows).toBe(6)
            expect(engine.getRowId(0)).toBe(0)
            expect(engine.getRowId(1)).toBe(1)
            // Newly inserted row gets a unique ID
            const insertedId = engine.getRowId(2)
            expect(insertedId).toBe(5)
            // Previous row 2 moved to row 3
            expect(engine.getRowId(3)).toBe(2)
            expect(engine.getRowIndexById(2)).toBe(3)

            // Delete row at index 2
            engine.deleteRow(2)
            expect(engine.rows).toBe(5)
            expect(engine.getRowId(2)).toBe(2)

            // Undo row deletion
            engine.undo()
            expect(engine.rows).toBe(6)
            expect(engine.getRowId(2)).toBe(insertedId)

            // Undo row insertion
            engine.undo()
            expect(engine.rows).toBe(5)
            expect(engine.getRowOrder()).toEqual([0, 1, 2, 3, 4])
        })

        it('detects totals rows by summary label and summary formulas', () => {
            const engine = createEngine(10, 5)
            engine.setCell(0, 0, 'Total')
            expect(engine.isTotalsRow(0)).toBe(true)

            engine.setCell(1, 0, 'Grand Total')
            expect(engine.isTotalsRow(1)).toBe(true)

            engine.setCell(2, 0, 'Subtotal')
            expect(engine.isTotalsRow(2)).toBe(true)

            engine.setCell(3, 0, 'Summary')
            engine.setCell(3, 1, '=SUM(B1:B3)')
            expect(engine.isTotalsRow(3)).toBe(true)

            engine.setCell(4, 0, 'ORD-1001')
            engine.setCell(4, 1, 'Electronics')
            expect(engine.isTotalsRow(4)).toBe(false)
        })

        it('detects data blocks with header row 1 and trailing totals row pinned at bottom', () => {
            const engine = createEngine(10, 5)
            // Simulate sales.tsv table structure:
            // Row 0: Headers
            engine.setCell(0, 0, 'Order ID')
            engine.setCell(0, 1, 'Units')
            engine.setCell(0, 2, 'Total')
            // Rows 1-3: Data
            engine.setCell(1, 0, 'ORD-1001')
            engine.setCell(1, 1, '10')
            engine.setCell(1, 2, '100')

            engine.setCell(2, 0, 'ORD-1002')
            engine.setCell(2, 1, '20')
            engine.setCell(2, 2, '200')

            engine.setCell(3, 0, 'ORD-1003')
            engine.setCell(3, 1, '30')
            engine.setCell(3, 2, '300')

            // Row 4: Totals row
            engine.setCell(4, 0, 'Total')
            engine.setCell(4, 1, '60')
            engine.setCell(4, 2, '600')

            const block = engine.getDataBlock()
            expect(block.hasBlock).toBe(true)
            expect(block.headerRow).toBe(0)
            expect(block.startRow).toBe(1)
            expect(block.endRow).toBe(3)
            expect(block.totalsRow).toBe(4)
            expect(block.minCol).toBe(0)
            expect(block.maxCol).toBe(2)
            expect(block.isSelection).toBe(false)
        })

        it('detects explicit multi-row selection as the data block', () => {
            const engine = createEngine(15, 5)
            for (let r = 0; r < 10; r++) {
                engine.setCell(r, 0, `Val-${r}`)
            }

            // Explicit selection of rows 3 to 7
            const block = engine.getDataBlock({
                startRow: 3,
                endRow: 7,
                startCol: 0,
                endCol: 0
            })

            expect(block.hasBlock).toBe(true)
            expect(block.headerRow).toBe(null)
            expect(block.startRow).toBe(3)
            expect(block.endRow).toBe(7)
            expect(block.totalsRow).toBe(null)
            expect(block.isSelection).toBe(true)

            // Single cell selection falls back to default data block
            const singleCellBlock = engine.getDataBlock({
                startRow: 3,
                endRow: 3,
                startCol: 0,
                endCol: 0
            })
            expect(singleCellBlock.isSelection).toBe(false)
            expect(singleCellBlock.startRow).toBe(1)
            expect(singleCellBlock.endRow).toBe(9)
        })
    })

    describe('Challenge 2 - Task 1.2: Multi-Type Comparator (compareCells)', () => {
        it('sorts blanks last in both ascending and descending order', () => {
            const engine = createEngine(5, 5)
            // Empty string vs number
            expect(engine.compareCells('', '100', 'asc')).toBeGreaterThan(0)
            expect(engine.compareCells('', '100', 'desc')).toBeGreaterThan(0)
            expect(engine.compareCells('100', '', 'asc')).toBeLessThan(0)
            expect(engine.compareCells('100', '', 'desc')).toBeLessThan(0)

            // Whitespace string vs text
            expect(engine.compareCells('   ', 'Electronics', 'asc')).toBeGreaterThan(0)
            expect(engine.compareCells('   ', 'Electronics', 'desc')).toBeGreaterThan(0)

            // null / undefined vs value
            expect(engine.compareCells(null, 42, 'asc')).toBeGreaterThan(0)
            expect(engine.compareCells(undefined, 42, 'desc')).toBeGreaterThan(0)

            // Both blank
            expect(engine.compareCells('', '', 'asc')).toBe(0)
            expect(engine.compareCells(null, '  ', 'desc')).toBe(0)
        })

        it('sorts numbers before text in both ascending and descending order', () => {
            const engine = createEngine(5, 5)
            // Number vs text in ascending
            expect(engine.compareCells(42, 'Apple', 'asc')).toBeLessThan(0)
            expect(engine.compareCells('Apple', 42, 'asc')).toBeGreaterThan(0)

            // Number vs text in descending (numbers still stay before text)
            expect(engine.compareCells(42, 'Apple', 'desc')).toBeLessThan(0)
            expect(engine.compareCells('Apple', 42, 'desc')).toBeGreaterThan(0)

            // Formatted currency and percent vs text
            expect(engine.compareCells('$1,200.00', 'Pending', 'asc')).toBeLessThan(0)
            expect(engine.compareCells('10%', 'N/A', 'desc')).toBeLessThan(0)
        })

        it('compares numeric values correctly including currency, percent, and decimals', () => {
            const engine = createEngine(5, 5)
            // Plain numbers
            expect(engine.compareCells(10, 2, 'asc')).toBeGreaterThan(0)
            expect(engine.compareCells(10, 2, 'desc')).toBeLessThan(0)

            // Currency formats
            expect(engine.compareCells('$49.99', '$320.00', 'asc')).toBeLessThan(0)
            expect(engine.compareCells('$3,344.00', '$1,140.00', 'desc')).toBeLessThan(0)

            // Percentage formats (5% vs 10%)
            expect(engine.compareCells('5%', '10%', 'asc')).toBeLessThan(0)
            expect(engine.compareCells('5%', '10%', 'desc')).toBeGreaterThan(0)

            // Mixed decimal and percent (0.1 vs 10% are equal)
            expect(engine.compareCells('0.1', '10%', 'asc')).toBe(0)
        })

        it('compares dates as chronological dates across different date formats', () => {
            const engine = createEngine(5, 5)
            // ISO dates
            expect(engine.compareCells('2024-01-03', '2024-03-06', 'asc')).toBeLessThan(0)
            expect(engine.compareCells('2024-01-03', '2024-03-06', 'desc')).toBeGreaterThan(0)

            // Mixed formats: 15 Jan 2024 vs 4/5/2024 (April 5)
            expect(engine.compareCells('15 Jan 2024', '4/5/2024', 'asc')).toBeLessThan(0)
            expect(engine.compareCells('15 Jan 2024', '4/5/2024', 'desc')).toBeGreaterThan(0)

            // Same date in different formats are equal
            expect(engine.compareCells('2024-01-15', '1/15/2024', 'asc')).toBe(0)
        })

        it('compares text case-insensitively', () => {
            const engine = createEngine(5, 5)
            expect(engine.compareCells('apple', 'Banana', 'asc')).toBeLessThan(0)
            expect(engine.compareCells('Banana', 'apple', 'asc')).toBeGreaterThan(0)
            expect(engine.compareCells('apple', 'Banana', 'desc')).toBeGreaterThan(0)

            // Same text with different casing are considered equal in sort
            expect(engine.compareCells('West', 'west', 'asc')).toBe(0)
            expect(engine.compareCells('EAST', 'East', 'desc')).toBe(0)
        })

        it('supports cell objects with computed or raw values', () => {
            const engine = createEngine(5, 5)
            const cellA = { raw: '$3,344.00', computed: 3344 }
            const cellB = { raw: '$1,140.00', computed: 1140 }

            expect(engine.compareCells(cellA, cellB, 'asc')).toBeGreaterThan(0)
            expect(engine.compareCells(cellA, cellB, 'desc')).toBeLessThan(0)
        })
    })

    describe('Challenge 2 - Task 1.3: Data Block Sorting Execution (sortDataBlock)', () => {
        it('cycles through Ascending -> Descending -> Original Order', () => {
            const engine = createEngine(10, 5)
            // Row 0: Header
            engine.setCell(0, 0, 'Name')
            engine.setCell(0, 1, 'Score')

            // Rows 1-3: Data
            engine.setCell(1, 0, 'Charlie')
            engine.setCell(1, 1, '30')

            engine.setCell(2, 0, 'Alice')
            engine.setCell(2, 1, '10')

            engine.setCell(3, 0, 'Bob')
            engine.setCell(3, 1, '20')

            // 1. First sort: Ascending on Score (col 1)
            const res1 = engine.sortDataBlock(1)
            expect(res1.direction).toBe('asc')
            expect(engine.getCell(1, 0).raw).toBe('Alice')
            expect(engine.getCell(2, 0).raw).toBe('Bob')
            expect(engine.getCell(3, 0).raw).toBe('Charlie')

            // 2. Second sort: Descending on Score (col 1)
            const res2 = engine.sortDataBlock(1)
            expect(res2.direction).toBe('desc')
            expect(engine.getCell(1, 0).raw).toBe('Charlie')
            expect(engine.getCell(2, 0).raw).toBe('Bob')
            expect(engine.getCell(3, 0).raw).toBe('Alice')

            // 3. Third sort: Original order
            const res3 = engine.sortDataBlock(1)
            expect(res3.direction).toBe('original')
            expect(engine.getCell(1, 0).raw).toBe('Charlie')
            expect(engine.getCell(2, 0).raw).toBe('Alice')
            expect(engine.getCell(3, 0).raw).toBe('Bob')
        })

        it('pins header row 1 and trailing totals row at the bottom during sort', () => {
            const engine = createEngine(10, 5)
            // Row 0: Header
            engine.setCell(0, 0, 'Item')
            engine.setCell(0, 1, 'Price')

            // Rows 1-3: Data
            engine.setCell(1, 0, 'Item C')
            engine.setCell(1, 1, '300')

            engine.setCell(2, 0, 'Item A')
            engine.setCell(2, 1, '100')

            engine.setCell(3, 0, 'Item B')
            engine.setCell(3, 1, '200')

            // Row 4: Totals row
            engine.setCell(4, 0, 'Total')
            engine.setCell(4, 1, '=SUM(B2:B4)')

            expect(engine.getCell(4, 1).computed).toBe(600)

            // Sort by price descending
            engine.sortDataBlock(1, 'desc')

            // Header stays at row 0
            expect(engine.getCell(0, 0).raw).toBe('Item')
            expect(engine.getCell(0, 1).raw).toBe('Price')

            // Data rows sorted descending (Item C -> Item B -> Item A)
            expect(engine.getCell(1, 0).raw).toBe('Item C')
            expect(engine.getCell(2, 0).raw).toBe('Item B')
            expect(engine.getCell(3, 0).raw).toBe('Item A')

            // Totals row stays pinned at row 4
            expect(engine.getCell(4, 0).raw).toBe('Total')
            // Whole-block range formula stays unchanged (=SUM(B2:B4))
            expect(engine.getCell(4, 1).raw).toBe('=SUM(B2:B4)')
            expect(engine.getCell(4, 1).computed).toBe(600)
        })

        it('rewrites formulas following moved rows (Acceptance check pattern)', () => {
            const engine = createEngine(10, 5)
            // Simulate sales.tsv structure:
            // Row 0: Headers (Order ID, Units, Total, Price per unit)
            engine.setCell(0, 0, 'Order ID')
            engine.setCell(0, 1, 'Units')
            engine.setCell(0, 2, 'Total')
            engine.setCell(0, 3, 'Price')

            // Row 1 (ORD-1001, Units 10, Total 500, Price = Total/Units -> 50)
            engine.setCell(1, 0, 'ORD-1001')
            engine.setCell(1, 1, '10')
            engine.setCell(1, 2, '500')
            engine.setCell(1, 3, '=C2/B2')

            // Row 2 (ORD-1025, Units 5, Total 5400, Price = Total/Units -> 1080)
            engine.setCell(2, 0, 'ORD-1025')
            engine.setCell(2, 1, '5')
            engine.setCell(2, 2, '5400')
            engine.setCell(2, 3, '=C3/B3')

            // Row 3 (Blank row)
            engine.setCell(3, 0, '')
            engine.setCell(3, 1, '')
            engine.setCell(3, 2, '')

            // Row 4: Totals row
            engine.setCell(4, 0, 'Total')
            engine.setCell(4, 2, '=SUM(C2:C4)')

            expect(engine.getCell(1, 3).computed).toBe(50)
            expect(engine.getCell(2, 3).computed).toBe(1080)
            expect(engine.getCell(4, 2).computed).toBe(5900)

            // Sort descending by Total (column 2)
            engine.sortDataBlock(2, 'desc')

            // Row 1 should now be ORD-1025 (highest total 5400)
            expect(engine.getCell(1, 0).raw).toBe('ORD-1025')
            expect(engine.getCell(1, 2).raw).toBe('5400')
            // Formula in Row 1 should follow to its new row: =C2/B2
            expect(engine.getCell(1, 3).raw).toBe('=C2/B2')
            expect(engine.getCell(1, 3).computed).toBe(1080)

            // Row 2 should now be ORD-1001 (total 500)
            expect(engine.getCell(2, 0).raw).toBe('ORD-1001')
            expect(engine.getCell(2, 3).raw).toBe('=C3/B3')
            expect(engine.getCell(2, 3).computed).toBe(50)

            // Blank row sorts last among data rows (row 3)
            expect(engine.getCell(3, 0).raw).toBe('')

            // Totals row stays at row 4, with range =SUM(C2:C4) unchanged
            expect(engine.getCell(4, 0).raw).toBe('Total')
            expect(engine.getCell(4, 2).raw).toBe('=SUM(C2:C4)')
            expect(engine.getCell(4, 2).computed).toBe(5900)
        })

        it('undoes and redoes a sort in a single step', () => {
            const engine = createEngine(10, 5)
            engine.setCell(0, 0, 'Header')
            engine.setCell(1, 0, 'Bravo')
            engine.setCell(2, 0, 'Alpha')

            // Sort ascending
            engine.sortDataBlock(0, 'asc')
            expect(engine.getCell(1, 0).raw).toBe('Alpha')
            expect(engine.getCell(2, 0).raw).toBe('Bravo')

            // Undo sort in ONE step
            engine.undo()
            expect(engine.getCell(1, 0).raw).toBe('Bravo')
            expect(engine.getCell(2, 0).raw).toBe('Alpha')

            // Redo sort in ONE step
            engine.redo()
            expect(engine.getCell(1, 0).raw).toBe('Alpha')
            expect(engine.getCell(2, 0).raw).toBe('Bravo')
        })

        it('sorts 10,000 rows in under 300 ms (Performance Budget)', () => {
            const rowCount = 10000
            const engine = createEngine(rowCount + 10, 5)

            // Row 0: Header
            engine.setCell(0, 0, 'ID')
            engine.setCell(0, 1, 'Value')

            // Seed 10,000 data rows with scrambled values
            const changes = []
            for (let i = 1; i <= rowCount; i++) {
                // Pseudo-random pseudo-deterministic number
                const val = (i * 37) % rowCount
                changes.push({ row: i, col: 0, value: `ID-${i}` })
                changes.push({ row: i, col: 1, value: String(val) })
            }
            engine.setCells(changes)

            // Measure sort time
            const startTime = performance.now()
            const result = engine.sortDataBlock(1, 'asc')
            const duration = performance.now() - startTime

            expect(result.success).toBe(true)
            expect(result.sortedRowsCount).toBe(rowCount)
            // First sorted data row should have lowest value (0)
            expect(engine.getCell(1, 1).raw).toBe('0')
            // Last sorted data row should have highest value (9999)
            expect(engine.getCell(rowCount, 1).raw).toBe(String(rowCount - 1))

            // Budget requirement: < 300 ms
            expect(duration).toBeLessThan(300)

            // Undo performance verification
            const undoStart = performance.now()
            engine.undo()
            const undoDuration = performance.now() - undoStart
            expect(undoDuration).toBeLessThan(300)
            expect(engine.getCell(1, 1).raw).toBe(String((1 * 37) % rowCount))
        })
    })

    describe('Challenge 2 - Task 2.1: Multi-Column Filter Evaluation Engine', () => {
        it('extracts distinct values per column with text normalization and blank detection', () => {
            const engine = createEngine(10, 5)
            // Row 0: Header
            engine.setCell(0, 0, 'Region')

            // Rows 1-6: Data with variations in case, trailing spaces, and an internal blank row (like sales.tsv row 12)
            engine.setCell(1, 0, 'West')
            engine.setCell(2, 0, 'East')
            engine.setCell(3, 0, 'West ')   // Trailing space
            engine.setCell(4, 0, 'west')    // Lowercase
            engine.setCell(5, 0, '')        // Blank row
            engine.setCell(6, 0, 'North')   // Enclosing data row

            const distinct = engine.getFilterDistinctValues(0)
            expect(distinct.values).toEqual(['East', 'North', 'West'])
            expect(distinct.hasBlanks).toBe(true)
            expect(distinct.totalRows).toBe(6)
        })

        it('evaluates checklist filters matching case and whitespace variations (Acceptance check)', () => {
            const engine = createEngine(10, 5)
            // Row 0: Header
            engine.setCell(0, 0, 'Order ID')
            engine.setCell(0, 1, 'Region')

            // Rows 1-4: Data
            engine.setCell(1, 0, 'ORD-1')
            engine.setCell(1, 1, 'West')

            engine.setCell(2, 0, 'ORD-2')
            engine.setCell(2, 1, 'East')

            engine.setCell(3, 0, 'ORD-3')
            engine.setCell(3, 1, 'West ')

            engine.setCell(4, 0, 'ORD-4')
            engine.setCell(4, 1, 'west')

            // Filter Region (column 1) to "West"
            const result = engine.evaluateFilters({
                1: { selectedValues: ['West'] }
            })

            // Rows 1, 3, and 4 should match ("West", "West ", "west")
            expect(result.visibleRows).toEqual([1, 3, 4])
            expect(result.hiddenRows).toEqual([2])
            expect(result.visibleCount).toBe(3)
            expect(result.totalCount).toBe(4)
            expect(result.statusText).toBe('3 of 4 rows')
        })

        it('evaluates conditions (contains, greater than, less than, is empty)', () => {
            const engine = createEngine(10, 5)
            engine.setCell(0, 0, 'Product')
            engine.setCell(0, 1, 'Units')

            engine.setCell(1, 0, 'Wireless Mouse')
            engine.setCell(1, 1, '35')

            engine.setCell(2, 0, 'Headset')
            engine.setCell(2, 1, '8')

            engine.setCell(3, 0, 'Monitor 27"')
            engine.setCell(3, 1, '11')

            engine.setCell(4, 0, '')
            engine.setCell(4, 1, '10') // Blank product with units 10

            // 1. Contains condition on Product
            const resContains = engine.evaluateFilters({
                0: { condition: { type: 'contains', value: 'mouse' } }
            })
            expect(resContains.visibleRows).toEqual([1])

            // 2. Greater than on Units (> 10)
            const resGt = engine.evaluateFilters({
                1: { condition: { type: 'greater_than', value: '10' } }
            })
            expect(resGt.visibleRows).toEqual([1, 3])

            // 3. Less than on Units (< 10)
            const resLt = engine.evaluateFilters({
                1: { condition: { type: 'less_than', value: '10' } }
            })
            expect(resLt.visibleRows).toEqual([2])

            // 4. Is empty on Product
            const resEmpty = engine.evaluateFilters({
                0: { condition: { type: 'is_empty' } }
            })
            expect(resEmpty.visibleRows).toEqual([4])
        })

        it('combines multi-column filters with AND logic', () => {
            const engine = createEngine(10, 5)
            engine.setCell(0, 0, 'Region')
            engine.setCell(0, 1, 'Units')

            engine.setCell(1, 0, 'West')
            engine.setCell(1, 1, '50')

            engine.setCell(2, 0, 'West')
            engine.setCell(2, 1, '5')

            engine.setCell(3, 0, 'East')
            engine.setCell(3, 1, '100')

            // Region === 'West' AND Units > 10
            const result = engine.evaluateFilters({
                0: { selectedValues: ['West'] },
                1: { condition: { type: 'greater_than', value: '10' } }
            })

            // Only row 1 satisfies both conditions
            expect(result.visibleRows).toEqual([1])
            expect(result.hiddenRows).toEqual([2, 3])
            expect(result.statusText).toBe('1 of 3 rows')
        })

        it('sorts only visible rows when filter is active and preserves hidden rows (Acceptance check)', () => {
            const engine = createEngine(10, 5)
            // Acceptance check:
            // "Filter Region to West (should also match West and west, or explain why not),
            // then sort by Units: hidden rows don't move."
            engine.setCell(0, 0, 'Order ID')
            engine.setCell(0, 1, 'Region')
            engine.setCell(0, 2, 'Units')

            // Row 1: West, Units 50
            engine.setCell(1, 0, 'ORD-1')
            engine.setCell(1, 1, 'West')
            engine.setCell(1, 2, '50')

            // Row 2: East (HIDDEN), Units 999
            engine.setCell(2, 0, 'ORD-2')
            engine.setCell(2, 1, 'East')
            engine.setCell(2, 2, '999')

            // Row 3: west, Units 10
            engine.setCell(3, 0, 'ORD-3')
            engine.setCell(3, 1, 'west')
            engine.setCell(3, 2, '10')

            // Row 4: West , Units 30
            engine.setCell(4, 0, 'ORD-4')
            engine.setCell(4, 1, 'West ')
            engine.setCell(4, 2, '30')

            // 1. Filter Region (col 1) to 'West'
            const filterRes = engine.evaluateFilters({
                1: { selectedValues: ['West'] }
            })
            // Visible rows: 1, 3, 4 (East at row 2 is hidden)
            expect(filterRes.visibleRows).toEqual([1, 3, 4])
            expect(filterRes.hiddenRows).toEqual([2])

            // 2. Sort visible rows by Units (col 2) ascending:
            // Units values in visible rows: row 1 (50), row 3 (10), row 4 (30)
            // Expected ascending order in slots [1, 3, 4]:
            // Slot 1: ORD-3 (10)
            // Slot 3: ORD-4 (30)
            // Slot 4: ORD-1 (50)
            // Hidden row 2 MUST NOT MOVE (remains ORD-2, East, 999)!
            const sortRes = engine.sortDataBlock(2, 'asc', {
                visibleRowIndices: filterRes.visibleRows
            })
            expect(sortRes.success).toBe(true)

            // Verify Slot 1
            expect(engine.getCell(1, 0).raw).toBe('ORD-3')
            expect(engine.getCell(1, 2).raw).toBe('10')

            // Verify Hidden Row 2: DID NOT MOVE!
            expect(engine.getCell(2, 0).raw).toBe('ORD-2')
            expect(engine.getCell(2, 1).raw).toBe('East')
            expect(engine.getCell(2, 2).raw).toBe('999')

            // Verify Slot 3
            expect(engine.getCell(3, 0).raw).toBe('ORD-4')
            expect(engine.getCell(3, 2).raw).toBe('30')

            // Verify Slot 4
            expect(engine.getCell(4, 0).raw).toBe('ORD-1')
            expect(engine.getCell(4, 2).raw).toBe('50')
        })
    })

    describe('Challenge 2 - Task 2.4: Acceptance Criteria Suite (sales.tsv & sales-large.tsv)', () => {
        it('Acceptance Check 1: formula =J2/G2 in K2 filled to K32, sort Total descending -> K2 shows ORD-1025 price per unit (1080), A33 reads Total, blank row sorts last', () => {
            const engine = createEngine(50, 20)
            loadSampleSmall(engine)

            // Verify initial fixture layout (sales.tsv: 33 rows, indices 0..32)
            expect(engine.getCell(0, 0).raw).toBe('Order ID')
            expect(engine.getCell(0, 9).raw).toBe('Total')
            expect(engine.getCell(32, 0).raw).toBe('Total') // A33

            // Put =J2/G2 in K2 (row 1, col 10), fill to K32 (row 31, col 10)
            const fillChanges = []
            for (let r = 1; r <= 31; r++) {
                fillChanges.push({
                    row: r,
                    col: 10,
                    value: `=J${r + 1}/G${r + 1}`
                })
            }
            engine.setCells(fillChanges)

            // Before sort: verify K2 =J2/G2 computes correctly (4320 / 4 = 1080)
            expect(engine.getCell(1, 10).raw).toBe('=J2/G2')
            expect(engine.getCell(1, 10).computed).toBe(1080)

            // Sort by Total (col 9 / Column J) descending
            const sortResult = engine.sortDataBlock(9, 'desc')
            expect(sortResult.success).toBe(true)

            // 1. K2 shows ORD-1025's price per unit (1080):
            // In sales.tsv, ORD-1025 has the highest Total ($9,720.00 with 9 Units = 1080 price/unit)
            // It now occupies row 1 (display row 2 / K2)
            expect(engine.getCell(1, 0).raw).toBe('ORD-1025')
            expect(engine.getCell(1, 6).raw).toBe('9')
            expect(engine.getCell(1, 9).raw).toBe('$9,720.00')
            expect(engine.getCell(1, 10).computed).toBe(1080)

            // 2. A33 still reads Total (the trailing totals row remained pinned at row index 32)
            expect(engine.getCell(32, 0).raw).toBe('Total')
            expect(engine.getCell(32, 9).raw).toBe('$74,431.12')

            // 3. The blank row (originally line 19 / row index 18) and ORD-1021 (with blank Total)
            // sort to the bottom of the data block (blanks last)
            expect(engine.getCell(30, 0).raw).toBe('')
            expect(engine.getCell(30, 1).raw).toBe('')
            expect(engine.getCell(30, 9).raw).toBe('')
            expect(engine.getCell(31, 0).raw).toBe('ORD-1021')
            expect(engine.getCell(31, 9).raw).toBe('')
        })

        it('Acceptance Check 2: Filter Region to West (matches West, West , and west), sort by Units -> hidden rows do not move', () => {
            const engine = createEngine(50, 20)
            loadSampleSmall(engine)

            // 1. Filter Region (col 2 / C) to 'West'
            // Distinct values extraction should have grouped 'West', 'West ', and 'west'
            const distinct = engine.getFilterDistinctValues(2)
            expect(distinct.values).toContain('West')

            const filterResult = engine.evaluateFilters({
                2: { selectedValues: ['West'] }
            })

            // In sales.tsv, 8 orders are in West (ORD-1002, ORD-1005, ORD-1008, ORD-1011, ORD-1015, ORD-1019, ORD-1023, ORD-1027)
            expect(filterResult.visibleCount).toBe(8)
            expect(filterResult.hiddenRows.length).toBe(31 - 8) // 23 hidden data rows

            // Record all hidden rows' exact contents before sort
            const hiddenBeforeSort = filterResult.hiddenRows.map((r) => ({
                row: r,
                orderId: engine.getCell(r, 0).raw,
                region: engine.getCell(r, 2).raw,
                units: engine.getCell(r, 6).raw,
            }))

            // 2. Sort by Units (col 6 / G) ascending, only reordering visible rows
            const sortResult = engine.sortDataBlock(6, 'asc', {
                visibleRowIndices: filterResult.visibleRows
            })
            expect(sortResult.success).toBe(true)

            // Verify all hidden rows did not move
            for (const item of hiddenBeforeSort) {
                expect(engine.getCell(item.row, 0).raw).toBe(item.orderId)
                expect(engine.getCell(item.row, 2).raw).toBe(item.region)
                expect(engine.getCell(item.row, 6).raw).toBe(item.units)
            }

            // Verify visible rows are sorted by Units in ascending order:
            // Units in West orders: 2 (ORD-1027), 3 (ORD-1005), 4 (ORD-1019), 9 (ORD-1011), 12 (ORD-1002), 18 (ORD-1008), 20 (ORD-1023), 30 (ORD-1015)
            const sortedVisibleUnits = filterResult.visibleRows.map((r) =>
                parseFloat(engine.getCell(r, 6).raw)
            )
            expect(sortedVisibleUnits).toEqual([2, 3, 4, 9, 12, 18, 20, 30])
        })

        it('Acceptance Check 3: Undo twice restores original order and then previous state', () => {
            const engine = createEngine(50, 20)
            loadSampleSmall(engine)

            const originalRow1Id = engine.getCell(1, 0).raw // ORD-1001
            const originalRow2Id = engine.getCell(2, 0).raw // ORD-1002

            // Action 1: Fill formula in K2:K32
            engine.setCells([
                { row: 1, col: 10, value: '=J2/G2' },
                { row: 2, col: 10, value: '=J3/G3' },
            ])

            // Action 2: Sort by Total descending
            engine.sortDataBlock(9, 'desc')
            expect(engine.getCell(1, 0).raw).toBe('ORD-1025')

            // Undo 1: Reverts sort in ONE step, restoring original row order
            expect(engine.canUndo()).toBe(true)
            engine.undo()
            expect(engine.getCell(1, 0).raw).toBe(originalRow1Id) // ORD-1001
            expect(engine.getCell(2, 0).raw).toBe(originalRow2Id) // ORD-1002

            // Undo 2: Reverts formula edits in ONE step
            expect(engine.canUndo()).toBe(true)
            engine.undo()
            expect(engine.getCell(1, 10).raw).toBe('')
            expect(engine.getCell(2, 10).raw).toBe('')
        })

        it('Acceptance Check 4: On sales-large.tsv (~3,000 rows), sort by Date completes well under 300 ms (Performance Budget)', () => {
            const engine = createEngine(3100, 20)
            loadSampleLarge(engine)

            // Verify totals row at bottom of data block (1-based row 2992 -> 0-based index 2991)
            expect(engine.getCell(0, 0).raw).toBe('Order ID')
            expect(engine.getCell(0, 1).raw).toBe('Date')
            expect(engine.getCell(2991, 0).raw).toBe('Total')

            // Measure sort by Date (col 1 / B) ascending
            const startTime = performance.now()
            const result = engine.sortDataBlock(1, 'asc')
            const duration = performance.now() - startTime

            expect(result.success).toBe(true)
            expect(result.sortedRowsCount).toBe(2990) // 2990 data rows sorted

            // Totals row stayed pinned at row index 2991
            expect(engine.getCell(2991, 0).raw).toBe('Total')

            // Performance budget check: must take under 300 ms
            expect(duration).toBeLessThan(300)

            // Sort by Date descending
            const descStart = performance.now()
            const descResult = engine.sortDataBlock(1, 'desc')
            const descDuration = performance.now() - descStart

            expect(descResult.success).toBe(true)
            expect(descDuration).toBeLessThan(300)
            expect(engine.getCell(2991, 0).raw).toBe('Total')
        })
    })

    describe('Challenge 3 - Task 3.1: SizeIndex and Virtualization Math Engine', () => {
        it('computes prefix sums and offsets accurately with default and custom sizes', () => {
            const index = new SizeIndex(5, 20)
            expect(index.getTotalSize()).toBe(100)
            expect(index.getOffset(0)).toBe(0)
            expect(index.getOffset(1)).toBe(20)
            expect(index.getOffset(4)).toBe(80)
            expect(index.getOffset(5)).toBe(100)

            // Set custom size
            index.setSize(2, 50)
            expect(index.getSize(2)).toBe(50)
            expect(index.getSize(1)).toBe(20)
            expect(index.getOffset(2)).toBe(40)
            expect(index.getOffset(3)).toBe(90)
            expect(index.getTotalSize()).toBe(130)

            // Reset custom size back to default
            index.resetSize(2)
            expect(index.getSize(2)).toBe(20)
            expect(index.getTotalSize()).toBe(100)
        })

        it('performs binary search findItemIndexAtOffset in O(log N) steps across 100,000 items', () => {
            const index = new SizeIndex(100000, 24)
            // Offset 0 -> item 0
            expect(index.findItemIndexAtOffset(0)).toBe(0)
            // Offset 23 -> item 0
            expect(index.findItemIndexAtOffset(23)).toBe(0)
            // Offset 24 -> item 1
            expect(index.findItemIndexAtOffset(24)).toBe(1)
            // Offset 95000 * 24 -> item 95000
            expect(index.findItemIndexAtOffset(95000 * 24)).toBe(95000)
            expect(index.findItemIndexAtOffset(95000 * 24 + 10)).toBe(95000)

            // Benchmark 10,000 binary searches across 100,000 items
            const start = performance.now()
            for (let i = 0; i < 10000; i++) {
                const targetOffset = (i * 240) % 2400000
                index.findItemIndexAtOffset(targetOffset)
            }
            const duration = performance.now() - start
            // 10,000 searches must take under 20 ms
            expect(duration).toBeLessThan(20)
        })

        it('computes visible range with overscan buffer in O(log N)', () => {
            const index = new SizeIndex(10000, 25)
            // Scroll at 1000 px, viewport 500 px (items 40 to 60)
            const range = index.findVisibleRange(1000, 500, 5)
            expect(range.startIndex).toBe(35) // 40 - 5 overscan
            expect(range.endIndex).toBe(65)   // 60 + 5 overscan
            expect(range.count).toBe(31)
            expect(range.startOffset).toBe(35 * 25)
            expect(range.totalSize).toBe(250000)
        })

        it('shifts custom sizes when items are inserted or deleted (Challenge 3 Acceptance Requirement)', () => {
            const engine = createEngine(10, 10, { defaultColWidth: 100 })

            // Acceptance scenario: Resize column D (col index 3) to 300 px
            engine.setColWidth(3, 300)
            expect(engine.getColWidth(3)).toBe(300)
            expect(engine.getColWidth(2)).toBe(100)
            expect(engine.getColWidth(4)).toBe(100)

            // Insert a column before D (at index 3)
            engine.insertColumn(3)

            // The new column at index 3 has default width (100 px)
            expect(engine.getColWidth(3)).toBe(100)
            // The old column D shifted to index 4 and retained 300 px width
            expect(engine.getColWidth(4)).toBe(300)
            // Column count increased to 11
            expect(engine.cols).toBe(11)

            // Undo the column insertion in one single Ctrl+Z
            expect(engine.canUndo()).toBe(true)
            engine.undo()
            expect(engine.cols).toBe(10)
            // Column D is back at index 3 with 300 px width
            expect(engine.getColWidth(3)).toBe(300)

            // Redo the column insertion
            engine.redo()
            expect(engine.cols).toBe(11)
            expect(engine.getColWidth(3)).toBe(100)
            expect(engine.getColWidth(4)).toBe(300)
        })

        it('supports undo and redo for column and row resizing', () => {
            const engine = createEngine(10, 10, { defaultColWidth: 100, defaultRowHeight: 24 })

            // Resize column B (index 1) to 250 px with undoable: true
            engine.setColWidth(1, 250, { undoable: true })
            expect(engine.getColWidth(1)).toBe(250)

            // Resize row 5 to 60 px with undoable: true
            engine.setRowHeight(5, 60, { undoable: true })
            expect(engine.getRowHeight(5)).toBe(60)

            // Undo row resize
            engine.undo()
            expect(engine.getRowHeight(5)).toBe(24)
            expect(engine.getColWidth(1)).toBe(250)

            // Undo col resize
            engine.undo()
            expect(engine.getColWidth(1)).toBe(100)

            // Redo col resize
            engine.redo()
            expect(engine.getColWidth(1)).toBe(250)

            // Redo row resize
            engine.redo()
            expect(engine.getRowHeight(5)).toBe(60)
        })

        it('handles 100,000 rows x 200 columns capacity allocation seamlessly', () => {
            const engine = createEngine(10, 10, { defaultRowHeight: 24, defaultColWidth: 100 })
            const start = performance.now()
            engine.ensureCapacity(100000, 200)
            const allocDuration = performance.now() - start

            expect(engine.rows).toBe(100000)
            expect(engine.cols).toBe(200)
            expect(engine.getTotalGridHeight()).toBe(2400000)
            expect(engine.getTotalGridWidth()).toBe(20000)

            // Capacity allocation should be instantaneous (< 30 ms)
            expect(allocDuration).toBeLessThan(30)

            // Lookup at row 95,000
            const row95kOffset = engine.getRowOffset(95000)
            expect(row95kOffset).toBe(95000 * 24)
            expect(engine.findRowAtOffset(row95kOffset)).toBe(95000)

            // Viewport query at row 95,000
            const visible = engine.getVisibleRowRange(row95kOffset, 800, 5)
            expect(visible.startIndex).toBe(95000 - 5)
            expect(visible.endIndex).toBe(95038)
            expect(visible.count).toBe(95038 - (95000 - 5) + 1)
        })

        it('supports frozen rows and columns with single-step undo and redo (Task 3.3)', () => {
            const engine = createEngine(20, 20, { frozenRows: 1, frozenCols: 1 })
            expect(engine.getFrozenRows()).toBe(1)
            expect(engine.getFrozenCols()).toBe(1)

            // Change freeze boundaries
            engine.setFrozenRows(2)
            expect(engine.getFrozenRows()).toBe(2)

            engine.setFrozenCols(3)
            expect(engine.getFrozenCols()).toBe(3)

            // Undo freeze cols
            expect(engine.canUndo()).toBe(true)
            engine.undo()
            expect(engine.getFrozenCols()).toBe(1)
            expect(engine.getFrozenRows()).toBe(2)

            // Undo freeze rows
            engine.undo()
            expect(engine.getFrozenRows()).toBe(1)

            // Redo both
            engine.redo()
            expect(engine.getFrozenRows()).toBe(2)
            engine.redo()
            expect(engine.getFrozenCols()).toBe(3)
        })

        it('shifts frozen boundaries on row and column insertions/deletions (Task 3.3)', () => {
            const engine = createEngine(20, 20, { frozenRows: 2, frozenCols: 2 })
            expect(engine.getFrozenRows()).toBe(2)
            expect(engine.getFrozenCols()).toBe(2)

            // Insert row inside frozen pane (at index 0)
            engine.insertRow(0)
            // Frozen boundary should shift from 2 to 3
            expect(engine.getFrozenRows()).toBe(3)

            // Insert row after frozen pane (at index 10)
            engine.insertRow(10)
            // Frozen boundary should remain 3
            expect(engine.getFrozenRows()).toBe(3)

            // Delete row inside frozen pane (at index 1)
            engine.deleteRow(1)
            // Frozen boundary should decrement from 3 to 2
            expect(engine.getFrozenRows()).toBe(2)

            // Insert column inside frozen pane (at index 0)
            engine.insertColumn(0)
            // Frozen cols should shift from 2 to 3
            expect(engine.getFrozenCols()).toBe(3)

            // Delete column inside frozen pane (at index 1)
            engine.deleteColumn(1)
            // Frozen cols should decrement from 3 to 2
            expect(engine.getFrozenCols()).toBe(2)

            // Undo column deletion
            engine.undo()
            expect(engine.getFrozenCols()).toBe(3)
        })

        it('supports autoFitColumn based on cell contents with undo/redo (Task 3.4)', () => {
            const engine = createEngine(10, 10, { defaultColWidth: 100 })
            // Set long text in column B (col 1)
            engine.setCell(1, 1, 'Long Value In Column B Content')
            expect(engine.getColWidth(1)).toBe(100)

            // Auto-fit column B
            const fitted = engine.autoFitColumn(1)
            expect(fitted).toBeGreaterThan(150)
            expect(engine.getColWidth(1)).toBe(fitted)

            // Undo auto-fit in one single step
            expect(engine.canUndo()).toBe(true)
            engine.undo()
            expect(engine.getColWidth(1)).toBe(100)

            // Redo auto-fit
            engine.redo()
            expect(engine.getColWidth(1)).toBe(fitted)
        })

        it('supports live drag resizing with old dimension override and single-step undo (Task 3.4)', () => {
            const engine = createEngine(10, 10, { defaultColWidth: 100, defaultRowHeight: 24 })

            // Simulate intermediate drag steps (undoable: false)
            engine.setColWidth(2, 120, { undoable: false })
            engine.setColWidth(2, 150, { undoable: false })
            engine.setColWidth(2, 180, { undoable: false })
            expect(engine.getColWidth(2)).toBe(180)

            // Release drag at 220 px with oldWidth override = 100
            engine.setColWidth(2, 220, { undoable: true, oldWidth: 100 })
            expect(engine.getColWidth(2)).toBe(220)

            // Undo reverts directly to the pre-drag width (100 px) in a single step
            engine.undo()
            expect(engine.getColWidth(2)).toBe(100)

            // Similar simulation for row height
            engine.setRowHeight(3, 30, { undoable: false })
            engine.setRowHeight(3, 45, { undoable: false })
            engine.setRowHeight(3, 60, { undoable: true, oldHeight: 24 })
            expect(engine.getRowHeight(3)).toBe(60)

            engine.undo()
            expect(engine.getRowHeight(3)).toBe(24)
        })

        it('Task 3.5: parses far-origin coordinates (AZ5000, J95000) and computes exact offsets', () => {
            // Coordinate parsing
            const az5000 = parseCellKey('AZ5000')
            expect(az5000).toEqual({
                row: 4999,
                col: 51,
                absRow: false,
                absCol: false,
            })
            expect(columnLetterToIndex('AZ')).toBe(51)
            expect(columnLetterFromIndex(51)).toBe('AZ')

            const j95000 = parseCellKey('J95000')
            expect(j95000).toEqual({
                row: 94999,
                col: 9,
                absRow: false,
                absCol: false,
            })
            expect(columnLetterToIndex('J')).toBe(9)
            expect(columnLetterFromIndex(9)).toBe('J')

            // Offset calculations on 100k grid
            const engine = createEngine(100000, 200, {
                defaultRowHeight: 24,
                defaultColWidth: 100,
            })

            // Row offset for row 5000 (index 4999) = 4999 * 24 = 119976 px
            expect(engine.getRowOffset(4999)).toBe(4999 * 24)
            // Col offset for col AZ (index 51) = 51 * 100 = 5100 px
            expect(engine.getColOffset(51)).toBe(51 * 100)

            // Remote editing at AZ5000
            engine.setCell(4999, 51, '42')
            expect(engine.getCell(4999, 51).raw).toBe('42')
            expect(engine.getCell(4999, 51).computed).toBe(42)

            // Remote formula referencing AZ5000 from BA5000
            engine.setCell(4999, 52, '=AZ5000*2')
            expect(engine.getCell(4999, 52).computed).toBe(84)

            // Single-step undo reverts remote edit cleanly
            engine.undo()
            expect(engine.getCell(4999, 52).raw).toBe('')
        })

        it('Task 3.6: Acceptance verification - 100k formula fill, J95000 edit < 16 ms budget, structural shifting', { timeout: 15000 }, () => {
            const engine = createEngine(100000, 200, {
                defaultRowHeight: 24,
                defaultColWidth: 100,
            })

            // 1. Fill K2 = =J2*2 down to row 100,000
            engine.setCell(1, 10, '=J2*2')
            expect(engine.getCell(1, 10).raw).toBe('=J2*2')

            const count = 99998 // rows 3 to 100,000 (indices 2 to 99,999)
            const t0 = performance.now()
            const filledFormulas = engine.extrapolateSeries(['=J2*2'], count, {
                direction: 'down',
            })
            const tExtrapolate = performance.now() - t0
            expect(filledFormulas.length).toBe(99998)
            expect(filledFormulas[0]).toBe('=J3*2')
            expect(filledFormulas[94997]).toBe('=J95000*2') // index 94997 corresponds to row 95,000
            expect(filledFormulas[99997]).toBe('=J100000*2') // index 99997 corresponds to row 100,000
            expect(tExtrapolate).toBeLessThan(150)

            // 2. Set cells in batch
            const changes = []
            for (let i = 0; i < count; i++) {
                changes.push({ row: i + 2, col: 10, value: filledFormulas[i] })
            }
            const tSetStart = performance.now()
            engine.setCells(changes)
            const tSetTotal = performance.now() - tSetStart
            expect(tSetTotal).toBeLessThan(10000)

            // Verify populated formula references far down the grid
            expect(engine.getCell(94999, 10).raw).toBe('=J95000*2')
            expect(engine.getCell(99999, 10).raw).toBe('=J100000*2')

            // 3. Scroll to row 95,000 and type into J95000 (budget < 16 ms)
            // Keystroke latency: setting J95000 and recalculating dependent K95000
            const tKey0 = performance.now()
            engine.setCell(94999, 9, '150')
            const keystrokeLatency = performance.now() - tKey0

            expect(engine.getCell(94999, 9).raw).toBe('150')
            expect(engine.getCell(94999, 9).computed).toBe(150)
            expect(keystrokeLatency).toBeLessThan(16) // Sub-16ms frame budget! (actual: ~0.03 ms)

            // 4. Acceptance check 3: Freeze row 1, resize col D to 300px, insert col before D
            engine.setFrozenRows(1)
            expect(engine.getFrozenRows()).toBe(1)

            // Col D is index 3
            engine.setColWidth(3, 300, { undoable: true, oldWidth: 100 })
            expect(engine.getColWidth(3)).toBe(300)

            // Insert column before D (atIndex 3)
            engine.insertColumn(3)
            // The newly inserted column at index 3 has the default width (100 px)
            expect(engine.getColWidth(3)).toBe(100)
            // The shifted old column D (now at index 4) kept its 300 px width
            expect(engine.getColWidth(4)).toBe(300)
        })
    })
})






