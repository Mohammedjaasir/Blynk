import { useEffect, useState } from 'react';
import { addressText, addresses as addressesApi, mapsLink, type CustomerAddresses } from '../api/addresses';
import { errorMessage } from '../lib/apiErrors';
import { formatDay } from '../lib/coupons';
import { EmptyState, Spinner } from './ui';

const ordersText = (n: number) => `${n} ${n === 1 ? 'order' : 'orders'}`;

/**
 * Customers -> one customer -> Addresses (owner, 2026-10-11: "record the
 * address of each customer in admin"): every saved address - label,
 * recipient, phones, the line, town, pin on the map - with how many orders
 * went to each, and the other addresses their orders went to (one since
 * edited or deleted; orders keep their own copy). Staff only.
 */
export function CustomerAddressesPanel({ customerId }: { customerId: string }) {
  const [data, setData] = useState<CustomerAddresses | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    addressesApi
      .forCustomer(customerId)
      .then((d) => {
        if (cancelled) return;
        // An older backend (or a proxy page) answers something else.
        if (!d || !Array.isArray(d.addresses) || !Array.isArray(d.other_addresses)) {
          setError('Could not load the addresses.');
          return;
        }
        setData(d);
      })
      .catch((err) => !cancelled && setError(errorMessage(err, 'Could not load the addresses.')));
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  return (
    <section className="panel" aria-label="Addresses">
      <h2 className="panel__title">Addresses</h2>
      {error ? (
        <p className="field__error">{error}</p>
      ) : !data ? (
        <Spinner label="Loading the addresses" />
      ) : (
        <>
          {data.addresses.length === 0 ? (
            <EmptyState title="No saved addresses" />
          ) : (
            <div className="table-wrap">
              <table className="table" aria-label="Saved addresses">
                <thead>
                  <tr>
                    <th scope="col">Address</th>
                    <th scope="col">Recipient</th>
                    <th scope="col" className="num">
                      Orders
                    </th>
                    <th scope="col">Last order</th>
                    <th scope="col">Map</th>
                  </tr>
                </thead>
                <tbody>
                  {data.addresses.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <span className="cell__primary">{addressText(a)}</span>
                        {a.is_default ? <span className="zone-tag zone-tag--inside">Default</span> : null}
                        <span className="cell__secondary">
                          {' '}
                          {a.label}
                          {a.postal_code ? ` · ${a.postal_code}` : ''}
                          {a.delivery_instructions ? ` · “${a.delivery_instructions}”` : ''}
                        </span>
                      </td>
                      <td>
                        {a.recipient_name}
                        <span className="cell__secondary mono">
                          {' '}
                          {a.recipient_phone}
                          {a.alternate_phone ? ` / ${a.alternate_phone}` : ''}
                        </span>
                      </td>
                      <td className="num mono">
                        {a.orders}
                        {a.orders > 0 && a.delivered !== a.orders ? <span className="cell__secondary"> ({a.delivered} delivered)</span> : null}
                      </td>
                      <td className="cell__secondary">{a.last_order_at ? formatDay(a.last_order_at) : 'Never'}</td>
                      <td>
                        <a className="link" href={mapsLink(a.latitude, a.longitude)} target="_blank" rel="noreferrer" aria-label={`Open ${a.address_line1} on the map`}>
                          {a.latitude.toFixed(5)}, {a.longitude.toFixed(5)}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.other_addresses.length > 0 ? (
            <>
              <h3 className="section-label">Other addresses orders went to</h3>
              <ul className="address-list" aria-label="Other addresses orders went to">
                {data.other_addresses.map((a) => (
                  <li key={`${a.address_line1}|${a.address_line2 ?? ''}|${a.city}|${a.latitude},${a.longitude}`}>
                    <span className="cell__primary">{addressText(a)}</span>
                    <span className="cell__secondary">
                      {' '}
                      · {a.recipient_name} {a.recipient_phone} · {ordersText(a.orders)}
                      {a.last_order_at ? `, last ${formatDay(a.last_order_at)}` : ''} ·{' '}
                    </span>
                    <a className="link" href={mapsLink(a.latitude, a.longitude)} target="_blank" rel="noreferrer">
                      Map
                    </a>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
