/**
 * Offset paging for server-rendered lists.
 *
 * It lives here rather than in each service because all five customer-facing
 * lists page the same way, and a second copy is how two lists end up
 * disagreeing about whether `offset` is a row or a page.
 *
 * The window is applied *after* filtering, so a result's `total` stays the
 * filtered count — what the list's "n rows" line reports and what the pager
 * needs to say "1–10 of 34". Omitting `limit` returns the whole set, which is
 * what every non-paginated caller passes.
 */
export interface PageWindow {
  limit?: number;
  offset?: number;
}

export function page<T>(rows: readonly T[], window: PageWindow = {}): T[] {
  if (window.limit === undefined) return [...rows];
  const offset = Math.max(0, window.offset ?? 0);
  return rows.slice(offset, offset + window.limit);
}
