import { formatTime } from '../lib/format';

/**
 * The one way the app reports trouble: what happened in the rider's words,
 * how old the information on screen is, and the way forward.
 */
export function Banner({
  message,
  stamp,
  onRetry,
  retryLabel = 'Try again',
}: {
  message: string;
  stamp?: Date | null;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="banner" role="status">
      <p className="banner__message">{message}</p>
      {stamp ? <p className="banner__stamp">Last updated {formatTime(stamp)}</p> : null}
      {onRetry ? (
        <button type="button" className="banner__retry" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
