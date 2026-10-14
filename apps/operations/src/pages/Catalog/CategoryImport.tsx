import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { catalog } from '../../api/resources';
import type {
  CategoryImportCounts,
  CategoryImportIssue,
  CategoryImportNodeBase,
  CategoryImportResult,
  CategoryImportSheetRow,
} from '../../api/types';
import { PageHeader } from '../../components/Layout';
import { Spinner, Status, type Tone } from '../../components/ui';
import { catalogErrorMessage } from '../../lib/catalog';
import {
  CATEGORY_SHEET_COLUMNS,
  MAX_CATEGORY_TEXT,
  OWNER_CATEGORY_SETUP,
  importActionLabel,
  parseCategorySheet,
} from '../../lib/categoryImport';
import { isSupportedFile, readImportFile } from '../../lib/productImport';

type Source = { kind: 'text' } | { kind: 'file'; name: string; rows: CategoryImportSheetRow[] };

/**
 * Import categories (2026-10-14): paste the owner's list (pre-filled from
 * GET /admin/categories/import/template) or pick an .xlsx/.csv sheet
 * (main, category, sub_category, active - parsed here like the product
 * import), Preview (a dry run: the tree with New / Update / Keep per item),
 * then Apply. Apply is only enabled after a preview with no errors for
 * exactly the input on screen; changing the text or the file needs a new
 * preview.
 */
