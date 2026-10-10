import { errorMessage } from '../lib/apiErrors';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { customers as customersApi, orders as ordersApi, settings as settingsApi } from '../api/resources';
import type { BirthdayCustomer, CustomerDetail as Detail, CustomerOrderRow, CustomerRow, CustomerSort, OrderDetail } from '../api/types';
import { PageHeader } from '../components/Layout';
import { OrderBill } from '../components/OrderBill';
import { OrderItems } from '../components/OrderItems';
import { CustomerPointsPanel } from '../components/CustomerPointsPanel';
import { Badge, EmptyState, Spinner } from '../components/ui';
import { birthdayWhen, formatDayMonth, formatDayMonthYear } from '../lib/birthday';
import { formatDay } from '../lib/coupons';
import { buildCustomersXlsx, customerExportFilename } from '../lib/customerExport';
import { downloadBlob } from '../lib/productImport';
import { smsLanguageLabel } from '../lib/smsOffers';
import { STATUS_LABEL, formatClock, formatMoney, orderErrorMessage, shortNumber } from '../lib/orders';

/**
 * Customers (ADMIN only - the API refuses everyone else, and the rows carry
 * phone numbers). Spend is the total of delivered orders. The optional
 * profile customers save in the app - date of birth, favourite categories
 * and a note - shows here, with a "Birthdays this week" view so the shop can
 * plan a small extra for the bag (owner, 2026-10-09).
 */

export const SORT_LABEL: Record<Exclude<CustomerSort, 'name'>, string> = {
  recent: 'Recent',
  spend: 'Top spend',
  orders: 'Most orders',
};

const PAGE_SIZE = 25;

type View = 'all' | 'birthdays';
const VIEW_LABEL: Record<View, string> = { all: 'All customers', birthdays: 'Birthdays this week' };
const errorText = (err: unknown, fallback: string) => errorMessage(err, fallback);

