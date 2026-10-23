/**
 * Pure 1D Size and Offset Index using Prefix Sums and Binary Search.
 * Designed for 100,000+ items with O(log N) offset-to-index resolution.
 * Ground rule: pure logic, no React, no DOM.
 */
export class SizeIndex {
  constructor(count, defaultSize, customSizes = {}) {
    this.count = Math.max(0, count);
    this.defaultSize = defaultSize;
    this.customSizes = { ...customSizes }; // { [index]: size }
    this.prefixSums = new Float64Array(this.count + 1);
    this._rebuildPrefixSums();
  }

  _rebuildPrefixSums() {
    if (this.prefixSums.length !== this.count + 1) {
      this.prefixSums = new Float64Array(this.count + 1);
    }
    let currentOffset = 0;
    this.prefixSums[0] = 0;
    for (let i = 0; i < this.count; i++) {
      const size =
        this.customSizes[i] !== undefined
          ? this.customSizes[i]
          : this.defaultSize;
      currentOffset += size;
      this.prefixSums[i + 1] = currentOffset;
    }
  }

  setCount(newCount) {
    const validCount = Math.max(0, newCount);
    if (validCount === this.count) return;
    this.count = validCount;
    // Prune custom sizes beyond valid count
    for (const key of Object.keys(this.customSizes)) {
      if (Number(key) >= validCount) {
        delete this.customSizes[key];
      }
    }
    this._rebuildPrefixSums();
  }

  getSize(index) {
    if (index < 0 || index >= this.count) return this.defaultSize;
    return this.customSizes[index] !== undefined
      ? this.customSizes[index]
      : this.defaultSize;
  }

  setSize(index, size) {
    if (index < 0 || index >= this.count) return;
    if (size === this.defaultSize) {
      delete this.customSizes[index];
    } else {
      this.customSizes[index] = Math.max(1, size);
    }
    this._rebuildPrefixSums();
  }

  resetSize(index) {
    if (this.customSizes[index] !== undefined) {
      delete this.customSizes[index];
      this._rebuildPrefixSums();
    }
  }

  getCustomSizes() {
    return { ...this.customSizes };
  }

  setCustomSizes(sizes) {
    this.customSizes = sizes ? { ...sizes } : {};
    this._rebuildPrefixSums();
  }

  getTotalSize() {
    return this.prefixSums[this.count] || 0;
  }

  getOffset(index) {
    if (index <= 0) return 0;
    if (index >= this.count) return this.prefixSums[this.count];
    return this.prefixSums[index];
  }

  /**
   * Binary search for the item index containing the given pixel offset.
   * Finds index such that prefixSums[index] <= offset < prefixSums[index + 1].
   * Time complexity: O(log N) — max 17 iterations for 100,000 items.
   *
   * @param {number} offset - Target pixel offset
   * @returns {number} - 0-based item index
   */
  findItemIndexAtOffset(offset) {
    if (offset <= 0 || this.count === 0) return 0;
    if (offset >= this.getTotalSize()) return Math.max(0, this.count - 1);

    let low = 0;
    let high = this.count - 1;
    let result = 0;

    while (low <= high) {
      const mid = (low + high) >> 1;
      const midOffset = this.prefixSums[mid];
      const nextOffset = this.prefixSums[mid + 1];

      if (offset >= midOffset && offset < nextOffset) {
        return mid;
      }
      if (offset < midOffset) {
        high = mid - 1;
      } else {
        result = mid;
        low = mid + 1;
      }
    }
    return Math.min(result, this.count - 1);
  }

  /**
   * Finds the visible item range given a viewport offset and length plus overscan buffer.
   * Runs in O(log N) time using binary search over prefix sums.
   *
   * @param {number} scrollOffset - Current scroll position in pixels
   * @param {number} viewportSize - Visible viewport size in pixels
   * @param {number} [overscan=5] - Number of items to render outside the viewport
   */
  findVisibleRange(scrollOffset, viewportSize, overscan = 5) {
    if (this.count === 0) {
      return {
        startIndex: 0,
        endIndex: -1,
        startOffset: 0,
        endOffset: 0,
        totalSize: 0,
        count: 0,
      };
    }

    const safeScroll = Math.max(0, scrollOffset);
    const startIdx = this.findItemIndexAtOffset(safeScroll);
    const endIdx = this.findItemIndexAtOffset(safeScroll + Math.max(1, viewportSize));

    const boundedStart = Math.max(0, startIdx - overscan);
    const boundedEnd = Math.min(this.count - 1, endIdx + overscan);

    return {
      startIndex: boundedStart,
      endIndex: boundedEnd,
      startOffset: this.getOffset(boundedStart),
      endOffset: this.getOffset(boundedEnd + 1),
      totalSize: this.getTotalSize(),
      count: boundedEnd - boundedStart + 1,
    };
  }

  /**
   * Shifts custom sizes right when an item is inserted at atIndex.
   * Preserves custom sizes and recomputes prefix sums.
   * @param {number} atIndex - Insertion position
   */
  insertItem(atIndex) {
    this.count++;
    const nextCustom = {};
    for (const [key, size] of Object.entries(this.customSizes)) {
      const idx = Number(key);
      if (idx >= atIndex) {
        nextCustom[idx + 1] = size;
      } else {
        nextCustom[idx] = size;
      }
    }
    this.customSizes = nextCustom;
    this._rebuildPrefixSums();
  }

  /**
   * Shifts custom sizes left when an item is deleted at atIndex.
   * @param {number} atIndex - Deletion position
   */
  deleteItem(atIndex) {
    if (this.count <= 1) return;
    this.count--;
    const nextCustom = {};
    for (const [key, size] of Object.entries(this.customSizes)) {
      const idx = Number(key);
      if (idx === atIndex) {
        continue;
      } else if (idx > atIndex) {
        nextCustom[idx - 1] = size;
      } else {
        nextCustom[idx] = size;
      }
    }
    this.customSizes = nextCustom;
    this._rebuildPrefixSums();
  }
}
