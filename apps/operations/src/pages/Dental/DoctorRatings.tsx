import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { dental } from '../../api/resources';
import type { DoctorRatingsResult } from '../../api/types';
import { PageHeader } from '../../components/Layout';
import { Badge, EmptyState, Spinner } from '../../components/ui';
import { dentalErrorMessage, formatRating, formatVisitDate } from '../../lib/dental';

/**
 * One doctor's ratings (migration 023): every rating customers left after a
 * visit, hidden ones included, newest first. Hiding an abusive rating takes
 * it out of the doctor's public average and count; "Show" puts it back.
 */
export function DoctorRatings() {
  const { doctorId } = useParams<{ doctorId: string }>();
  const [data, setData] = useState<DoctorRatingsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!doctorId) return;
    try {
      setData(await dental.ratings.listForDoctor(doctorId));
      setError(null);
    } catch (err) {
      setError(dentalErrorMessage(err));
    }
  }, [doctorId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleHidden(id: string, hide: boolean) {
    setBusyId(id);
    try {
      await dental.ratings.setHidden(id, hide);
      setNotice(hide ? 'Rating hidden. It no longer counts towards the doctor’s rating.' : 'Rating shown again.');
      await load();
    } catch (err) {
      setNotice(dentalErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  if (!doctorId) return null;
  const summary = data ? formatRating(data.doctor.rating_average, data.doctor.rating_count) : null;

  return (
    <div className="page">
      <PageHeader
        title={data ? `${data.doctor.full_name} — ratings` : 'Doctor ratings'}
        description={
          data
            ? `${summary ?? 'No visible ratings yet'}${data.hidden_count ? ` · ${data.hidden_count} hidden` : ''}`
            : 'What customers said after their visit.'
        }
        actions={
          <Link className="button button--ghost" to="/catalog/dental/doctors">
            Back to doctors
          </Link>
        }
      />

      {notice ? (
        <p className="field__error" role="status">
          {notice}
          <button type="button" className="field__error-dismiss" onClick={() => setNotice(null)} aria-label="Dismiss">
            ×
          </button>
        </p>
      ) : null}
      {error ? <p className="field__error">{error}</p> : null}

      {data === null ? (
        error ? null : <Spinner label="Loading ratings" />
      ) : data.ratings.length === 0 ? (
        <EmptyState title="No ratings yet" message="Customers can rate a visit once their appointment is over." />
      ) : (
        <ul className="cat-list">
          {data.ratings.map((rating) => (
            <li key={rating.id} className={`cat-row cat-row--flat${rating.is_hidden ? ' is-muted' : ''}`}>
              <div className="cat-row__main">
                <p className="cat-row__title" aria-label={`${rating.stars} out of 5 stars`}>
                  {'★'.repeat(rating.stars)}
                  {'☆'.repeat(5 - rating.stars)}
                </p>
                {rating.comment ? <p className="cat-row__meta">“{rating.comment}”</p> : null}
                <p className="cat-row__meta">
                  {[rating.patient_name, rating.clinic.name, `Visit ${formatVisitDate(rating.visit_at)}`]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {rating.is_hidden ? (
                  <div className="cat-row__badges">
                    <Badge tone="inactive">Hidden</Badge>
                  </div>
                ) : null}
              </div>
              <div className="cat-row__actions">
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  disabled={busyId === rating.id}
                  onClick={() => void toggleHidden(rating.id, !rating.is_hidden)}
                >
                  {rating.is_hidden ? 'Show' : 'Hide'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {data && data.pagination.total > data.ratings.length ? (
        <p className="page__note">
          Showing the newest {data.ratings.length} of {data.pagination.total} ratings.
        </p>
      ) : null}
    </div>
  );
}
