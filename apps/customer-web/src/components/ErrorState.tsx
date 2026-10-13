import type { ApiError } from '../api/client';

export default function ErrorState({ error, onRetry, title }: { error: ApiError; onRetry: () => void; title?: string }) {
  const offline = error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT';
  return (
    <div role="alert" style={{ textAlign: 'center', padding: '40px 24px' }}>
      <h3 style={{ fontSize: 18, fontWeight: 600 }}>{offline ? "You're offline" : title ?? "We couldn't load this"}</h3>
      <p style={{ color: 'var(--t2)', marginTop: 6, fontSize: 14 }}>{error.message}</p>
      <button className="big" style={{ marginTop: 18, maxWidth: 220, marginInline: 'auto' }} onClick={onRetry}>Try again</button>
    </div>
  );
}
