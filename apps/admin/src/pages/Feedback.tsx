import { useCallback, useEffect, useState } from 'react';
import { feedback as feedbackApi } from '../api/resources';
import type { FeedbackCategory, FeedbackItem, FeedbackStatus } from '../api/types';
import { PageHeader } from '../components/Layout';
import { Badge, EmptyState, Spinner, useToast } from '../components/ui';

/**
 * Customer feedback inbox. Customers send it from the app (Profile / Help ->
 * Send feedback); the API keeps it until someone here marks it read.
 *
 * "Mark as read" is optimistic: the row flips at once and flips back, with
 * a toast, if the API refuses. In the New view a read row stays in place
 * until the next load, so it does not jump out from under the cursor.
 */

type Filter = 'NEW' | 'ALL';

const PAGE_SIZE = 50;

export const CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  APP: 'App',
  DELIVERY: 'Delivery',
  PRODUCTS: 'Products',
  OTHER: 'Other',
};

const dateTime = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Colombo',
});
/** Store-local date and time (Asia/Colombo), e.g. "29 Sept 2026, 10:15". */
export const formatSentAt = (iso: string) => dateTime.format(new Date(iso));

export function Feedback() {
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('NEW');
  const [rows, setRows] = useState<FeedbackItem[] | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status: FeedbackStatus | undefined = filter === 'NEW' ? 'NEW' : undefined;

  const load = useCallback(async () => {
    setRows(null);
    try {
      const result = await feedbackApi.list({ status, page: 1, limit: PAGE_SIZE });
      setRows(result.feedback);
      setPage(1);
      setTotalPages(result.pagination.total_pages);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load feedback.');
      setRows([]);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const result = await feedbackApi.list({ status, page: page + 1, limit: PAGE_SIZE });
      // A row read since the first page may shift pages; skip duplicates.
      setRows((current) => {
        const seen = new Set((current ?? []).map((r) => r.id));
        return [...(current ?? []), ...result.feedback.filter((r) => !seen.has(r.id))];
      });
      setPage(page + 1);
      setTotalPages(result.pagination.total_pages);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load more feedback.');
    } finally {
      setLoadingMore(false);
    }
  }

  async function markRead(item: FeedbackItem) {
    const setStatus = (next: FeedbackStatus) =>
      setRows((current) => current?.map((r) => (r.id === item.id ? { ...r, status: next } : r)) ?? current);

    setStatus('READ');
    try {
      await feedbackApi.setStatus(item.id, 'READ');
    } catch (err) {
      setStatus(item.status);
      toast.error(err instanceof Error ? err.message : 'Could not mark the feedback as read.');
    }
  }

  return (
    <>
      <PageHeader
        title="Feedback"
        description="What customers send from the app's Send feedback screen, newest first."
        actions={
          <div className="segmented" role="group" aria-label="Show">
            {(['NEW', 'ALL'] as Filter[]).map((option) => (
              <button
                key={option}
                type="button"
                className={option === filter ? 'segmented__item is-selected' : 'segmented__item'}
                aria-pressed={option === filter}
                onClick={() => setFilter(option)}
              >
                {option === 'NEW' ? 'New' : 'All'}
              </button>
            ))}
          </div>
        }
      />

      {error ? <p className="field__error">{error}</p> : null}

      {rows === null ? (
        <Spinner label="Loading feedback" />
      ) : rows.length === 0 ? (
        error ? null : (
          <EmptyState
            title={filter === 'NEW' ? 'No new feedback' : 'No feedback yet'}
            message={
              filter === 'NEW'
                ? 'Everything customers have sent has been read.'
                : 'Messages customers send from the app will appear here.'
            }
          />
        )
      ) : (
        <>
          <ul className="feedback-list" aria-label="Customer feedback">
            {rows.map((item) => (
              <FeedbackRow key={item.id} item={item} onMarkRead={() => void markRead(item)} />
            ))}
          </ul>
          {page < totalPages ? (
            <button
              type="button"
              className="button button--ghost"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          ) : null}
        </>
      )}
    </>
  );
}

function FeedbackRow({ item, onMarkRead }: { item: FeedbackItem; onMarkRead(): void }) {
  const isNew = item.status === 'NEW';
  return (
    <li className={isNew ? 'feedback-item is-new' : 'feedback-item'}>
      <div className="feedback-item__meta">
        <span className="cell__primary">{item.full_name || 'Customer'}</span>
        <a className="cell__secondary" href={`tel:${item.phone}`}>
          {item.phone}
        </a>
        <span className="cell__secondary">{formatSentAt(item.created_at)}</span>
      </div>
      <div className="feedback-item__tags">
        <span className="feedback-item__category">{CATEGORY_LABEL[item.category]}</span>
        <Stars rating={item.rating} />
        <Badge tone={isNew ? 'active' : 'muted'}>{isNew ? 'New' : 'Read'}</Badge>
      </div>
      <p className="feedback-item__message">{item.message}</p>
      {isNew ? (
        <div className="row-actions">
          <button type="button" className="button button--ghost button--sm" onClick={onMarkRead}>
            Mark as read
          </button>
        </div>
      ) : null}
    </li>
  );
}

function Stars({ rating }: { rating: number | null }) {
  if (rating === null) return <span className="cell__secondary">No rating</span>;
  return (
    <span className="feedback-item__stars" role="img" aria-label={`${rating} of 5 stars`}>
      {'★'.repeat(rating)}
      <span className="feedback-item__stars-empty">{'★'.repeat(5 - rating)}</span>
    </span>
  );
}
