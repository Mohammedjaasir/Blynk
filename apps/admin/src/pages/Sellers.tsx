import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { sellerCommission, sellerPayoutRequests, sellers as sellersApi } from '../api/resources';
import { sellerApplications as applicationsApi } from '../api/sellerApplications';
import { PageHeader } from '../components/Layout';
import { Badge, EmptyState, Spinner, useToast } from '../components/ui';
import { errorMessage } from '../lib/apiErrors';
import {
  SELLER_STATUSES,
  SELLER_STATUS_LABEL,
  approvedPoint,
  categoryTree,
  commissionBody,
  commissionText,
  freeDaysLeft,
  locationWaiting,
  lkr,
  newSellerBody,
  notReady,
  payoutRequesters,
  phoneInUseText,
  sellerContact,
  sellerStatusTone,
  statusCounts,
  type AdminSeller,
  type CommissionSettings,
  type NewSellerForm,
  type SellerStatus,
} from '../lib/sellers';
import { readAddSellerState, type AddSellerPrefill } from '../lib/sellerApplications';
import './sellers.css';

/**
 * Sellers (seller portal, 2026-10-24). Sellers are invite-only: staff add each shop here with the
 * phone number it signs in with (SMS code on the seller site). Open one to approve, reject or
 * suspend them, set their commission, see what Blynk owes them, pay
 * their payout requests and record payouts. Their product submissions wait under Seller products.
 * The "Seller commission" panel sets what Blynk keeps: a default and per-category rates.
 * "Add as seller" on a seller application (2026-10-27) lands here with the Add seller form open and the shop,
 * name and phone filled in (router state); once the seller is added the application is marked Approved.
 */
