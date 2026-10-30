import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { sellerApplications as applicationsApi } from '../../api/sellerApplications';
import { sellerPayoutRequests, sellers as sellersApi } from '../../api/sellers';
import { PageHeader } from '../../components/Layout';
import { EmptyState, Spinner } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import {
  SELLER_STATUSES,
  SELLER_STATUS_LABEL,
  approvedPoint,
  commissionText,
  dayText,
  lkr,
  locationWaiting,
  newSellerBody,
  payoutRequesters,
  phoneInUseText,
  sellerContact,
  statusCounts,
  type AdminSeller,
  type NewSellerForm,
  type SellerStatus,
} from '../../lib/sellers';
import { readAddSellerState, type AddSellerPrefill } from '../../lib/sellerApplications';
import { productsLiveText } from '../../lib/sellerShop';
import { BackToMore, Sheet, SellerStatusPill, TextField } from './parts';
import './sellers.css';

/**
 * More -> Sellers (owner, 2026-10-25: the seller admin inside Ops; same API as Admin's Sellers page).
 * Sellers are invite-only: staff add each shop with the phone it signs in with (an SMS code on the
 * seller site). Each card shows the status, what is waiting (products, a shop location, a payout
 * request) and what Blynk owes; open one to decide, set the commission and pay. Their product submissions wait under Seller products.
 * "Add as seller" on a seller application (2026-10-27) lands here with the Add seller sheet open and the shop,
 * name and phone filled in (router state); once the seller is added the application is marked Approved.
 */
