import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { sellers as sellersApi } from '../api/resources';
import { PageHeader } from '../components/Layout';
import { Badge, EmptyState, Spinner } from '../components/ui';
import { errorMessage } from '../lib/apiErrors';
import {
  SELLER_STATUSES,
  SELLER_STATUS_LABEL,
  lkr,
  sellerContact,
  sellerStatusTone,
  statusCounts,
  type AdminSeller,
  type SellerStatus,
} from '../lib/sellers';
import './sellers.css';

/**
 * Sellers (seller portal, 2026-10-24). Shops sign up in the seller site with their phone number (or an
 * email and password) and
 * wait here to be approved. Open one to approve, reject or suspend them, set their commission, see
 * what Blynk owes them and record payouts. Their product submissions wait under Seller products.
 */
const when = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Colombo' });

export function Sellers() {
  const [rows, setRows] = useState<AdminSeller[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SellerStatus | 'ALL'>('ALL');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      sellersApi
        .list({ search: search.trim() || undefined })
        .then((r) => {
          if (!live) return;
          setRows(r);
          setError(null);
        })
        .catch((err) => {
          if (!live) return;
          setError(errorMessage(err, 'Could not load the sellers.'));
          setRows([]);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [search]);

  const counts = useMemo(() => statusCounts(rows ?? []), [rows]);
  const shown = (rows ?? []).filter((s) => status === 'ALL' || s.status === status);

  return (
    <>
      <PageHeader
        title="Sellers"
        description="Shops that sell through Blynk. Approve a seller first; then their products wait for your approval under Seller products."
      />

      <div className="sellers__bar">
        <div className="segmented" role="group" aria-label="Show">
          <button
            type="button"
            className={status === 'ALL' ? 'segmented__item is-selected' : 'segmented__item'}
            aria-pressed={status === 'ALL'}
            onClick={() => setStatus('ALL')}
          >
            All ({rows?.length ?? 0})
          </button>
          {SELLER_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              className={status === s ? 'segmented__item is-selected' : 'segmented__item'}
              aria-pressed={status === s}
              onClick={() => setStatus(s)}
            >
              {SELLER_STATUS_LABEL[s]} ({counts[s]})
            </button>
          ))}
        </div>
        <input
          className="input sellers__search"
          type="search"
          aria-label="Search sellers"
          placeholder="Search shop, phone or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}

      {rows === null ? (
        <Spinner label="Loading the sellers" />
      ) : shown.length === 0 ? (
        error ? null : (
          <EmptyState
            title={rows.length === 0 && !search.trim() ? 'No sellers yet' : 'No sellers match'}
            message={rows.length === 0 && !search.trim() ? 'Shops that sign up in the seller site appear here.' : undefined}
          />
        )
      ) : (
        <div className="table-wrap">
          <table className="table" aria-label="Sellers">
            <thead>
              <tr>
                <th scope="col">Shop</th>
                <th scope="col">Phone / email</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">
                  Live products
                </th>
                <th scope="col" className="num">
                  Waiting
                </th>
                <th scope="col" className="num">
                  Commission
                </th>
                <th scope="col" className="num">
                  Due to seller
                </th>
                <th scope="col">Joined</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link className="cell__primary" to={`/sellers/${s.id}`}>
                      {s.shop_name}
                    </Link>
                    {s.full_name || s.contact_name ? <span className="cell__secondary">{s.contact_name ?? s.full_name}</span> : null}
                  </td>
                  <td className="mono">{sellerContact(s)}</td>
                  <td>
                    <Badge tone={sellerStatusTone(s.status)}>{SELLER_STATUS_LABEL[s.status]}</Badge>
                  </td>
                  <td className="num">{s.products_live}</td>
                  <td className="num">
                    {s.submissions_pending > 0 ? (
                      <Link className="sellers__waiting" to={`/seller-products?seller=${s.id}`} aria-label={`${s.submissions_pending} waiting for ${s.shop_name}`}>
                        {s.submissions_pending}
                      </Link>
                    ) : (
                      0
                    )}
                  </td>
                  <td className="num">{Number(s.commission_percent)}%</td>
                  <td className="num">{lkr(s.due)}</td>
                  <td>{when.format(new Date(s.created_at))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
