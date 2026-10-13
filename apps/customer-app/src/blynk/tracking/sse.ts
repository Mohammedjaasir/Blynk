/*
 * Server-sent events, parsed by hand: the location stream needs an Authorization header, which
 * the browser's EventSource cannot send, so the app reads the response body with fetch.
 * Mirrors Flutter's LocationProvider._onChunk / _applyFrame: frames end at a blank line, CRLF is
 * accepted, comment lines (": heartbeat") are skipped, and a runaway partial frame is dropped.
 */

export type SseEvent = { event: string; data: string };

/** A partial frame longer than this is dropped (Flutter's _maxBufferChars). */
export const MAX_BUFFER_CHARS = 64 * 1024;

/** One frame's text -> its event (default "message") and data, or null for a comment-only frame. */
export function parseFrame(frame: string): SseEvent | null {
  let event = '';
  const data: string[] = [];
  let any = false;
  for (const line of frame.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') { event = value.trim(); any = true; }
    else if (field === 'data') { data.push(value); any = true; }
  }
  return any ? { event: event || 'message', data: data.join('\n') } : null;
}

/** Feed it text chunks as they arrive; it returns the complete events in each. */
export function createSseParser() {
  let buffer = '';
  return {
    push(chunk: string): SseEvent[] {
      let buf = (buffer + chunk).replace(/\r\n/g, '\n');
      const out: SseEvent[] = [];
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const ev = parseFrame(buf.slice(0, idx));
        buf = buf.slice(idx + 2);
        if (ev) out.push(ev);
        else out.push({ event: ':', data: '' }); // a heartbeat still proves the line is alive
      }
      buffer = buf.length > MAX_BUFFER_CHARS ? '' : buf;
      return out;
    },
    reset() { buffer = ''; },
  };
}
