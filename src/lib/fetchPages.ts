/** Supabase range uses zero-based inclusive offsets. Never accept a partial load. */
export async function fetchPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: Error | null }>,
  pageSize = 500,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw error;
    if (!data) throw new Error("A consulta não retornou dados.");
    all.push(...data);
    if (data.length < pageSize) return all;
  }
}