export function Sellers() {
  const navigate = useNavigate();
  const location = useLocation();
  const [prefill, setPrefill] = useState<AddSellerPrefill | null>(() => readAddSellerState(location.state));
  const [rows, setRows] = useState<AdminSeller[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SellerStatus | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(prefill !== null);

  // The prefill is used once: a reload or a Back does not reopen the sheet.
  useEffect(() => {
    if (readAddSellerState(location.state)) navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Badge: a waiting payout request (migration 057). An extra: a failure
  // (or the API before the migration) just shows no badges.
  useEffect(() => {
    let live = true;
    sellerPayoutRequests
      .list({ status: 'REQUESTED' })
      .then((requests) => live && setOpen(payoutRequesters(requests)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const counts = useMemo(() => statusCounts(rows ?? []), [rows]);
  const shown = (rows ?? []).filter((s) => status === 'ALL' || s.status === status);
  const searching = search.trim() !== '';

  return (
    <div className="page">
      <BackToMore />
      <PageHeader title="Sellers" description="Shops that sell through Blynk. Add a shop with the phone number it signs in with; its products then wait for your approval under Seller products." />

      <div className="sellers-toolbar">
        <button type="button" className="button button--ink" onClick={() => setAdding(true)}>
          Add seller
        </button>
        <Link className="button" to="/more/seller-products">
          Seller products
        </Link>
        <Link className="button" to="/more/seller-commission">
          Seller commission
        </Link>
      </div>

      <input
        className="input sellers-search"
        type="search"
        aria-label="Search sellers"
        placeholder="Search shop, phone or email"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="segmented sellers-filters" role="group" aria-label="Show sellers">
        <button type="button" className={status === 'ALL' ? 'segmented__item is-selected' : 'segmented__item'} aria-pressed={status === 'ALL'} onClick={() => setStatus('ALL')}>
          All ({rows?.length ?? 0})
        </button>
        {SELLER_STATUSES.map((s) => (
          <button key={s} type="button" className={status === s ? 'segmented__item is-selected' : 'segmented__item'} aria-pressed={status === s} onClick={() => setStatus(s)}>
            {SELLER_STATUS_LABEL[s]} ({counts[s]})
          </button>
        ))}
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
            title={rows.length === 0 && !searching ? 'No sellers yet' : 'No sellers match'}
            message={rows.length === 0 && !searching ? 'Add a shop with "Add seller"; it signs in on the seller site with that phone number.' : undefined}
          />
        )
      ) : (
        <ul className="cat-list" aria-label="Sellers">
          {shown.map((s) => (
            <SellerCard key={s.id} seller={s} payoutWaiting={open.has(s.id)} />
          ))}
        </ul>
      )}

      {adding ? (
        <AddSellerSheet
          initial={prefill}
          onClose={() => {
            setAdding(false);
            setPrefill(null);
          }}
          onAdded={(s) => {
            setAdding(false);
            if (prefill) void applicationsApi.update(prefill.application_id, { status: 'APPROVED' }).catch(() => undefined);
            setPrefill(null);
            setRows((r) => [s, ...(r ?? [])]);
            navigate(`/more/sellers/${s.id}`);
          }}
        />
      ) : null}
    </div>
  );
}

function SellerCard({ seller: s, payoutWaiting }: { seller: AdminSeller; payoutWaiting: boolean }) {
  const person = s.contact_name ?? s.full_name;
  return (
    <li className="card" aria-label={`Seller ${s.shop_name}`}>
      <div className="sellers-card__head">
        <Link className="sellers-card__title" to={`/more/sellers/${s.id}`}>
          {s.shop_name}
        </Link>
        <SellerStatusPill status={s.status} />
      </div>
      <p className="sellers-card__meta">
        {person ? `${person} · ` : ''}
        <span className="mono">{sellerContact(s)}</span>
      </p>
      <p className="sellers-card__meta">
        {productsLiveText(s.products_live, s.products_total)} · commission {commissionText(s.commission_percent)} · due {lkr(s.due)} · joined {dayText(s.created_at)}
      </p>
      <ul className="sellers-chips" aria-label="Waiting">
        {s.submissions_pending > 0 ? (
          <li>
            <Link className="sellers-chip sellers-chip--waiting" to={`/more/seller-products?seller=${s.id}`} aria-label={`${s.submissions_pending} waiting for ${s.shop_name}`}>
              {s.submissions_pending} waiting
            </Link>
          </li>
        ) : null}
        {locationWaiting(s) ? (
          <li>
            <span className="sellers-chip sellers-chip--waiting">Location waiting</span>
          </li>
        ) : !approvedPoint(s) ? (
          <li>
            <span className="sellers-chip">No location</span>
          </li>
        ) : null}
        {payoutWaiting ? (
          <li>
            <span className="sellers-chip sellers-chip--payout">Payout requested</span>
          </li>
        ) : null}
      </ul>
    </li>
  );
}

const EMPTY_FORM: NewSellerForm = { shop_name: '', phone: '', contact_name: '', address: '', commission: '', approve: true };

/** Sellers are invite-only: the shop and the phone it signs in with. */
function AddSellerSheet({ initial, onClose, onAdded }: { initial?: AddSellerPrefill | null; onClose(): void; onAdded(s: AdminSeller): void }) {
  const [form, setForm] = useState<NewSellerForm>(
    initial ? { ...EMPTY_FORM, shop_name: initial.shop_name, contact_name: initial.contact_name, phone: initial.phone } : EMPTY_FORM,
  );
  const [error, setError] = useState<{ text: string; field?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof NewSellerForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = key === 'approve' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
    setError(null);
  };

  async function save() {
    const read = newSellerBody(form);
    if ('error' in read) {
      setError({ text: read.error, field: read.field });
      return;
    }
    setBusy(true);
    try {
      onAdded(await sellersApi.create(read.body));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PHONE_IN_USE') {
        setError({ text: phoneInUseText((err.details as { role?: unknown } | undefined)?.role), field: 'phone' });
      } else {
        setError({ text: errorMessage(err, 'Could not add the seller.') });
      }
      setBusy(false);
    }
  }

  const at = (field: string) => (error && error.field === field ? error.text : null);

  return (
    <Sheet
      label="Add seller"
      title="Add a seller"
      message="The seller signs in on the seller site with this phone number (an SMS code). Nothing is sent now: tell them yourself."
      busy={busy}
      submitLabel={busy ? 'Adding…' : 'Add seller'}
      onClose={onClose}
      onSubmit={() => void save()}
    >
      <TextField label="Shop name" error={at('shop_name')}>
        <input className="input" maxLength={80} value={form.shop_name} onChange={set('shop_name')} />
      </TextField>
      <TextField label="Phone" error={at('phone')}>
        <input className="input" inputMode="tel" placeholder="077 123 4567" value={form.phone} onChange={set('phone')} />
      </TextField>
      <TextField label="Contact name (optional)">
        <input className="input" maxLength={80} value={form.contact_name} onChange={set('contact_name')} />
      </TextField>
      <TextField label="Address (optional)">
        <input className="input" maxLength={255} value={form.address} onChange={set('address')} />
      </TextField>
      <TextField label="Own commission % (optional)" error={at('commission')} hint="Leave empty to use the category rates.">
        <input className="input" inputMode="decimal" placeholder="Category rates" value={form.commission} onChange={set('commission')} />
      </TextField>
      <label className="seller-choice">
        <input type="checkbox" checked={form.approve} onChange={set('approve')} />
        Approve now (they can add products straight away)
      </label>
      {error && !error.field ? (
        <p className="field__error" role="alert">
          {error.text}
        </p>
      ) : null}
    </Sheet>
  );
}
