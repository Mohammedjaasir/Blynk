import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { categories as categoriesApi } from '../api/resources';
import type {
  CategoryImportAction,
  CategoryImportCounts,
  CategoryImportInput,
  CategoryImportIssue,
  CategoryImportNode,
  CategoryImportResult,
  CategoryImportSheetRow,
} from '../api/types';
import { PageHeader } from '../components/Layout';
import { Badge, Spinner, useToast } from '../components/ui';
import { errorMessage } from '../lib/apiErrors';
import {
  CATEGORY_TEMPLATE_COLUMNS,
  CATEGORY_TEMPLATE_ROWS,
  MAX_CATEGORY_IMPORT_TEXT,
  OWNER_CATEGORY_SETUP,
  buildCategoryTemplateXlsx,
  parseCategoryFile,
} from '../lib/categoryImport';
import { downloadBlob, toCsv } from '../lib/productImport';

const ACTION_LABEL: Record<CategoryImportAction, string> = { create: 'New', update: 'Update', keep: 'Keep' };
const ACTION_TONE: Record<CategoryImportAction, 'active' | 'offer' | 'muted'> = {
  create: 'active',
  update: 'offer',
  keep: 'muted',
};

type Source = 'text' | 'file';

/**
 * Import categories (owner, 2026-10-14; ADMIN and OPERATIONS on the API).
 * The owner's list is pre-filled (GET /admin/categories/import/template,
 * with a local copy if that fails); a .xlsx/.csv with main, category,
 * sub_category, active works too. "Preview" is a dry run that shows the
 * Main -> Category -> Sub-category tree with New / Update / Keep per node;
 * "Apply" writes it, and only once a preview of the current input came back
 * without errors. Nothing is deleted and products are never touched.
 */