const when = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Colombo' });

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
  const [showCommission, setShowCommission] = useState(false);

  // The prefill is used once: a reload or a Back does not reopen the form.
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

  return (
    <>
      <PageHeader
        title="Sellers"
        description="Shops that sell through Blynk. Add a shop with the phone number it signs in with; then its products wait for your approval under Seller products."
        actions={
          <>
            <button type="button" className="button button--ghost" aria-expanded={showCommission} onClick={() => setShowCommission((v) => !v)}>
              Seller commission
            </button>
            <button type="button" className="button" onClick={() => setAdding(true)}>
              Add seller
            </button>
          </>
        }
      />

      {showCommission ? <CommissionPanel onClose={() => setShowCommission(false)} /> : null}

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
            message={rows.length === 0 && !search.trim() ? 'Add a shop with "Add seller"; it signs in on the seller site with that phone number.' : undefined}
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
              {shown.map((s) => {
                const payoutWaiting = open.has(s.id);
                return (
                  <tr key={s.id}>
                    <td>
                      <Link className="cell__primary" to={`/sellers/${s.id}`}>
                        {s.shop_name}
                      </Link>
                      {s.full_name || s.contact_name ? <span className="cell__secondary">{s.contact_name ?? s.full_name}</span> : null}
                      {locationWaiting(s) ? (
                        <span className="sellers__chip sellers__chip--waiting">Location waiting</span>
                      ) : !approvedPoint(s) ? (
                        <span className="sellers__chip">No location</span>
                      ) : null}
                      {payoutWaiting ? <span className="sellers__chip sellers__chip--payout">Payout requested</span> : null}
                    </td>
                    <td className="mono">{sellerContact(s)}</td>
                    <td>
                      <Badge tone={sellerStatusTone(s.status)}>{SELLER_STATUS_LABEL[s.status]}</Badge>
                    </td>
                    <td className="num">
                      {s.products_live}
                      {typeof s.products_total === 'number' && s.products_total > s.products_live ? (
                        <span className="cell__secondary">{s.products_total} in all</span>
                      ) : null}
                    </td>
                    <td className="num">
                      {s.submissions_pending > 0 ? (
                        <Link className="sellers__waiting" to={`/seller-products?seller=${s.id}`} aria-label={`${s.submissions_pending} waiting for ${s.shop_name}`}>
                          {s.submissions_pending}
                        </Link>
                      ) : (
                        0
                      )}
                    </td>
                    <td className="num">
                      {commissionText(s.commission_percent)}
                      {(freeDaysLeft(s.commission_free_until) ?? 0) > 0 ? (
                        <span className="sellers__chip sellers__chip--free">Free, {freeDaysLeft(s.commission_free_until)}d left</span>
                      ) : null}
                    </td>
                    <td className="num">{lkr(s.due)}</td>
                    <td>{when.format(new Date(s.created_at))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {adding ? (
        <AddSellerDialog
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
            navigate(`/sellers/${s.id}`);
          }}
        />
      ) : null}
    </>
  );
}

const EMPTY_FORM: NewSellerForm = { shop_name: '', phone: '', contact_name: '', address: '', commission: '', approve: true };

/** Sellers are invite-only (2026-10-24): the shop and the phone it signs in with. */
function AddSellerDialog({ initial, onClose, onAdded }: { initial?: AddSellerPrefill | null; onClose(): void; onAdded(s: AdminSeller): void }) {
  const toast = useToast();
  const [form, setForm] = useState<NewSellerForm>(
    initial ? { ...EMPTY_FORM, shop_name: initial.shop_name, contact_name: initial.contact_name, phone: initial.phone } : EMPTY_FORM
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
      const seller = await sellersApi.create(read.body);
      toast.success(`${seller.shop_name} is added. They sign in on the seller site with ${form.phone.trim()}.`);
      onAdded(seller);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PHONE_IN_USE') {
        setError({ text: phoneInUseText((err.details as { role?: unknown } | undefined)?.role), field: 'phone' });
      } else {
        setError({ text: errorMessage(err, 'Could not add the seller.') });
      }
    } finally {
      setBusy(false);
    }
  }

  const fieldError = (field: string) => (error && error.field === field ? <span className="field__error">{error.text}</span> : null);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Add seller">
      <form
        className="modal__panel"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void save();
        }}
      >
        <h2 className="modal__title">Add a seller</h2>
        <p className="modal__message">The seller signs in on the seller site with this phone number (an SMS code). Nothing is sent now: tell them yourself.</p>
        <label className="field">
          <span className="field__label">Shop name</span>
          <input className="input" maxLength={80} value={form.shop_name} onChange={set('shop_name')} />
          {fieldError('shop_name')}
        </label>
        <label className="field">
          <span className="field__label">Phone</span>
          <input className="input" inputMode="tel" placeholder="077 123 4567" value={form.phone} onChange={set('phone')} />
          {fieldError('phone')}
        </label>
        <label className="field">
          <span className="field__label">Contact name (optional)</span>
          <input className="input" maxLength={80} value={form.contact_name} onChange={set('contact_name')} />
        </label>
        <label className="field">
          <span className="field__label">Address (optional)</span>
          <input className="input" maxLength={255} value={form.address} onChange={set('address')} />
        </label>
        <label className="field">
          <span className="field__label">Own commission % (optional)</span>
          <input className="input seller-commission__input" inputMode="decimal" placeholder="Category rates" value={form.commission} onChange={set('commission')} />
          {fieldError('commission') ?? <span className="field__hint">Leave empty to use the category rates.</span>}
        </label>
        <label className="sellers__check">
          <input type="checkbox" checked={form.approve} onChange={set('approve')} />
          Approve now (they can add products straight away)
        </label>
        {error && !error.field ? (
          <p className="field__error" role="alert">
            {error.text}
          </p>
        ) : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={busy}>
            {busy ? 'Adding…' : 'Add seller'}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * What Blynk keeps from seller sales (owner, 2026-10-24): a default %, and an optional % per main
 * category and sub-category (a sub-category without one uses its main category's). A seller's own
 * rate (on their page) beats both.
 */
function CommissionPanel({ onClose }: { onClose(): void }) {
  const toast = useToast();
  const [settings, setSettings] = useState<CommissionSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [defaultText, setDefaultText] = useState('');
  const [rates, setRates] = useState<Record<string, string>>({});
  const [freeDays, setFreeDays] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const adopt = (s: CommissionSettings) => {
    setSettings(s);
    setDefaultText(String(s.default_percent));
    setFreeDays(typeof s.free_days === 'number' ? String(s.free_days) : '');
    setRates(Object.fromEntries(s.categories.map((c) => [c.category_id, c.percent === null ? '' : String(c.percent)])));
  };

  useEffect(() => {
    let live = true;
    sellerCommission
      .get()
      .then((s) => live && adopt(s))
      .catch((err) => live && setLoadError(errorMessage(err, 'Could not load the commission settings.')));
    return () => {
      live = false;
    };
  }, []);

  async function save() {
    const read = commissionBody(defaultText, rates, typeof settings?.free_days === 'number' ? freeDays : undefined);
    if ('error' in read) {
      setError(read.error);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      adopt(await sellerCommission.save(read.body));
      toast.success('Seller commission saved.');
    } catch (err) {
      setError(notReady(err) ? 'Category rates can be saved after the next database update.' : errorMessage(err, 'Could not save the commission.'));
    } finally {
      setBusy(false);
    }
  }

  const tree = settings ? categoryTree(settings.categories) : [];

  return (
    <section className="seller-card sellers__commission" aria-label="Seller commission">
      <div className="seller-card__head">
        <h2 className="form__section-title">Seller commission</h2>
        <button type="button" className="button button--ghost button--sm" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="form__note">
        The % Blynk keeps from the seller's price on each sale: the seller's own rate if they have one, else the category's (a sub-category without one uses its main category's), else the default.
      </p>
      {loadError ? (
        <p className="field__error" role="alert">
          {loadError}
        </p>
      ) : !settings ? (
        <Spinner label="Loading the commission settings" />
      ) : (
        <form
          noValidate
          className="sellers__commission-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void save();
          }}
        >
          <label className="field">
            <span className="field__label">Default (%)</span>
            <input
              className="input seller-commission__input"
              inputMode="decimal"
              aria-label="Default commission percent"
              value={defaultText}
              onChange={(e) => {
                setDefaultText(e.target.value);
                setError(null);
              }}
            />
          </label>
          {typeof settings.free_days === 'number' ? (
            <label className="field">
              <span className="field__label">Free month for new sellers (days)</span>
              <input
                className="input seller-commission__input"
                inputMode="numeric"
                aria-label="Free days for new sellers"
                value={freeDays}
                onChange={(e) => {
                  setFreeDays(e.target.value);
                  setError(null);
                }}
              />
              <span className="field__hint">
                No commission for this many days from the day a seller is approved (0 = none). Open a seller to change their own date.
              </span>
            </label>
          ) : null}
          {settings.ready === false ?<p className="form__note">Category rates can be set after the next database update.</p> : null}
          {tree.length > 0 ? (
            <div className="table-wrap">
              <table className="table" aria-label="Category commission">
                <thead>
                  <tr>
                    <th scope="col">Category</th>
                    <th scope="col" className="num">
                      Rate (%)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tree.map(({ row, depth }) => (
                    <tr key={row.category_id}>
                      <td className={depth ? 'sellers__subcategory' : undefined}>{row.name}</td>
                      <td className="num">
                        <input
                          className="input sellers__rate"
                          inputMode="decimal"
                          aria-label={`Commission for ${row.name}`}
                          placeholder={depth ? 'Main category' : 'Default'}
                          disabled={settings.ready === false}
                          value={rates[row.category_id] ?? ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            setRates((r) => ({ ...r, [row.category_id]: v }));
                            setError(null);
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {error ? (
            <p className="field__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="row-actions">
            <button type="submit" className="button" disabled={busy}>
              {busy ? 'Saving…' : 'Save commission'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
