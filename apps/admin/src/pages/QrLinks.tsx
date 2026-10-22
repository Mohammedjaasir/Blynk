import { useCallback, useEffect, useRef, useState } from 'react';
import { qrLinks as qrLinksApi } from '../api/resources';
import { PageHeader } from '../components/Layout';
import { ConfirmDialog, Spinner, useToast } from '../components/ui';
import { errorMessage, splitServerErrors } from '../lib/apiErrors';
import {
  hasCampaignTags,
  lastScanText,
  leavesBlynk,
  normalizeQrCode,
  qrCodeProblem,
  qrFileName,
  qrLinkProblems,
  qrLinksPayload,
  qrPngDataUrl,
  qrShortAddress,
  qrSvg,
  QR_LIMITS,
  saveHref,
  saveSvg,
  withCampaignTags,
  withoutCampaignTags,
  type QrLink,
  type QrLinkView,
  type QrLinksSetting,
} from '../lib/qrLinks';

/**
 * QR links (owner, 2026-10-22: "i need a dynamic QR code to put in the jersey" / "the qr should be
 * dynamic so give that option in admin"). The printed QR carries a fixed short address,
 * blynk.lk/q/<code>; staff choose where it leads here, can change that any time, see how many
 * people scanned it and download the QR image for printing. Blynk Ops has the same page.
 */
interface Draft extends QrLinkView {
  /** Stable React key; a code cannot change once it is on the list. */
  key: string;
  /** Added in this session, not saved yet. */
  fresh?: boolean;
}

const fieldIds = ['code', 'label', 'url'] as const;

export function QrLinks() {
  const toast = useToast();
  const [saved, setSaved] = useState<QrLinksSetting | null>(null);
  const [draft, setDraft] = useState<Draft[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<Draft | null>(null);
  const keys = useRef(0);

  const adopt = useCallback((s: QrLinksSetting) => {
    setSaved(s);
    setDraft(s.links.map((l) => ({ ...l, key: `k${keys.current++}` })));
    setServerErrors({});
  }, []);

  useEffect(() => {
    qrLinksApi
      .get()
      .then((s) => {
        adopt(s);
        setLoadError(null);
      })
      .catch((err) => setLoadError(errorMessage(err, 'Could not load the QR links.')));
  }, [adopt]);

  const payload = JSON.stringify(qrLinksPayload(draft));
  const dirty = saved ? payload !== JSON.stringify(qrLinksPayload(saved.links)) : false;
  const problems = draft.map((l, i) =>
    qrLinkProblems(
      l,
      draft.filter((_, j) => j !== i).map((o) => normalizeQrCode(o.code))
    )
  );
  const hasProblem = problems.some((p) => Object.keys(p).length > 0);

  const patch = (key: string, change: Partial<QrLink>) => {
    setDraft((d) => d.map((l) => (l.key === key ? { ...l, ...change } : l)));
    setServerErrors({});
  };

  async function save() {
    setError(null);
    if (hasProblem) return;
    setSaving(true);
    try {
      adopt(await qrLinksApi.update(qrLinksPayload(draft)));
      toast.success('QR links saved.');
    } catch (err) {
      const inlineFields = draft.flatMap((_, i) => fieldIds.map((f) => `links.${i}.${f}`));
      const { inline, message } = splitServerErrors(err, inlineFields, 'Could not save the QR links.');
      setServerErrors(inline);
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <>
        <PageHeader title="QR links" />
        <p className="field__error" role="alert">
          {loadError}
        </p>
      </>
    );
  }
  if (!saved) return <Spinner label="Loading the QR links" />;

  return (
    <>
      <PageHeader
        title="QR links"
        description="The code printed on a jersey or poster never changes. Change where it leads here, any time."
      />
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {draft.length === 0 ? <p className="form__note">No QR links yet. Add one below.</p> : null}
        <div className="qr-list">
          {draft.map((l, i) => (
            <QrCard
              key={l.key}
              link={l}
              errors={{ ...problemsOf(l, problems[i]), ...serverFor(serverErrors, i) }}
              onChange={(change) => patch(l.key, change)}
              onRemove={() => setRemoving(l)}
              onCopied={() => toast.success('Short address copied.')}
              onCopyFailed={() => toast.error('Could not copy. Select the address and copy it.')}
            />
          ))}
        </div>

        <AddLink
          codes={draft.map((l) => normalizeQrCode(l.code))}
          full={draft.length >= QR_LIMITS.links}
          onAdd={(link) => {
            setDraft((d) => [...d, { ...link, key: `k${keys.current++}`, fresh: true, scans_total: 0, scans_7_days: 0, scans_today: 0, last_scan_at: null }]);
            setServerErrors({});
          }}
        />

        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="form__actions">
          {dirty ? <span className="field__hint">You have changes that are not saved yet.</span> : null}
          <button type="button" className="button button--ghost" disabled={!dirty || saving} onClick={() => adopt(saved)}>
            Discard changes
          </button>
          <button type="submit" className="button" disabled={!dirty || saving || hasProblem}>
            {saving ? <Spinner label="Saving" /> : 'Save'}
          </button>
        </div>
      </form>

      {removing ? (
        <ConfirmDialog
          title={`Remove "${removing.label.trim() || removing.code}"?`}
          message="Any code already printed will open the Blynk shop instead."
          confirmLabel="Remove"
          destructive
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            const key = removing.key;
            setDraft((d) => d.filter((l) => l.key !== key));
            setServerErrors({});
            setRemoving(null);
          }}
        />
      ) : null}
    </>
  );
}

