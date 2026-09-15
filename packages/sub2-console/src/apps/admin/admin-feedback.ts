/** The API client returns plain structured errors, not necessarily Error instances. */
export function adminError(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message || fallback;
  }
  return fallback;
}

/** Exhaust auxiliary selectors without silently accepting a capped first page. */
export async function collectAdminPages<T extends { id: number }>(
  fetchPage: (page: number, pageSize: number) => Promise<{ items: T[]; total: number }>
): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<number>();
  for (let page = 1; ; page++) {
    const response = await fetchPage(page, 100);
    if (!Number.isInteger(response.total) || response.total < 0 || !Array.isArray(response.items)) throw new Error('列表响应不完整，请重试。');
    const previousCount = items.length;
    for (const item of response.items) {
      if (!seen.has(item.id)) { seen.add(item.id); items.push(item); }
    }
    if (items.length >= response.total) return items;
    if (items.length === previousCount) throw new Error('列表未完整返回，请重试。');
  }
}
