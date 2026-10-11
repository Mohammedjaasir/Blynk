import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { addressText, addresses as addressesApi, mapsLink, type AddressBookRow, type CustomerAddresses as CustomerAddressesData } from '../api/addresses';
import { PageHeader } from '../components/Layout';
import { EmptyState, Spinner } from '../components/ui';
import { formatColomboDate } from '../lib/catalog';
import { errorMessage } from '../lib/errors';

/**
 * Customer addresses (owner, 2026-10-11: "record the address of each
 * customer"). The same view as Admin's Customers -> customer -> Addresses:
 * search a customer by name or phone, then every address they saved with how
 * many orders went to each, and the other addresses their orders went to.
 * Staff only (ADMIN and OPERATIONS); no spend figures here.
 */

const PAGE_SIZE = 25;
const ordersText = (n: number) => `${n} ${n === 1 ? 'order' : 'orders'}`;

export function CustomerAddressBook() {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AddressBookRow[] | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setRows(null);
    addressesApi
      .book({ search: search || undefined, page, limit: PAGE_SIZE })
      .then((r) => {
        if (!live) return;
        setRows(r.customers);
        setTotalPages(r.pagination.total_pages);
        setError(null);
      })
      .catch((err) => {
        if (!live) return;
        setError(errorMessage(err, 'Could not load customers.'));
        setRows([]);
      });
    return () => {
      live = false;
    };
  }, [search, page]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setSearch(query.trim());
  }

  return (
    <div className="page">
      <PageHeader title="Customer addresses" description="Search by name or phone to see a customer's saved addresses and how many orders went to each." />

      <form className="filters" role="search" onSubmit={submit}>
        <input
          className="input"
          type="search"
          aria-label="Search customers"
          placeholder="Name or phone"
          maxLength={64}
          value={query}
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
        error ? null : <EmptyState title={search ? `No customer matches "${search}"` : 'No customers yet'} />
      ) : (
        <ul className="cat-list" aria-label="Customers">
          {rows.map((c) => (
            <li key={c.id} className="cat-row cat-row--flat">
              <Link className="cat-row__main" to={`/more/customers/${c.id}`}>
                <p className="cat-row__title">{c.full_name || 'Unnamed customer'}</p>
                <p className="cat-row__meta">
                  {c.phone} · {ordersText(c.orders_count)}
                </p>
                <p className="cat-row__meta">
                  {c.default_address ?? 'No saved address'}
                  {c.addresses_count > 1 ? ` (+${c.addresses_count - 1} more)` : ''}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {totalPages > 1 ? (
        <nav className="pager" aria-label="Pages">
          <button type="button" className="button button--ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span className="quiet">
            Page {page} of {totalPages}
          </span>
          <button type="button" className="button button--ghost" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </nav>
      ) : null}
    </div>
  );
}

/** /more/customers/:id - one customer's addresses. */
export function CustomerAddressDetail() {
  const { id = '' } = useParams();
  const [data, setData] = useState<CustomerAddressesData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    addressesApi
      .forCustomer(id)
      .then((d) => live && setData(d))
      .catch((err) => live && setError(errorMessage(err, 'Could not load the addresses.')));
    return () => {
      live = false;
    };
  }, [id]);

  const c = data?.customer;
  return (
    <div className="page">
      <PageHeader title={c ? c.full_name || 'Unnamed customer' : 'Customer'} description={c ? c.phone : undefined} />
      <p>
        <Link className="link" to="/more/customers">
          All customers
        </Link>
      </p>
      {error ? <p className="field__error">{error}</p> : null}
      {!data && !error ? <Spinner label="Loading the addresses" /> : null}
      {data ? (
        <>
          <section className="section" aria-labelledby="saved-addresses">
            <h2 className="section-label" id="saved-addresses">
              Saved addresses
            </h2>
            {data.addresses.length === 0 ? (
              <p className="quiet">No saved addresses.</p>
            ) : (
              <ul className="cat-list" aria-label="Saved addresses">
                {data.addresses.map((a) => (
                  <li key={a.id} className="cat-row cat-row--flat">
                    <div className="cat-row__main">
                      <p className="cat-row__title">
                        {addressText(a)}
                        {a.is_default ? <span className="zone-pill"> Default</span> : null}
                      </p>
                      <p className="cat-row__meta">
                        {a.label} · {a.recipient_name} · {a.recipient_phone}
                        {a.alternate_phone ? ` / ${a.alternate_phone}` : ''}
                      </p>
                      {a.delivery_instructions ? <p className="cat-row__meta">“{a.delivery_instructions}”</p> : null}
                      <p className="cat-row__meta">
                        <a className="link" href={mapsLink(a.latitude, a.longitude)} target="_blank" rel="noreferrer" aria-label={`Open ${a.address_line1} on the map`}>
                          {a.latitude.toFixed(5)}, {a.longitude.toFixed(5)}
                        </a>
                      </p>
                    </div>
                    <div className="map-busiest__figures">
                      <span className="map-busiest__orders">{ordersText(a.orders)}</span>
                      <span className="cat-row__meta">{a.last_order_at ? `Last ${formatColomboDate(a.last_order_at)}` : 'Never'}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {data.other_addresses.length > 0 ? (
            <section className="section" aria-labelledby="other-addresses">
              <h2 className="section-label" id="other-addresses">
                Other addresses orders went to
              </h2>
              <ul className="cat-list" aria-label="Other addresses orders went to">
                {data.other_addresses.map((a) => (
                  <li key={`${a.address_line1}|${a.address_line2 ?? ''}|${a.city}|${a.latitude},${a.longitude}`} className="cat-row cat-row--flat">
                    <div className="cat-row__main">
                      <p className="cat-row__title">{addressText(a)}</p>
                      <p className="cat-row__meta">
                        {a.recipient_name} · {a.recipient_phone} ·{' '}
                        <a className="link" href={mapsLink(a.latitude, a.longitude)} target="_blank" rel="noreferrer">
                          Map
                        </a>
                      </p>
                    </div>
                    <div className="map-busiest__figures">
                      <span className="map-busiest__orders">{ordersText(a.orders)}</span>
                      <span className="cat-row__meta">{a.last_order_at ? `Last ${formatColomboDate(a.last_order_at)}` : ''}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