function problemsOf(l: Draft, p: Partial<Record<keyof QrLink, string>> | undefined) {
  // A fresh card is checked as the person types; a saved one only complains about what they changed.
  return { label: p?.label, url: p?.url, code: l.fresh ? p?.code : undefined };
}
function serverFor(all: Record<string, string>, i: number) {
  const out: Partial<Record<keyof QrLink, string>> = {};
  for (const f of fieldIds) {
    const m = all[`links.${i}.${f}`];
    if (m) out[f] = m;
  }
  return out;
}

/** The QR picture, drawn in the browser from the short address. */
function QrImage({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setSvg(null);
    qrSvg(code)
      .then((s) => live && setSvg(s))
      .catch(() => live && setSvg(null));
    return () => {
      live = false;
    };
  }, [code]);
  return (
    <div className="qr-card__image" role="img" aria-label={`QR code for ${qrShortAddress(code)}`}>
      {svg ? <div dangerouslySetInnerHTML={{ __html: svg }} /> : <Spinner label="Drawing the QR code" />}
    </div>
  );
}

function QrCard({
  link,
  errors,
  onChange,
  onRemove,
  onCopied,
  onCopyFailed,
}: {
  link: Draft;
  errors: Partial<Record<keyof QrLink, string>>;
  onChange(change: Partial<QrLink>): void;
  onRemove(): void;
  onCopied(): void;
  onCopyFailed(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const address = qrShortAddress(link.code);
  const tagged = hasCampaignTags(link.url);
  const canTag = !qrLinkProblems({ ...link, label: 'x' }).url;

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      onCopied();
    } catch {
      onCopyFailed();
    }
  }
  async function download(kind: 'svg' | 'png') {
    setDownloadError(null);
    setBusy(true);
    try {
      if (kind === 'svg') saveSvg(await qrSvg(link.code), qrFileName(link.code, 'svg'));
      else saveHref(await qrPngDataUrl(link.code), qrFileName(link.code, 'png'));
    } catch {
      setDownloadError('Could not make the QR image. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="qr-card" aria-label={`QR link ${link.code}`}>
      <div className="qr-card__main">
        <div className="qr-card__head">
          <input
            className="input qr-card__name"
            aria-label={`Name of ${link.code}`}
            value={link.label}
            maxLength={QR_LIMITS.label}
            onChange={(e) => onChange({ label: e.target.value })}
          />
          {link.fresh ? <span className="field__hint">Not saved yet</span> : null}
          <button type="button" className="button button--ghost button--sm" onClick={onRemove}>
            Remove
          </button>
        </div>
        {errors.label ? <p className="field__error">{errors.label}</p> : null}

        <div className="qr-card__row">
          <span className="field__label">Short address</span>
          <input className="input" readOnly value={address} aria-label={`Short address of ${link.code}`} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="button button--ghost" onClick={() => void copy()}>
            Copy
          </button>
        </div>

        <div className="qr-card__row">
          <span className="field__label">Opens</span>
          <input
            className="input"
            type="url"
            inputMode="url"
            aria-label={`Opens for ${link.code}`}
            value={link.url}
            maxLength={QR_LIMITS.url}
            placeholder="https://blynk.lk/app/"
            onChange={(e) => onChange({ url: e.target.value })}
          />
          {canTag ? (
            <a className="button button--ghost" href={link.url.trim()} target="_blank" rel="noopener noreferrer" aria-label={`Test ${link.code}`}>
              Test
            </a>
          ) : (
            <span className="button button--ghost" aria-disabled="true" style={{ opacity: 0.5 }}>
              Test
            </span>
          )}
        </div>
        {errors.url ? <p className="field__error">{errors.url}</p> : null}
        {!errors.url && leavesBlynk(link.url) ? <p className="qr-card__warn">This leaves blynk.lk</p> : null}
        <label className="qr-card__tags">
          <input
            type="checkbox"
            checked={tagged}
            disabled={!canTag}
            onChange={(e) => onChange({ url: e.target.checked ? withCampaignTags(link.url, link.code) : withoutCampaignTags(link.url) })}
          />
          <span>Add campaign tags</span>
          <span className="field__hint">
            utm_source={link.code}&amp;utm_medium=qr&amp;utm_campaign={link.code}, so Google Analytics shows these scans.
          </span>
        </label>

        <dl className="qr-card__stats">
          <div>
            <dt>Scans today</dt>
            <dd>{link.scans_today}</dd>
          </div>
          <div>
            <dt>Last 7 days</dt>
            <dd>{link.scans_7_days}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>{link.scans_total}</dd>
          </div>
          <div>
            <dt>Last scan</dt>
            <dd>{lastScanText(link.last_scan_at)}</dd>
          </div>
        </dl>
        {errors.code ? <p className="field__error">{errors.code}</p> : null}
      </div>

      <div className="qr-card__side">
        <QrImage code={link.code} />
        <div className="qr-card__downloads">
          <button type="button" className="button button--ghost button--sm" disabled={busy} onClick={() => void download('svg')}>
            Download SVG
          </button>
          <button type="button" className="button button--ghost button--sm" disabled={busy} onClick={() => void download('png')}>
            Download PNG
          </button>
        </div>
        <p className="field__hint">Use the SVG for printing.</p>
        {downloadError ? <p className="field__error">{downloadError}</p> : null}
      </div>
    </section>
  );
}

function AddLink({ codes, full, onAdd }: { codes: string[]; full: boolean; onAdd(link: QrLink): void }) {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [shown, setShown] = useState(false);
  const problems = shown ? qrLinkProblems({ code, label, url }, codes) : {};
  const codeIssue = code ? qrCodeProblem(code, codes) : null;

  function add() {
    setShown(true);
    if (Object.keys(qrLinkProblems({ code, label, url }, codes)).length > 0) return;
    onAdd({ code: normalizeQrCode(code), label: label.trim(), url: url.trim() });
    setCode('');
    setLabel('');
    setUrl('');
    setShown(false);
  }

  return (
    <section className="form__section" aria-label="Add a QR link">
      <h2 className="form__section-title">Add QR link</h2>
      <p className="form__note">
        The code becomes the short address, for example {qrShortAddress('poster')}. Once it is printed it cannot be renamed.
      </p>
      <div
        className="qr-add"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
            e.preventDefault();
            add();
          }
        }}
      >
        <label className="field">
          <span className="field__label">Code</span>
          <input
            className="input"
            aria-label="New code"
            value={code}
            maxLength={QR_LIMITS.code}
            placeholder="poster"
            autoCapitalize="none"
            onChange={(e) => setCode(e.target.value.toLowerCase())}
          />
          {problems.code || (shown ? null : codeIssue) ? <span className="field__error">{problems.code ?? codeIssue}</span> : null}
        </label>
        <label className="field">
          <span className="field__label">Name</span>
          <input className="input" aria-label="New name" value={label} maxLength={QR_LIMITS.label} placeholder="Shop poster" onChange={(e) => setLabel(e.target.value)} />
          {problems.label ? <span className="field__error">{problems.label}</span> : null}
        </label>
        <label className="field">
          <span className="field__label">Opens</span>
          <input
            className="input"
            type="url"
            inputMode="url"
            aria-label="New destination"
            value={url}
            maxLength={QR_LIMITS.url}
            placeholder="https://blynk.lk/app/"
            onChange={(e) => setUrl(e.target.value)}
          />
          {problems.url ? <span className="field__error">{problems.url}</span> : null}
        </label>
        <button type="button" className="button" disabled={full} onClick={add}>
          Add QR link
        </button>
      </div>
      {full ? <p className="form__note">The most you can have is {QR_LIMITS.links} QR links.</p> : null}
    </section>
  );
}
