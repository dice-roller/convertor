/** Compare serialisable data structurally, independent of property insertion order. */
export function sameData(left: unknown, right: unknown): boolean {
  if (Object.is(left, right) || left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameData(item, right[index]))
    );
  }
  if (
    typeof left !== "object" ||
    left === null ||
    typeof right !== "object" ||
    right === null
  )
    return false;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a).filter((key) => a[key] !== undefined);
  return (
    keys.length ===
      Object.keys(b).filter((key) => b[key] !== undefined).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameData(a[key], b[key]))
  );
}

/** Deterministic bipartite perfect matching, preferring unused columns.
 * Rows are notation positions; columns are stored positions.
 */
export function matchPermutation(
  edges: readonly (readonly boolean[])[],
): number[] | undefined {
  const size = edges.length;
  const owners = Array<number>(size).fill(-1);
  const assigned = Array<number>(size).fill(-1);

  function assign(row: number, seen: Set<number>): boolean {
    const candidates = edges[row];
    if (!candidates) return false;
    for (const [column, allowed] of candidates.entries()) {
      if (allowed && !seen.has(column) && owners[column] === -1) {
        owners[column] = row;
        assigned[row] = column;
        return true;
      }
    }
    for (const [column, allowed] of candidates.entries()) {
      const owner = owners[column];
      if (!allowed || seen.has(column) || owner === undefined || owner < 0)
        continue;
      seen.add(column);
      if (assign(owner, seen)) {
        owners[column] = row;
        assigned[row] = column;
        return true;
      }
    }
    return false;
  }

  for (let row = 0; row < size; row++) {
    if (!assign(row, new Set())) return undefined;
  }
  return assigned;
}
