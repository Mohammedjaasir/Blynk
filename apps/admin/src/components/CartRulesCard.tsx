import { useEffect, useState, type FormEvent } from 'react';
import { settings as settingsApi } from '../api/resources';
import type { CartRulesSetting } from '../api/types';
import { errorMessage, validationIssues } from '../lib/apiErrors';
import { cartRulesBody, oneSellerPerOrderEnabled, oneSellerPerOrderText } from '../lib/cartRules';
import { Switch } from './Switch';
import { Spinner, useToast } from './ui';

/**
 * Settings -> Cart rules (owner, 2026-10-27): `GET|PATCH /admin/settings/cart-rules`
 * `{ one_seller_per_order: { enabled } }` (ADMIN, OPERATIONS; audited CART_RULES_UPDATED). "One seller per
 * order" is ON until switched off: a cart may hold items from only one seller, or only Blynk's own products,
 * and a customer who adds something from a different seller is asked to start a new cart.
 */
export function CartRulesCard() {
  const toast = useToast();
  const [current, setCurrent] = useState<CartRulesSetting | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function show(setting: CartRulesSetting) {
    setCurrent(setting);
    setEnabled(oneSellerPerOrderEnabled(setting));
  }

  useEffect(() => {
    let cancelled = false;
    settingsApi
      .getCartRules()
      .then((setting) => !cancelled && show(setting))
      .catch((err) => !cancelled && setLoadError(errorMessage(err, 'Could not load the cart rules.')));
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaveError(null);
    setSaving(true);
    try {
      const updated = await settingsApi.setCartRules(cartRulesBody(enabled));
      show(updated);
      toast.success(oneSellerPerOrderText(oneSellerPerOrderEnabled(updated)));
    } catch (err) {
      setSaveError(validationIssues(err)[0]?.message ?? errorMessage(err, 'Could not save the cart rules.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel" id="cart-rules" aria-label="Cart rules">
      <h2 className="panel__title">Cart rules</h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !current ? (
        <Spinner label="Loading the cart rules" />
      ) : (
        <form className="form" onSubmit={save} noValidate>
          <p className="panel__body">
            <Switch checked={enabled} onChange={setEnabled} label="One seller per order" disabled={saving}>
              One seller per order ({enabled ? 'on' : 'off'})
            </Switch>
          </p>
          <p className="form__note">
            A cart can hold items from only one seller, or only Blynk&apos;s own products. If a customer adds something from a
            different seller they are asked to start a new cart.
          </p>
          <p className="form__note" data-testid="cart-rules-later">
            Mixed carts for nearby sellers: coming later.
          </p>
          {saveError ? (
            <p className="field__error" role="alert">
              {saveError}
            </p>
          ) : null}
          <div className="form__actions">
            <button type="submit" className="button" disabled={saving}>
              {saving ? <Spinner label="Saving" /> : 'Save'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
