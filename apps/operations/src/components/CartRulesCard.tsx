import { useEffect, useState, type FormEvent } from 'react';
import { settings } from '../api/resources';
import type { CartRulesSetting } from '../api/types';
import { cartRulesBody, oneSellerPerOrderEnabled, oneSellerPerOrderText } from '../lib/cartRules';
import { catalogErrorMessage } from '../lib/catalog';
import { Spinner } from './ui';

/**
 * Cart rules (owner, 2026-10-27): `GET|PATCH /admin/settings/cart-rules`
 * `{ one_seller_per_order: { enabled } }` (ADMIN, OPERATIONS; audited). "One seller per order" is ON until
 * switched off: a cart can hold items from only one seller, or only Blynk's own products, and a customer who
 * adds something from a different seller is asked to start a new cart.
 */
export function CartRulesCard() {
  const [current, setCurrent] = useState<CartRulesSetting | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [on, setOn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function show(s: CartRulesSetting) {
    setCurrent(s);
    setOn(oneSellerPerOrderEnabled(s));
  }

  useEffect(() => {
    settings.cartRules
      .get()
      .then(show)
      .catch((err) => setLoadError(catalogErrorMessage(err)));
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    setError(null);
    setSaving(true);
    try {
      const saved = await settings.cartRules.update(cartRulesBody(on));
      show(saved);
      setNotice(oneSellerPerOrderText(oneSellerPerOrderEnabled(saved)));
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" id="cart-rules" aria-labelledby="cart-rules-title">
      <h2 className="section-label" id="cart-rules-title">
        Cart rules
      </h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !current ? (
        <Spinner label="Loading cart rules" />
      ) : (
        <form className="form" onSubmit={save} noValidate>
          <p className="card__row">
            <span className="card__label">One seller per order</span>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label="One seller per order"
              className="switch"
              disabled={saving}
              onClick={() => setOn((value) => !value)}
            >
              <span className="switch__thumb" aria-hidden="true" />
            </button>
          </p>
          <p className="page__note">
            A cart can hold items from only one seller, or only Blynk&apos;s own products. If a customer adds something from a
            different seller they are asked to start a new cart.
          </p>
          <p className="quiet" data-testid="cart-rules-later">
            Mixed carts for nearby sellers: coming later.
          </p>
          <button type="submit" className="button" disabled={saving}>
            {saving ? <Spinner label="Saving" /> : 'Save'}
          </button>
        </form>
      )}
      {error ? <p className="field__error" role="alert">{error}</p> : null}
      {notice ? <p className="quiet quiet--ok" role="status">{notice}</p> : null}
    </section>
  );
}
