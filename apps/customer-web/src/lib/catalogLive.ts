import { API_BASE_URL } from '../api/client';

/** Calls onChange when staff change the catalogue (SSE), and every 30 s as a safety net. */
export function startCatalogLive(onChange: () => void): () => void {
  let es: EventSource | null = null;
  try {
    es = new EventSource(`${API_BASE_URL}/catalog/events`);
    es.addEventListener('catalog', () => onChange());
  } catch { /* no SSE: the poll still runs */ }
  const poll = setInterval(() => { if (!document.hidden) onChange(); }, 30_000);
  return () => { clearInterval(poll); es?.close(); };
}
