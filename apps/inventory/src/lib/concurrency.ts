/**
 * Maps over items with at most `limit` calls in flight, keeping the input
 * order in the result. The sourcing queue reads one detail per open order;
 * with 200 open orders, firing 200 requests at once would hammer the API and
 * trip its rate limits, so they go a few at a time instead.
 */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker);
  await Promise.all(workers);
  return results;
}
