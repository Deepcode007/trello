import { describe, it, expect } from "bun:test";
import {
  calculateDropPosition,
  reorderArray,
  getDropTargetIndex,
  DEFAULT_POSITION_OFFSET,
  type PositionableItem
} from "../lib/dnd-math";

describe("Step 6: Independent Specification Test — DND Midpoint Math & Ordering Invariants", () => {
  describe("1. Drop Position Invariants", () => {
    it("handles empty list by returning the default initial position offset", () => {
      const pos = calculateDropPosition([], 0);
      expect(pos).toBe(DEFAULT_POSITION_OFFSET);
      expect(pos).toBeGreaterThan(0);
    });

    it("places item before the first element with strictly monotonic position (pos < first.position)", () => {
      const items: PositionableItem[] = [
        { id: "c1", position: 1000 },
        { id: "c2", position: 2000 },
        { id: "c3", position: 3000 }
      ];

      const newPos = calculateDropPosition(items, 0);
      expect(newPos).toBeLessThan(items[0]!.position);
      expect(newPos).toBe(500); // 1000 / 2
    });

    it("places item before first element when first element position is zero or negative", () => {
      const itemsWithZero: PositionableItem[] = [
        { id: "c1", position: 0 },
        { id: "c2", position: 1000 }
      ];
      const posZero = calculateDropPosition(itemsWithZero, 0);
      expect(posZero).toBeLessThan(0);
      expect(posZero).toBe(-1000);

      const itemsWithNegative: PositionableItem[] = [
        { id: "c1", position: -500 },
        { id: "c2", position: 500 }
      ];
      const posNeg = calculateDropPosition(itemsWithNegative, 0);
      expect(posNeg).toBeLessThan(-500);
      expect(posNeg).toBe(-1500);
    });

    it("places item after the last element with strictly monotonic position (pos > last.position)", () => {
      const items: PositionableItem[] = [
        { id: "c1", position: 1000 },
        { id: "c2", position: 2000 },
        { id: "c3", position: 3000 }
      ];

      const newPos = calculateDropPosition(items, 3);
      expect(newPos).toBeGreaterThan(items[items.length - 1]!.position);
      expect(newPos).toBe(4000);
    });

    it("places item after last element even if target index exceeds array length (clamping)", () => {
      const items: PositionableItem[] = [
        { id: "c1", position: 100 }
      ];

      const newPos = calculateDropPosition(items, 999);
      expect(newPos).toBe(1100);
    });

    it("calculates exact midpoint between two adjacent items (prev.position < pos < next.position)", () => {
      const items: PositionableItem[] = [
        { id: "c1", position: 1000 },
        { id: "c2", position: 2000 },
        { id: "c3", position: 3000 }
      ];

      // Insert between c1 (1000) and c2 (2000) -> index 1
      const pos1 = calculateDropPosition(items, 1);
      expect(pos1).toBe(1500);
      expect(pos1).toBeGreaterThan(items[0]!.position);
      expect(pos1).toBeLessThan(items[1]!.position);

      // Insert between c2 (2000) and c3 (3000) -> index 2
      const pos2 = calculateDropPosition(items, 2);
      expect(pos2).toBe(2500);
      expect(pos2).toBeGreaterThan(items[1]!.position);
      expect(pos2).toBeLessThan(items[2]!.position);
    });

    it("correctly excludes the moved item itself when recalculating within same container", () => {
      const items: PositionableItem[] = [
        { id: "c1", position: 1000 },
        { id: "c2", position: 2000 },
        { id: "c3", position: 3000 }
      ];

      // Moving c3 (3000) to top (index 0)
      const newPos = calculateDropPosition(items, 0, "c3");
      expect(newPos).toBe(500);

      // Moving c1 (1000) to bottom (index 2 in available items)
      const endPos = calculateDropPosition(items, 2, "c1");
      expect(endPos).toBe(4000); // 3000 + 1000
    });

    it("handles repeated midpoint divisions with floating-point monotonic integrity", () => {
      let currentItems: PositionableItem[] = [
        { id: "base_0", position: 1000 },
        { id: "base_1", position: 2000 }
      ];

      for (let i = 0; i < 15; i++) {
        const mid = calculateDropPosition(currentItems, 1);
        expect(mid).toBeGreaterThan(currentItems[0]!.position);
        expect(mid).toBeLessThan(currentItems[1]!.position);
        // Insert and test continued monotonicity
        const nextList: PositionableItem[] = [
          currentItems[0]!,
          { id: `inserted_${i}`, position: mid },
          ...currentItems.slice(1)
        ];
        currentItems = nextList.sort((a, b) => a.position - b.position);
      }

      // Verify all items are strictly ascending
      for (let i = 1; i < currentItems.length; i++) {
        expect(currentItems[i]!.position).toBeGreaterThan(currentItems[i - 1]!.position);
      }
    });

    it("defensively handles disordered inputs by sorting ascending before calculating", () => {
      const scrambledItems: PositionableItem[] = [
        { id: "c3", position: 3000 },
        { id: "c1", position: 1000 },
        { id: "c2", position: 2000 }
      ];

      const mid = calculateDropPosition(scrambledItems, 1);
      expect(mid).toBe(1500);
    });

    it("handles defensive fallback when adjacent items have identical positions (data corruption)", () => {
      const duplicatePosItems: PositionableItem[] = [
        { id: "c1", position: 1000 },
        { id: "c2", position: 1000 }
      ];

      const mid = calculateDropPosition(duplicatePosItems, 1);
      expect(mid).toBeGreaterThan(duplicatePosItems[0]!.position);
    });
  });

  describe("2. Array Reordering & Index Helpers", () => {
    it("immutably moves an item forward in an array", () => {
      const list = ["A", "B", "C", "D"];
      const reordered = reorderArray(list, 0, 2);
      expect(reordered).toEqual(["B", "C", "A", "D"]);
      expect(list).toEqual(["A", "B", "C", "D"]); // original intact
    });

    it("immutably moves an item backward in an array", () => {
      const list = ["A", "B", "C", "D"];
      const reordered = reorderArray(list, 3, 1);
      expect(reordered).toEqual(["A", "D", "B", "C"]);
      expect(list).toEqual(["A", "B", "C", "D"]);
    });

    it("handles boundary moves: first to last and last to first", () => {
      const list = [1, 2, 3];
      expect(reorderArray(list, 0, 2)).toEqual([2, 3, 1]);
      expect(reorderArray(list, 2, 0)).toEqual([3, 1, 2]);
    });

    it("finds drop target index correctly with getDropTargetIndex", () => {
      const items = [{ id: "c1" }, { id: "c2" }, { id: "c3" }];
      expect(getDropTargetIndex(items, "c2", "c1")).toBe(1);
      expect(getDropTargetIndex(items, "c1", "c3")).toBe(0);
      expect(getDropTargetIndex(items, "non_existent", "c1")).toBe(3);
    });
  });
});
