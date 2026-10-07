import { useEffect, useState } from 'react';
import { riders as ridersApi } from '../api/resources';
import type { RiderOption } from '../api/types';
import { PageHeader } from '../components/Layout';
import { EmptyState, Spinner } from '../components/ui';
import { errorMessage } from '../lib/errors';

/**
 * Read-only rider roster (task F7, plan §14, common.md rule 9). Reuses
 * `riders.listActive()` (`GET /admin/riders`) exactly as it already exists
 * for F3's assign-rider dialog picker - the same function, not a new one
 * (verified against `apps/operations/src/api/resources.ts`'s `riders` block
 * and F3's own report before writing this page). Active riders only (the
 * API's own filter), each with the same `open_deliveries` count and
 * `vehicle_type`/`vehicle_registration_number` the assign dialog already
 * shows - this screen is strictly a *view* of the same real data, nothing
 * more.
 *
 * **The backend has no create/activate/deactivate/edit-rider endpoint**
 * (`POST/PATCH /admin/riders*` does not exist anywhere - confirmed against
 * `backend/api/src/modules/admin/index.ts`'s route table, matching plan
 * §14/§26 row D and common.md rule 9), so this screen deliberately offers no
 * such control - no button, no form, no disabled-looking affordance that
 * would imply one exists. The honest note in the page description says so
 * plainly rather than hiding the gap. Rider create/activate/deactivate/edit
 * is deferred future work (plan §26 row D, §29 phase O8) - not attempted
 * here.
 */
export function Riders() {
  const [rows, setRows] = useState<RiderOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    ridersApi
      .listActive()
      .then((list) => {
        if (!cancelled) setRows(list);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(errorMessage(err, 'Could not load riders.'));
        setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page">
      <PageHeader
        title="Riders"
        description="Active riders and their current delivery load. Rider accounts are currently provisioned outside this app."
      />

      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}

      {rows === null ? (
        <Spinner label="Loading riders" />
      ) : rows.length === 0 ? (
        <EmptyState title="No active riders" />
      ) : (
        <ul className="cat-list">
          {rows.map((r) => (
            <li key={r.id} className="cat-row cat-row--flat">
              <div className="cat-row__main">
                <p className="cat-row__title">{r.full_name ?? r.phone ?? 'Rider'}</p>
                <p className="cat-row__meta">
                  {r.vehicle_type} · <span className="mono">{r.vehicle_registration_number}</span>
                </p>
                <p className="cat-row__meta">
                  {r.open_deliveries === 0
                    ? 'No open deliveries'
                    : `${r.open_deliveries} open ${r.open_deliveries === 1 ? 'delivery' : 'deliveries'}`}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