export function CategoryImport() {
  const navigate = useNavigate();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [source, setSource] = useState<Source>('text');
  const [text, setText] = useState<string | null>(null);
  const [templateNote, setTemplateNote] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileRows, setFileRows] = useState<CategoryImportSheetRow[] | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  // Bumped on every input change: Apply needs a preview of THIS input.
  const [version, setVersion] = useState(0);
  const [preview, setPreview] = useState<{ result: CategoryImportResult; version: number } | null>(null);
  const [applied, setApplied] = useState<CategoryImportResult | null>(null);
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    categoriesApi
      .importTemplate()
      .then((t) => {
        if (cancelled) return;
        setText((current) => current ?? t.text);
      })
      .catch(() => {
        if (cancelled) return;
        setText((current) => current ?? OWNER_CATEGORY_SETUP);
        setTemplateNote('Could not load the list from the store, so the saved copy of the owner list is shown.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function changed() {
    setVersion((v) => v + 1);
    setRequestError(null);
    setApplied(null);
  }

  function input(): CategoryImportInput | null {
    if (source === 'text') return text && text.trim() ? { text } : null;
    return fileRows && fileRows.length && !fileError ? { rows: fileRows } : null;
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    changed();
    setFileName(file.name);
    setFileRows(null);
    setFileError(null);
    try {
      const parsed = await parseCategoryFile(file);
      setFileError(parsed.fileError);
      setFileRows(parsed.fileError ? null : parsed.rows);
    } catch {
      setFileError('Could not read that file. Save it as .xlsx or .csv and try again.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function runPreview() {
    const body = input();
    if (!body) return;
    const at = version;
    setBusy('preview');
    setRequestError(null);
    setApplied(null);
    try {
      const result = await categoriesApi.importCategories(body, true);
      setPreview({ result, version: at });
    } catch (err) {
      setPreview(null);
      setRequestError(errorMessage(err, 'Could not preview the import.'));
    } finally {
      setBusy(null);
    }
  }

  async function runApply() {
    const body = input();
    if (!body || !canApply) return;
    setBusy('apply');
    setRequestError(null);
    try {
      const result = await categoriesApi.importCategories(body, false);
      setApplied(result);
      setPreview(null);
      toast.success('Categories imported.');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CATEGORY_IMPORT_INVALID') {
        setPreview(null);
        setRequestError('The store found errors in the list. Preview again to see them.');
      } else {
        setRequestError(errorMessage(err, 'Could not import the categories. Nothing was changed.'));
      }
    } finally {
      setBusy(null);
    }
  }

  async function downloadTemplate(kind: 'xlsx' | 'csv') {
    try {
      if (kind === 'csv') {
        downloadBlob(new Blob([toCsv(CATEGORY_TEMPLATE_ROWS)], { type: 'text/csv;charset=utf-8' }), 'blynk-categories-template.csv');
      } else {
        downloadBlob(await buildCategoryTemplateXlsx(), 'blynk-categories-template.xlsx');
      }
    } catch {
      toast.error('Could not build the template.');
    }
  }

  const current = preview && preview.version === version ? preview.result : null;
  const shown = applied ?? preview?.result ?? null;
  const stale = preview !== null && preview.version !== version;
  const canApply = current !== null && current.errors.length === 0 && busy === null;
  const hasInput = input() !== null;

  return (
    <>
      <PageHeader
        title="Import categories"
        description="Set up the whole category list at once: main sections, their category tiles and each category's sidebar."
        actions={
          <button type="button" className="button button--ghost" onClick={() => navigate('/categories')}>
            Back to categories
          </button>
        }
      />

      <section className="panel import__steps" aria-label="How the import works">
        <ul className="import__rules" aria-label="How the levels map">
          <li>
            <strong>Main</strong> = a home section (category group), e.g. "1. GROCERY".
          </li>
          <li>
            <strong>Category</strong> = a tile in that section, e.g. "- Rice &amp; Flour".
          </li>
          <li>
            <strong>Sub-category</strong> = the sidebar inside the category, e.g. "→ Rice | Flour".
          </li>
          <li>
            Existing items are matched by name and keep their photo, offer, markup and on/off. Nothing is deleted and
            products are not touched. "(add later)" after a name creates it switched off.
          </li>
        </ul>
      </section>

      <section className="panel import__steps" aria-label="List">
        <div className="cat-import__source" role="radiogroup" aria-label="Import from">
          <label className="toggle">
            <input
              type="radio"
              name="category-import-source"
              checked={source === 'text'}
              onChange={() => {
                setSource('text');
                changed();
              }}
            />
            <span>Paste a list</span>
          </label>
          <label className="toggle">
            <input
              type="radio"
              name="category-import-source"
              checked={source === 'file'}
              onChange={() => {
                setSource('file');
                changed();
              }}
            />
            <span>Upload Excel / CSV</span>
          </label>
        </div>

        {source === 'text' ? (
          text === null ? (
            <Spinner label="Loading the category list" />
          ) : (
            <label className="field">
              <span className="field__label">Category list</span>
              <textarea
                className="input mono"
                rows={18}
                maxLength={MAX_CATEGORY_IMPORT_TEXT}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  changed();
                }}
              />
              <span className="field__hint">
                "N. NAME" starts a main section, "- Name" adds a category to it, "→ Sub | Sub" lists its sub-categories.
                Other lines are ignored.
              </span>
              {templateNote ? <span className="field__hint">{templateNote}</span> : null}
            </label>
          )
        ) : (
          <>
            <p className="panel__body">
              Columns: <span className="mono">{CATEGORY_TEMPLATE_COLUMNS.join(', ')}</span>. One row per sub-category
              (or per category without one); active is yes or no (blank = yes).
            </p>
            <div className="row-actions">
              <button type="button" className="button button--ghost" onClick={() => void downloadTemplate('xlsx')}>
                Download template
              </button>
              <button type="button" className="button button--ghost" onClick={() => void downloadTemplate('csv')}>
                Template as CSV
              </button>
            </div>
            <label className="field">
              <span className="field__label">Spreadsheet (.xlsx or .csv)</span>
              <input
                ref={fileRef}
                className="input"
                type="file"
                accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                onChange={(e) => void onFile(e)}
              />
            </label>
            {fileName ? (
              <p className="form__note">
                File: {fileName}
                {fileRows ? ` (${fileRows.length} rows)` : ''}
              </p>
            ) : null}
            {fileError ? <p className="field__error">{fileError}</p> : null}
          </>
        )}

        <div className="row-actions">
          <button
            type="button"
            className="button button--ghost"
            disabled={!hasInput || busy !== null}
            onClick={() => void runPreview()}
          >
            {busy === 'preview' ? <Spinner label="Checking the list" /> : 'Preview'}
          </button>
          <button type="button" className="button" disabled={!canApply} onClick={() => void runApply()}>
            {busy === 'apply' ? <Spinner label="Importing" /> : 'Apply'}
          </button>
        </div>
        {stale && !applied ? <p className="form__note">The list changed since the preview. Preview again to apply.</p> : null}
        {current && current.errors.length > 0 ? (
          <p className="form__note">Fix the errors below and preview again; nothing can be applied while there are errors.</p>
        ) : null}
        {requestError ? (
          <p className="field__error" role="alert">
            {requestError}
          </p>
        ) : null}
      </section>

      {applied ? (
        <section className="panel import__summary" aria-label="Import result">
          <h2 className="panel__title">Categories imported</h2>
          <p className="panel__body">{summaryText(applied)}</p>
          <div className="row-actions">
            <Link className="button" to="/categories">
              Back to categories
            </Link>
          </div>
        </section>
      ) : null}

      {shown ? <ImportReport result={shown} applied={applied !== null} /> : null}
    </>
  );
}

