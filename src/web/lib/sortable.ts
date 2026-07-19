export function moveListItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) {
    return items;
  }

  const next = [...items];
  const [current] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, current!);
  return next;
}

export function withSequentialSortOrder<T extends { sortOrder?: number | null }>(items: T[], step = 10): T[] {
  return items.map((item, index) => ({
    ...item,
    sortOrder: (index + 1) * step,
  }));
}