export function Customers() {
  const [view, setView] = useState<View>('all');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<CustomerSort>('recent');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<CustomerRow[] | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  /** Every customer (not just this page or search) as an .xlsx. */
  async function downloadExcel() {
    setExporting(true);
    setExportError(null);
    try {
      const { customers: all } = await customersApi.exportAll();
      downloadBlob(await buildCustomersXlsx(all), customerExportFilename());
    } catch (err) {
      setExportError(errorText(err, 'Could not download the customer list.'));
    } finally {
      setExporting(false);
    }
  }

  const load = useCallback(async () => {
    setRows(null);
    try {
      const result = await customersApi.list({ search, sort, page, limit: PAGE_SIZE });
      setRows(result.customers);
      setTotalPages(result.pagination.total_pages);
      setTotal(result.pagination.total);
      setError(null);
    } catch (err) {
      setError(errorText(err, 'Could not load customers.'));
      setRows([]);
    }
  }, [search, sort, page]);

  useEffect(() => {
    void load();
  }, [load]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setSearch(query.trim());
  }

  return (
    <>
      <PageHeader
        title="Customers"
        description="Search by name or phone. Spend counts delivered orders."
        actions={
          view === 'birthdays' ? null : (
            <>
              <button type="button" className="button button--ghost" disabled={exporting} onClick={() => void downloadExcel()}>
                {exporting ? 'Preparing…' : 'Download Excel'}
              </button>
              <div className="segmented" role="group" aria-label="Sort">
                {(Object.keys(SORT_LABEL) as Exclude<CustomerSort, 'name'>[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={option === sort ? 'segmented__item is-selected' : 'segmented__item'}
                    aria-pressed={option === sort}
                    onClick={() => {
                      setPage(1);
                      setSort(option);
                    }}
                  >
                    {SORT_LABEL[option]}
                  </button>
                ))}
              </div>
            </>
          )
        }
      />

      <div className="segmented customers-view" role="group" aria-label="View">
        {(Object.keys(VIEW_LABEL) as View[]).map((option) => (
          <button
            key={option}
            type="button"
            className={option === view ? 'segmented__item is-selected' : 'segmented__item'}
            aria-pressed={option === view}
            onClick={() => setView(option)}
          >
            {VIEW_LABEL[option]}
          </button>
        ))}
      </div>

      {view === 'birthdays' ? (
        <BirthdaysThisWeek />
      ) : (
        <>
          {exportError ? <p className="field__error" role="alert">{exportError}</p> : null}

          <form className="search-bar" role="search" onSubmit={submit}>
            <input
              className="input"
              type="search"
              aria-label="Search customers"
              placeholder="Name or phone"
              value={query}
              maxLength={64}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="submit" className="button button--ghost">
              Search
            </button>
          </form>

          {error ? <p className="field__error">{error}</p> : null}

          {rows === null ? (
            <Spinner label="Loading customers" />
          ) : rows.length === 0 ? (
            error ? null : <EmptyState title={search ? 'No customer matches' : 'No customers yet'} message={search ? `Nothing for “${search}”.` : undefined} />
          ) : (
            <>
              <div className="table-wrap">
                <table className="table" aria-label="Customers">
                  <thead>
                    <tr>
                      <th scope="col">Customer</th>
                      <th scope="col">Phone</th>
                      <th scope="col" className="num">
                        Orders
                      </th>
                      <th scope="col" className="num">
                        Delivered spend
                      </th>
                      <th scope="col">Last order</th>
                      <th scope="col">Birthday</th>
                      <th scope="col">SMS language</th>
                      <th scope="col">Offers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <Link className="link cell__primary" to={`/customers/${c.id}`}>
                            {c.full_name || 'Unnamed customer'}
                          </Link>
                        </td>
                        <td className="cell__secondary mono">{c.phone}</td>
                        <td className="num mono">{c.orders_count}</td>
                        <td className="num mono">{formatMoney(c.delivered_spend)}</td>
                        <td className="cell__secondary">{c.last_order_at ? formatDay(c.last_order_at) : 'Never'}</td>
                        <td className="cell__secondary">{c.date_of_birth ? formatDayMonthYear(c.date_of_birth) : '—'}</td>
                        <td>{smsLanguageLabel(c.sms_language)}</td>
                        <td>
                          <Badge tone={c.sms_offers ? 'active' : 'inactive'}>{c.sms_offers ? 'On' : 'Off'}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={page} totalPages={totalPages} total={total} onPage={setPage} />
            </>
          )}
        </>
      )}
    </>
  );
}

function Pager({ page, totalPages, total, onPage }: { page: number; totalPages: number; total: number; onPage(p: number): void }) {
  if (totalPages <= 1) return <p className="cell__secondary">{total} {total === 1 ? 'customer' : 'customers'}</p>;
  return (
    <nav className="pager" aria-label="Pages">
      <button type="button" className="button button--ghost button--sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span className="cell__secondary">
        Page {page} of {totalPages} · {total} customers
      </span>
      <button type="button" className="button button--ghost button--sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </nav>
  );
}

