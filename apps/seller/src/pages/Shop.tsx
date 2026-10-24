import { useEffect, useState, type FormEvent } from 'react';
import { sellerApi } from '../api/resources';
import { useAuth } from '../auth/AuthContext';
import { useSeller } from '../auth/SellerContext';
import { Field, describedBy } from '../components/ui';
import { errorMessage, fieldErrors } from '../lib/apiErrors';
import { formatDate } from '../lib/format';

type Errors = Partial<Record<'shop_name' | 'contact_name' | 'address' | 'note', string>>;

/** The shop profile (PUT /seller/profile). Allowed in any status except SUSPENDED. */
export function Shop() {
  const { user } = useAuth();
  const { seller, setSeller, reload } = useSeller();
  const [shopName, setShopName] = useState(seller?.shop_name ?? '');
  const [contactName, setContactName] = useState(seller?.contact_name ?? '');
  const [address, setAddress] = useState(seller?.address ?? '');
  const [note, setNote] = useState(seller?.note ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const sellerId = seller?.id;
  // Fill the form once the shop has loaded (or changed under us).
  useEffect(() => {
    if (!seller) return;
    setShopName(seller.shop_name);
    setContactName(seller.contact_name ?? '');
    setAddress(seller.address ?? '');
    setNote(seller.note ?? '');
  }, [sellerId]);

  if (!seller) return null;
  const locked = seller.status === 'SUSPENDED';

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    setFormError(null);
    const found: Errors = {};
    const name = shopName.trim();
    if (name.length < 2) found.shop_name = 'Enter your shop name (at least 2 letters).';
    else if (name.length > 80) found.shop_name = 'The shop name is too long (80 letters at most).';
    if (contactName.trim().length > 80) found.contact_name = 'That name is too long (80 letters at most).';
    if (address.trim().length > 255) found.address = 'The address is too long (255 letters at most).';
    if (note.trim().length > 500) found.note = 'The note is too long (500 letters at most).';
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setFormError('Please fix the highlighted boxes.');
      return;
    }

    setSaving(true);
    try {
      const result = await sellerApi.updateProfile({
        shop_name: name,
        contact_name: contactName.trim(),
        address: address.trim(),
        note: note.trim(),
      });
      setSeller(result.seller);
      setSaved(true);
      // Blynk may move a rejected shop back to "waiting": show what the server says.
      await reload();
    } catch (err) {
      const server = fieldErrors(err);
      const mapped: Errors = {};
      for (const key of ['shop_name', 'contact_name', 'address', 'note'] as const) {
        if (server[key]) mapped[key] = server[key];
      }
      if (Object.keys(mapped).length > 0) setErrors(mapped);
      setFormError(
        Object.keys(mapped).length > 0 ? 'Please fix the highlighted boxes.' : errorMessage(err, 'Could not save. Please try again.')
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="shop-title">
      <h1 id="shop-title">My shop</h1>
      <p className="muted">
        {user?.phone ? `Signed in with ${user.phone}. ` : ''}Shop opened with Blynk on {formatDate(seller.created_at)}.
      </p>

      {locked ? (
        <p className="notice notice--bad" role="status">
          Your shop is switched off, so the details cannot be changed. Please contact Blynk.
        </p>
      ) : (
        <p className="muted">Blynk uses these details to know who you are and how to reach you.</p>
      )}

      <form onSubmit={save} noValidate className="form">
        <Field id="s-name" label="Shop name" required error={errors.shop_name}>
          <input
            id="s-name"
            type="text"
            maxLength={80}
            autoComplete="organization"
            value={shopName}
            disabled={locked}
            onChange={(e) => setShopName(e.target.value)}
            aria-invalid={Boolean(errors.shop_name)}
            aria-describedby={describedBy('s-name', false, errors.shop_name)}
          />
        </Field>
        <Field id="s-contact" label="Contact person" error={errors.contact_name}>
          <input
            id="s-contact"
            type="text"
            maxLength={80}
            autoComplete="name"
            value={contactName}
            disabled={locked}
            onChange={(e) => setContactName(e.target.value)}
            aria-invalid={Boolean(errors.contact_name)}
            aria-describedby={describedBy('s-contact', false, errors.contact_name)}
          />
        </Field>
        <Field id="s-address" label="Address" error={errors.address} hint="Where Blynk collects your goods from.">
          <input
            id="s-address"
            type="text"
            maxLength={255}
            autoComplete="street-address"
            value={address}
            disabled={locked}
            onChange={(e) => setAddress(e.target.value)}
            aria-invalid={Boolean(errors.address)}
            aria-describedby={describedBy('s-address', true, errors.address)}
          />
        </Field>
        <Field id="s-note" label="About your shop" error={errors.note} hint="What you sell, where it is made. Blynk reads this when approving you.">
          <textarea
            id="s-note"
            rows={4}
            maxLength={500}
            value={note}
            disabled={locked}
            onChange={(e) => setNote(e.target.value)}
            aria-invalid={Boolean(errors.note)}
            aria-describedby={describedBy('s-note', true, errors.note)}
          />
        </Field>

        {formError ? (
          <p className="notice notice--bad" role="alert">
            {formError}
          </p>
        ) : null}
        {saved ? (
          <p className="notice notice--ok" role="status">
            Saved.
          </p>
        ) : null}

        <div className="form__actions">
          <button type="submit" className="button button--primary" disabled={saving || locked}>
            {saving ? 'Saving...' : 'Save my shop details'}
          </button>
        </div>
      </form>

    </section>
  );
}