export function CategoryImport() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState<string | null>(null);
  const [templateNote, setTemplateNote] = useState<string | null>(null);
  const [source, setSource] = useState<Source>({ kind: 'text' });
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [preview, setPreview] = useState<CategoryImportResult | null>(null);
  /** The input the preview was made for; Apply needs it to match the screen. */
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [applied, setApplied] = useState<CategoryImportResult | null>(null);
  const [busy, setBusy] = useState<'reading' | 'preview' | 'apply' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    catalog.categories
      .importTemplate()
      .then((t) => {
        if (!cancelled) setText((current) => current ?? t.text);
      })
      .catch(() => {
        if (cancelled) return;
        setText((current) => current ?? OWNER_CATEGORY_SETUP);
        setTemplateNote('Could not load the list from the server, so the saved copy of the owner list is shown.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const body = source.kind === 'file' ? { rows: source.rows } : { text: text ?? '' };
  const currentKey = JSON.stringify(body);
  const previewIsCurrent = preview !== null && previewKey === currentKey;
  const canApply = previewIsCurrent && preview.errors.length === 0 && busy === null;

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setFileErrors([]);
    setPreview(null);
    setApplied(null);
    if (!isSupportedFile(file.name)) {
      setError('Choose an .xlsx or .csv file.');
      return;
    }
    setBusy('reading');
    try {
      const parsed = parseCategorySheet(await readImportFile(file));
      setFileErrors(parsed.fileErrors);
      setSource({ kind: 'file', name: file.name, rows: parsed.rows });
    } catch {
      setError('Could not read this file. Save it as .xlsx or .csv and try again.');
    } finally {
      setBusy(null);
    }
  }

  function switchToText() {
    setSource({ kind: 'text' });
    setFileErrors([]);
    setPreview(null);
    setApplied(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function runPreview() {
    setError(null);
    setApplied(null);
    if (source.kind === 'text' && !(text ?? '').trim()) {
      setError('Paste the category list first.');
      return;
    }
    if (source.kind === 'file' && fileErrors.length > 0) return;
    setBusy('preview');
    const key = currentKey;
    try {
      setPreview(await catalog.categories.import(body, true));
      setPreviewKey(key);
    } catch (err) {
      setPreview(null);
      setError(catalogErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function runApply() {
    if (!canApply) return;
    setError(null);
    setBusy('apply');
    try {
      const result = await catalog.categories.import(body, false);
      setApplied(result);
      setPreview(null);
      setPreviewKey(null);
    } catch (err) {
      // 400 CATEGORY_IMPORT_INVALID carries the errors; show them as a preview would.
      if (err instanceof ApiError && err.code === 'CATEGORY_IMPORT_INVALID') {
        const errors = (err.details as { errors?: CategoryImportIssue[] } | undefined)?.errors ?? [];
        setPreview((current) => (current ? { ...current, errors } : current));
      }
      setError(catalogErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const tooLong = source.kind === 'text' && (text ?? '').length > MAX_CATEGORY_TEXT;

  return (
    <div className="page">
      <PageHeader
        title="Import categories"
        description="Set up the home sections, category tiles and sidebars from one list."
        actions={
          <Link className="button button--ghost" to="/catalog/categories">
            Back
          </Link>
        }
      />

      <section className="card import-steps" aria-label="How the import works">
        <div className="card__note">
          <ul>
            <li>
              <strong>Main</strong> = a home section (category group), e.g. <span className="mono">1. GROCERY</span>.
            </li>
            <li>
              <strong>Category</strong> = a tile in that section, e.g. <span className="mono">- Rice &amp; Flour</span>.
            </li>
            <li>
              <strong>Sub-category</strong> = the sidebar inside the category, after →, split by |, e.g.{' '}
              <span className="mono">→ Rice | Flour</span>.
            </li>
            <li>Write (add later) after a name to create it switched off.</li>
            <li>Nothing is deleted or switched off, and products are not touched. Items are matched by name.</li>
          </ul>
        </div>
      </section>

      {source.kind === 'text' ? (
        <section className="section">
          <label className="field">
            <span className="field__label">Category list</span>
            {text === null ? (
              <Spinner label="Loading the owner list" />
            ) : (
              <textarea
                className="input mono"
                rows={14}
                value={text}
                onChange={(e) => setText(e.target.value)}
                spellCheck={false}
              />
            )}
            {tooLong ? (
              <span className="field__error-text">The list can be at most {MAX_CATEGORY_TEXT} characters.</span>
            ) : null}
          </label>
          {templateNote ? <p className="quiet">{templateNote}</p> : null}
        </section>
      ) : (
        <section className="section">
          <p className="quiet">
            Using the sheet <strong>{source.name}</strong> ({source.rows.length} {source.rows.length === 1 ? 'row' : 'rows'}).{' '}
            <button type="button" className="button button--ghost button--sm" onClick={switchToText} disabled={busy !== null}>
              Use the pasted list instead
            </button>
          </p>
        </section>
      )}

      <section className="card import-steps">
        <label className="field">
          <span className="field__label">Or choose an .xlsx or .csv file</span>
          <input
            ref={inputRef}
            className="input"
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            onChange={(e) => void onFile(e)}
            disabled={busy !== null}
          />
          <span className="field__hint">
            Columns: <span className="mono">{CATEGORY_SHEET_COLUMNS.join(', ')}</span>. One row per sub-category (or per
            category with no sub-categories); active is yes or no (blank = yes).
          </span>
        </label>
      </section>

      {fileErrors.map((e) => (
        <p key={e} className="field__error" role="alert">
          {e}
        </p>
      ))}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      {busy === 'reading' ? <Spinner label="Reading the file" /> : null}

      <div className="actions-row">
        <button
          type="button"
          className="button button--ghost"
          onClick={() => void runPreview()}
          disabled={busy !== null || tooLong || (source.kind === 'text' && text === null) || (source.kind === 'file' && fileErrors.length > 0)}
        >
          {busy === 'preview' ? <Spinner label="Checking the list" /> : 'Preview'}
        </button>
        <button type="button" className="button" onClick={() => void runApply()} disabled={!canApply}>
          {busy === 'apply' ? <Spinner label="Applying" /> : 'Apply'}
        </button>
      </div>
      {preview && !previewIsCurrent ? <p className="quiet">The list changed since the preview. Preview again before applying.</p> : null}
      {preview && previewIsCurrent && preview.errors.length > 0 ? (
        <p className="quiet">Fix the errors below, then preview again.</p>
      ) : null}

      {preview ? <ImportOutcome result={preview} heading="Preview" /> : null}

      {applied ? (
        <>
          <p className="quiet quiet--ok" role="status">
            Categories imported.
          </p>
          <ImportOutcome result={applied} heading="Imported" />
          <div className="actions-row">
            <Link className="button" to="/catalog/categories">
              Back to categories
            </Link>
          </div>
        </>
      ) : null}
    </div>
  );
}

function countsText(label: string, c: CategoryImportCounts): string {
  return `${label}: ${c.create} new · ${c.update} update · ${c.keep} keep`;
}

const ACTION_TONE: Record<CategoryImportNodeBase['action'], Tone> = { create: 'ok', update: 'info', keep: 'muted' };

function NodeLine({ node, kind }: { node: CategoryImportNodeBase; kind: string }) {
  return (
    <div className="cat-import__node">
      <span className="cat-import__name">{node.name}</span>
      <span className="cat-import__badges">
        <Status tone={ACTION_TONE[node.action]}>{importActionLabel(node)}</Status>
        {node.active ? null : <Status tone="warn">Off (hidden)</Status>}
        <span className="visually-hidden">{kind}</span>
      </span>
      {node.changes.length > 0 ? (
        <ul className="cat-import__notes">
          {node.changes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : null}
      {node.warnings.length > 0 ? (
        <ul className="cat-import__notes cat-import__notes--warn">
          {node.warnings.map((w) => (
            <li key={w}>Warning: {w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function lineLabel(issue: CategoryImportIssue): string {
  return issue.line === null ? issue.message : `Line ${issue.line}: ${issue.message}`;
}

function ImportOutcome({ result, heading }: { result: CategoryImportResult; heading: string }) {
  const { summary } = result;
  return (
    <section className="section" aria-label={heading}>
      <h2 className="section-label">{heading}</h2>
      <div className="card">
        <p className="card__note">{countsText('Main sections', summary.mains)}</p>
        <p className="card__note">{countsText('Categories', summary.categories)}</p>
        <p className="card__note">{countsText('Sub-categories', summary.sub_categories)}</p>
        {summary.others_reordered > 0 ? (
          <p className="card__note">{summary.others_reordered} other categories move after the listed ones.</p>
        ) : null}
      </div>

      {result.errors.length > 0 ? (
        <div role="alert" aria-label="Errors">
          {result.errors.map((e, i) => (
            <p key={`${e.line}-${i}`} className="field__error">
              {lineLabel(e)}
            </p>
          ))}
        </div>
      ) : null}
      {result.warnings.map((w) => (
        <p key={w} className="quiet">
          Warning: {w}
        </p>
      ))}

      {result.tree.length > 0 ? (
        <ul className="cat-import" aria-label="Category tree">
          {result.tree.map((main) => (
            <li key={`${main.source}-${main.name}`} className="cat-import__main">
              <NodeLine node={main} kind="Main section" />
              {main.categories.length > 0 ? (
                <ul className="cat-import__level">
                  {main.categories.map((category) => (
                    <li key={`${category.source}-${category.name}`}>
                      <NodeLine node={category} kind="Category" />
                      {category.sub_categories.length > 0 ? (
                        <ul className="cat-import__level">
                          {category.sub_categories.map((sub) => (
                            <li key={`${sub.source}-${sub.name}`}>
                              <NodeLine node={sub} kind="Sub-category" />
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {result.ignored_lines.length > 0 ? (
        <details className="card">
          <summary>
            {result.ignored_lines.length} {result.ignored_lines.length === 1 ? 'line' : 'lines'} ignored
          </summary>
          <ul className="cat-import__notes">
            {result.ignored_lines.map((l, i) => (
              <li key={`${l.line}-${i}`}>{lineLabel(l)}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