/** /customers/:id - the profile, their figures and every order, newest first. */
export function CustomerDetail() {
  const { id = '' } = useParams();
  const [data, setData] = useState<Detail | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    customersApi
      .detail(id, page)
      .then((d) => !cancelled && (setData(d), setError(null)))
      .catch((err) => !cancelled && setError(errorText(err, 'Could not load the customer.')));
    return () => {
      cancelled = true;
    };
  }, [id, page]);

  const c = data?.customer;
  return (
    <>
      <PageHeader
        title={c ? c.full_name || 'Unnamed customer' : 'Customer'}
        description={c ? `${c.phone}${c.email ? ` · ${c.email}` : ''} · joined ${formatDay(c.created_at)}` : undefined}
        actions={
          <Link className="button button--ghost" to="/customers">
            All customers
          </Link>
        }
      />
      {error ? <p className="field__error">{error}</p> : null}
      {!data && !error ? <Spinner label="Loading the customer" /> : null}
      {c && data ? (
        <>
          <div className="figures" aria-label="Customer figures">
            <div className="figure">
              <span className="figure__value">{c.orders_count}</span>
              <span className="figure__label">Orders</span>
            </div>
            <div className="figure">
              <span className="figure__value">{c.delivered_count}</span>
              <span className="figure__label">Delivered</span>
            </div>
            <div className="figure">
              <span className="figure__value figure__value--sm">{formatMoney(c.delivered_spend)}</span>
              <span className="figure__label">Delivered spend</span>
            </div>
            <div className="figure">
              <span className="figure__value figure__value--sm">{c.last_order_at ? formatDay(c.last_order_at) : 'Never'}</span>
              <span className="figure__label">Last order</span>
            </div>
            <div className="figure">
              <span className="figure__value figure__value--sm">{smsLanguageLabel(c.sms_language)}</span>
              <span className="figure__label">SMS language</span>
            </div>
            <div className="figure">
              <span className="figure__value figure__value--sm">{c.sms_offers ? 'On' : 'Off'}</span>
              <span className="figure__label">Offers by SMS</span>
            </div>
            <div className="figure">
              <span className="figure__value figure__value--sm">{c.date_of_birth ? formatDayMonthYear(c.date_of_birth) : 'Not given'}</span>
              <span className="figure__label">Date of birth</span>
            </div>
          </div>

          <CustomerLikes customer={c} />
          {/* Blynk Points balance, history and +/- adjust (owner, 2026-10-10). */}
          <CustomerPointsPanel customerId={c.id} />

          {data.orders.length === 0 ? (
            <EmptyState title="No orders yet" />
          ) : (
            <div className="table-wrap">
              <table className="table" aria-label="Order history">
                <thead>
                  <tr>
                    <th scope="col">Order</th>
                    <th scope="col">Placed</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="num">
                      Items
                    </th>
                    <th scope="col" className="num">
                      Total
                    </th>
                    <th scope="col">
                      <span className="visually-hidden">Details</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.orders.map((o) => (
                    <OrderHistoryRow key={o.id} order={o} open={openId === o.id} onToggle={() => setOpenId(openId === o.id ? null : o.id)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.pagination.total_pages > 1 ? (
            <nav className="pager" aria-label="Pages">
              <button type="button" className="button button--ghost button--sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Newer
              </button>
              <span className="cell__secondary">
                Page {page} of {data.pagination.total_pages}
              </span>
              <button
                type="button"
                className="button button--ghost button--sm"
                disabled={page >= data.pagination.total_pages}
                onClick={() => setPage(page + 1)}
              >
                Older
              </button>
            </nav>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function OrderHistoryRow({ order, open, onToggle }: { order: CustomerOrderRow; open: boolean; onToggle(): void }) {
  const number = shortNumber(order.order_number);
  return (
    <>
      <tr>
        <td className="mono">#{number}</td>
        <td className="cell__secondary">
          {formatDay(order.placed_at)} {formatClock(order.placed_at)}
        </td>
        <td>{STATUS_LABEL[order.order_status] ?? order.order_status}</td>
        <td className="num mono">{order.item_count}</td>
        <td className="num mono">
          {formatMoney(order.total_amount)}
          {order.discount_amount > 0 ? (
            <span className="cell__secondary">
              {' '}
              incl. −{formatMoney(order.discount_amount)}
              {(order.birthday_discount_amount ?? 0) > 0 ? ' birthday gift' : ''}
            </span>
          ) : null}
        </td>
        <td>
          <button
            type="button"
            className="button button--ghost button--sm"
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} order #${number}`}
            onClick={onToggle}
          >
            {open ? 'Hide' : 'Details'}
          </button>
        </td>
      </tr>
      {open ? (
        <tr className="order-expand">
          <td colSpan={6}>
            <OrderDetailInline orderId={order.id} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** The same order detail the Orders board panel reads (GET /admin/orders/:id), read-only. */
function OrderDetailInline({ orderId }: { orderId: string }) {
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    ordersApi
      .detail(orderId)
      .then((d) => !cancelled && setDetail(d))
      .catch((err) => !cancelled && setError(orderErrorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [orderId]);
  if (error) return <p className="ops-notice">{error}</p>;
  if (!detail) return <Spinner label="Loading the order" />;
  return (
    <div className="order-inline" aria-label={`Order #${shortNumber(detail.order_number)} details`}>
      <OrderItems items={detail.items} combos={detail.combos} />
      <OrderBill order={detail} />
      <p className="cell__secondary">
        {detail.delivery_address_line1}, {detail.delivery_city}
        {detail.delivery?.rider_name ? ` · Rider: ${detail.delivery.rider_name}` : ''}
        {detail.cancellation_reason ? ` · Cancelled: ${detail.cancellation_reason}` : ''}
      </p>
    </div>
  );
}

/** Favourite categories and "anything else you love" from the customer's
 * optional profile (owner, 2026-10-09). Nothing shows when both are empty. */
function CustomerLikes({ customer }: { customer: Detail['customer'] }) {
  const favourites = customer.favourite_categories ?? [];
  const note = customer.favourites_note?.trim();
  if (favourites.length === 0 && !note) return null;
  return (
    <section className="panel" aria-label="What they love">
      <h2 className="panel__title">What they love</h2>
      {favourites.length > 0 ? <CategoryChips categories={favourites} /> : null}
      {note ? <p className="panel__body customer-note">“{note}”</p> : null}
    </section>
  );
}

function CategoryChips({ categories }: { categories: { id: string; name: string }[] }) {
  return (
    <ul className="birthday-chips" aria-label="Favourite categories">
      {categories.map((cat) => (
        <li key={cat.id} className="birthday-chip">
          {cat.name}
        </li>
      ))}
    </ul>
  );
}

/** Customers in (or about to be in) their birthday week - birthday +-3 days,
 * Colombo time - and whether they have used the gift (owner, 2026-10-09). */
function BirthdaysThisWeek() {
  const [rows, setRows] = useState<BirthdayCustomer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    settingsApi
      .getBirthdays(7)
      .then((d) => !cancelled && setRows(d.customers))
      .catch((err) => !cancelled && setError(errorText(err, 'Could not load the birthdays.')));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="field__error">{error}</p>;
  if (!rows) return <Spinner label="Loading birthdays" />;
  if (rows.length === 0)
    return <EmptyState title="No birthdays this week" message="Customers who save their date of birth in the app show up here." />;
  return (
    <div className="table-wrap">
      <table className="table" aria-label="Birthdays this week">
        <thead>
          <tr>
            <th scope="col">Customer</th>
            <th scope="col">Phone</th>
            <th scope="col">Birthday</th>
            <th scope="col" className="num">
              Turning
            </th>
            <th scope="col">Loves</th>
            <th scope="col">Gift</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td>
                <Link className="link cell__primary" to={`/customers/${c.id}`}>
                  {c.full_name || 'Unnamed customer'}
                </Link>
              </td>
              <td className="cell__secondary mono">{c.phone}</td>
              <td>
                <span className={c.days_until === 0 ? 'birthday-when birthday-when--today' : 'birthday-when'}>
                  {birthdayWhen(c.days_until)}
                </span>
                <span className="cell__secondary"> · {formatDayMonth(c.birthday)}</span>
              </td>
              <td className="num mono">{c.turning}</td>
              <td>
                {c.favourite_categories.length > 0 ? <CategoryChips categories={c.favourite_categories} /> : null}
                {c.favourites_note ? <p className="cell__secondary customer-note">“{c.favourites_note}”</p> : null}
                {c.favourite_categories.length === 0 && !c.favourites_note ? <span className="cell__secondary">—</span> : null}
              </td>
              <td>
                {c.offer_used ? <Badge tone="muted">Gift used</Badge> : <Badge tone="offer">Not used yet</Badge>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
