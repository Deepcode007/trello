/**
 * Utility functions for Kanban drag-and-drop position calculations and array manipulation.
 * Implements midpoint position math with collision avoidance and boundary safety.
 */

export interface PositionableItem {
  id?: string;
  position: number;
}

/**
 * Default initial spacing offset for newly created or empty list items.
 */
export const DEFAULT_POSITION_OFFSET = 1000;

/**
 * Calculates a new floating-point position for an item dropped at targetIndex within a list.
 *
 * @param items List of existing items with positions
 * @param targetIndex Target index where the item is being inserted (0-indexed)
 * @param excludeId Optional ID of the item being moved (to exclude from calculation if already in list)
 * @returns Monotonic floating-point position that places the item at targetIndex
 */
export function calculateDropPosition(
  items: PositionableItem[],
  targetIndex: number,
  excludeId?: string
): number {
  // Exclude the item being moved if present
  const availableItems = excludeId
    ? items.filter(item => item.id !== excludeId)
    : [...items];

  // If the target list is empty, assign default initial offset
  if (availableItems.length === 0) {
    return DEFAULT_POSITION_OFFSET;
  }

  // Sort ascending by position
  const sorted = [...availableItems].sort((a, b) => a.position - b.position);

  // Clamp target index
  const clampedIndex = Math.max(0, Math.min(targetIndex, sorted.length));

  // Case 1: Dropped at the beginning (before first item)
  if (clampedIndex === 0) {
    const firstItem = sorted[0];
    const firstPos = firstItem ? firstItem.position : DEFAULT_POSITION_OFFSET;
    if (firstPos > 0) {
      return firstPos / 2;
    }
    // If first item position is <= 0, subtract standard offset
    return firstPos - DEFAULT_POSITION_OFFSET;
  }

  // Case 2: Dropped at the very end (after last item)
  if (clampedIndex >= sorted.length) {
    const lastItem = sorted[sorted.length - 1];
    const lastPos = lastItem ? lastItem.position : 0;
    return lastPos + DEFAULT_POSITION_OFFSET;
  }

  // Case 3: Dropped between two existing items
  const prevItem = sorted[clampedIndex - 1];
  const nextItem = sorted[clampedIndex];
  const prevPos = prevItem ? prevItem.position : 0;
  const nextPos = nextItem ? nextItem.position : prevPos + DEFAULT_POSITION_OFFSET;

  // Defensive: if prev and next have identical or descending positions (data corruption)
  if (nextPos <= prevPos) {
    return prevPos + 0.5;
  }

  // Midpoint calculation
  return (prevPos + nextPos) / 2;
}

/**
 * Immutably moves an item within an array from startIndex to endIndex.
 */
export function reorderArray<T>(list: T[], startIndex: number, endIndex: number): T[] {
  const result = Array.from(list);
  const [removed] = result.splice(startIndex, 1);
  if (removed !== undefined) {
    result.splice(endIndex, 0, removed);
  }
  return result;
}

/**
 * Finds the index at which an item should be placed when dropped over an element.
 */
export function getDropTargetIndex<T extends { id: string }>(
  items: T[],
  overId: string,
  activeId: string
): number {
  const overIndex = items.findIndex(item => item.id === overId);
  if (overIndex === -1) {
    return items.length;
  }
  const activeIndex = items.findIndex(item => item.id === activeId);
  if (activeIndex !== -1 && activeIndex < overIndex) {
    return overIndex;
  }
  return overIndex;
}