function countsText(label: string, c: CategoryImportCounts): string {
  return `${label}: ${c.create} new, ${c.update} updated, ${c.keep} unchanged`;
}

function summaryText(result: CategoryImportResult): string {
  const s = result.summary;
  return [
    countsText('Main sections', s.mains),
    countsText('Categories', s.categories),
    countsText('Sub-categories', s.sub_categories),
  ].join(' · ');
}

function lineText(issue: CategoryImportIssue): string {
  return issue.line === null ? issue.message : `Line ${issue.line}: ${issue.message}`;
}

function ImportReport({ result, applied }: { result: CategoryImportResult; applied: boolean }) {
  return (
    <section className="panel import__summary" aria-label={applied ? 'What was imported' : 'Preview'}>
      <h2 className="panel__title">{applied ? 'What was imported' : 'Preview'}</h2>
      {!applied ? <p className="panel__body">{summaryText(result)}</p> : null}
      {result.summary.others_reordered > 0 ? (
        <p className="form__note">
          {result.summary.others_reordered} existing main sections and categories that are not in the list keep their
          order after the listed ones.
        </p>
      ) : null}

      {result.errors.length > 0 ? (
        <div>
          <h3 className="editor__legend">Errors</h3>
          <ul className="import__errors" aria-label="Errors">
            {result.errors.map((e, i) => (
              <li key={i} className="field__error">
                {lineText(e)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.warnings.length > 0 ? (
        <div>
          <h3 className="editor__legend">Warnings</h3>
          <ul className="import__errors" aria-label="Warnings">
            {result.warnings.map((w, i) => (
              <li key={i} className="import__warning">
                {w}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ul className="cat-import__tree" aria-label="Category tree">
        {result.tree.map((main) => (
          <li key={`m-${main.source}-${main.name}`}>
            <TreeNode node={main} level="Main" />
            {main.categories.length ? (
              <ul>
                {main.categories.map((category) => (
                  <li key={`c-${category.source}-${category.name}`}>
                    <TreeNode node={category} level="Category" />
                    {category.sub_categories.length ? (
                      <ul>
                        {category.sub_categories.map((sub) => (
                          <li key={`s-${sub.source}-${sub.name}`}>
                            <TreeNode node={sub} level="Sub-category" />
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

      {result.ignored_lines.length > 0 ? (
        <div>
          <h3 className="editor__legend">Ignored lines</h3>
          <ul className="import__errors" aria-label="Ignored lines">
            {result.ignored_lines.map((l, i) => (
              <li key={i} className="cell__secondary">
                {lineText(l)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function TreeNode({ node, level }: { node: CategoryImportNode; level: 'Main' | 'Category' | 'Sub-category' }) {
  return (
    <div className="cat-import__node" data-level={level}>
      <span className="cat-import__level">{level}</span>
      <span className="cell__primary">{node.name}</span>
      <Badge tone={ACTION_TONE[node.action]}>{ACTION_LABEL[node.action]}</Badge>
      {node.active ? null : <Badge tone="inactive">Off (hidden)</Badge>}
      {node.changes.length ? <span className="cell__secondary">{node.changes.join('; ')}</span> : null}
      {node.warnings.map((w, i) => (
        <span key={i} className="import__warning">
          {w}
        </span>
      ))}
    </div>
  );
}
