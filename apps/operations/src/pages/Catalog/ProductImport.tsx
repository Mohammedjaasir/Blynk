import { useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { catalog } from '../../api/resources';
import type { ImportResult, ImportRowResult } from '../../api/types';
import { PageHeader } from '../../components/Layout';
import { Spinner } from '../../components/ui';
import { catalogErrorMessage } from '../../lib/catalog';
import {
  TEMPLATE_COLUMNS,
  buildTemplateBlob,
  downloadBlob,
  errorsCsv,
  isSupportedFile,
  parseSheet,
  readImportFile,
  resultLabel,
  type ParsedSheet,
} from '../../lib/productImport';

type Stage = 'pick' | 'reading' | 'checking' | 'preview' | 'importing' | 'done';

/**
 * Bulk product import from .xlsx/.csv (API contract §4). The file is parsed
 * here in the browser (lib/productImport.ts), checked row by row, then sent
 * as a server dry run so the preview shows what WOULD happen (added /
 * updated / no change / error) before anything is written. Only rows with no
 * file errors and no dry-run error are sent for the real import.
 *
 * Downloads (template, errors CSV) use a Blob + anchor - fine in a browser;
 * the Android WebView shell may ignore blob: downloads.
 */
export function ProductImport() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>('pick');
  const [fileName, setFileName] = useState<string | null>(null);
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [dryRun, setDryRun] = useState<ImportResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [templateBusy, setTemplateBusy] = useState(false);

  const dryByRow = new Map<number, ImportRowResult>((dryRun?.results ?? []).map((r) => [r.row, r]));
  const clientValid = (sheet?.rows ?? []).filter((r) => r.errors.length === 0);
  const toImport = clientValid.filter((r) => dryByRow.get(r.row)?.status !== 'error');
  const notSent = (sheet?.rows.length ?? 0) - toImport.length;

  async function downloadTemplate() {
    setTemplateBusy(true);
    try {
      downloadBlob(await buildTemplateBlob(), 'blynk-products-template.xlsx');
    } catch {
      setError('Could not build the template. Try again.');
    } finally {
      setTemplateBusy(false);
    }
  }

  function reset() {
    setStage('pick');
    setFileName(null);
    setSheet(null);
    setDryRun(null);
    setResult(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setDryRun(null);
    setResult(null);
    setSheet(null);
    setFileName(file.name);
    if (!isSupportedFile(file.name)) {
      setStage('pick');
      setError('Choose an .xlsx or .csv file.');
      return;
    }
    setStage('reading');
    let parsed: ParsedSheet;
    try {
      parsed = parseSheet(await readImportFile(file));
    } catch {
      setStage('pick');
      setError('Could not read this file. Save it as .xlsx or .csv and try again.');
      return;
    }
    setSheet(parsed);
    const valid = parsed.rows.filter((r) => r.errors.length === 0);
    if (parsed.fileErrors.length > 0 || valid.length === 0) {
      setStage('preview');
      return;
    }
    setStage('checking');
    try {
      setDryRun(await catalog.products.import(valid.map((r) => r.data), true));
    } catch (err) {
      setError(`Could not check the rows with the server: ${catalogErrorMessage(err)}`);
    }
    setStage('preview');
  }

  async function runImport() {
    if (!sheet || toImport.length === 0) return;
    setStage('importing');
    setError(null);
    try {
      setResult(await catalog.products.import(toImport.map((r) => r.data), false));
      setStage('done');
    } catch (err) {
      setError(catalogErrorMessage(err));
      setStage('preview');
    }
  }

  function downloadErrors() {
    if (!sheet) return;
    // After the import, the real results replace the dry run's; rows that
    // were never sent keep the dry-run reason.
    const sentRows = new Set(toImport.map((r) => r.row));
    const serverResults = result
      ? [...result.results, ...(dryRun?.results ?? []).filter((r) => !sentRows.has(r.row))]
      : (dryRun?.results ?? []);
    const csv = errorsCsv(sheet.rows, serverResults);
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'blynk-import-errors.csv');
  }

  const busy = stage === 'reading' || stage === 'checking' || stage === 'importing';
  const fileLevelErrors = sheet?.fileErrors ?? [];
  const errorCountBeforeImport =
    (sheet?.rows ?? []).filter((r) => r.errors.length > 0).length + (dryRun?.summary.errors ?? 0);

  return (
    <div className="page">
      <PageHeader
        title="Import products"
        description="Add or update many products at once from a spreadsheet. An existing SKU is updated with the row's values."
        actions={
          <Link className="button button--ghost" to="/catalog/products">
            Back
          </Link>
        }
      />

      <section className="card import-steps">
        <p className="card__note">
          1. Download the template and fill one product per row. Columns: <span className="mono">{TEMPLATE_COLUMNS.join(', ')}</span>.
        </p>
        <button type="button" className="button button--ghost" onClick={() => void downloadTemplate()} disabled={templateBusy}>
          {templateBusy ? <Spinner label="Building template" /> : 'Download template'}
        </button>
        <label className="field">
          <span className="field__label">2. Choose the filled .xlsx or .csv file</span>
          <input
            ref={inputRef}
            className="input"
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            onChange={(e) => void onFile(e)}
            disabled={busy}
          />
        </label>
        {fileName ? <p className="quiet">{fileName}</p> : null}
      </section>

      {error ? <p className="field__error" role="alert">{error}</p> : null}
      {stage === 'reading' ? <Spinner label="Reading the file" /> : null}
      {stage === 'checking' ? <Spinner label="Checking rows with the server" /> : null}

      {fileLevelErrors.map((e) => (
        <p key={e} className="field__error" role="alert">
          {e}
        </p>
      ))}
      {sheet && sheet.ignoredColumns.length > 0 ? (
        <p className="quiet">Ignored columns: {sheet.ignoredColumns.join(', ')}.</p>
      ) : null}

      {sheet && sheet.rows.length > 0 && stage !== 'done' ? (
        <section className="section">
          <h2 className="section-label">Preview</h2>
          <p className="quiet">
            {sheet.rows.length} {sheet.rows.length === 1 ? 'row' : 'rows'} in the file
            {dryRun
              ? ` · ${dryRun.summary.created} new · ${dryRun.summary.updated} updates · ${dryRun.summary.skipped} unchanged`
              : ''}
            {errorCountBeforeImport > 0 ? ` · ${errorCountBeforeImport} with errors` : ''}
          </p>
          <div className="import-table__wrap">
            <table className="import-table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Name</th>
                  <th>SKU</th>
                  <th>Category</th>
                  <th>Cost</th>
                  <th>Selling</th>
                  <th>Check</th>
                </tr>
              </thead>
              <tbody>
                {sheet.rows.map((r) => {
                  const server = dryByRow.get(r.row);
                  const bad = r.errors.length > 0 || server?.status === 'error';
                  return (
                    <tr key={r.row} className={bad ? 'import-table__row--bad' : undefined}>
                      <td className="mono">{r.row}</td>
                      <td>{r.data.name}</td>
                      <td className="mono">{r.data.sku}</td>
                      <td>{r.data.category}</td>
                      <td className="mono">{r.data.cost_price}</td>
                      <td className="mono">{r.data.selling_price ?? '—'}</td>
                      <td>
                        {r.errors.length > 0
                          ? r.errors.map((e) => `${e.field}: ${e.message}`).join(' ')
                          : resultLabel(server)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {notSent > 0 ? (
            <p className="quiet">
              {notSent} {notSent === 1 ? 'row has' : 'rows have'} errors and will not be imported. Fix the file and choose it again, or
              import the rest now.
            </p>
          ) : null}
          <div className="actions-row">
            <button type="button" className="button" onClick={() => void runImport()} disabled={busy || toImport.length === 0}>
              {stage === 'importing' ? (
                <Spinner label="Importing" />
              ) : (
                `Import ${toImport.length} ${toImport.length === 1 ? 'product' : 'products'}`
              )}
            </button>
            {errorCountBeforeImport > 0 ? (
              <button type="button" className="button button--ghost" onClick={downloadErrors}>
                Download errors
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {stage === 'done' && result ? (
        <section className="section" aria-label="Import summary">
          <h2 className="section-label">Import finished</h2>
          <div className="card">
            <p className="card__row">
              <span className="card__label">Created</span>
              <span className="card__value mono">{result.summary.created}</span>
            </p>
            <p className="card__row">
              <span className="card__label">Updated</span>
              <span className="card__value mono">{result.summary.updated}</span>
            </p>
            <p className="card__row">
              <span className="card__label">Skipped</span>
              <span className="card__value mono">{result.summary.skipped}</span>
            </p>
            <p className="card__row">
              <span className="card__label">Errors</span>
              <span className="card__value mono">{result.summary.errors + notSent}</span>
            </p>
          </div>
          {notSent > 0 ? <p className="quiet">Includes {notSent} {notSent === 1 ? 'row' : 'rows'} not sent because of errors.</p> : null}
          <div className="actions-row">
            {result.summary.errors + notSent > 0 ? (
              <button type="button" className="button button--ghost" onClick={downloadErrors}>
                Download errors
              </button>
            ) : null}
            <button type="button" className="button button--ghost" onClick={reset}>
              Import another file
            </button>
            <Link className="button" to="/catalog/products">
              Back to products
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}
