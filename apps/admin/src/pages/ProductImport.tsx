import { useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { products as productsApi } from '../api/resources';
import type { ImportResponse, ImportResultRow } from '../api/types';
import { PageHeader } from '../components/Layout';
import { EmptyState, Spinner, useToast } from '../components/ui';
import {
  TEMPLATE_COLUMNS,
  buildTemplateXlsx,
  downloadBlob,
  errorsCsv,
  parseImportFile,
  templateCsv,
  type ValidatedRow,
} from '../lib/productImport';

const STATUS_TEXT: Record<ImportResultRow['status'], string> = {
  created: 'Will be added',
  updated: 'Will update the existing product',
  skipped: 'No change',
  error: 'Error',
};

/**
 * Bulk product import (API contract §4): the file is parsed here, each row
 * checked, then the server's dry run says what would happen before anything
 * is written. Idempotent on SKU - importing the same file twice updates or
 * skips, never duplicates.
 */
export function ProductImport() {
  const navigate = useNavigate();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ValidatedRow[] | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [dryRun, setDryRun] = useState<ImportResponse | null>(null);
  const [dryRunError, setDryRunError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResponse | null>(null);

  const clientValid = (rows ?? []).filter((r) => r.errors.length === 0);
  const serverByRow = new Map((dryRun?.results ?? []).map((r) => [r.row, r]));
  const toImport = clientValid.filter((r) => serverByRow.get(r.row)?.status !== 'error');
  const clientErrorCount = (rows ?? []).filter((r) => r.errors.length > 0).length;

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setRows(null);
    setFileError(null);
    setDryRun(null);
    setDryRunError(null);
    setResult(null);
    setParsing(true);
    try {
      const parsed = await parseImportFile(file);
      setFileError(parsed.fileError);
      if (parsed.fileError) return;
      setRows(parsed.rows);
      const valid = parsed.rows.filter((r) => r.errors.length === 0);
      if (valid.length === 0) return;
      setChecking(true);
      try {
        setDryRun(await productsApi.importRows(valid.map((r) => r.data), true));
      } catch (err) {
        setDryRunError(err instanceof Error ? err.message : 'Could not check the file against the store.');
      } finally {
        setChecking(false);
      }
    } catch {
      setFileError('Could not read that file. Save it as .xlsx or .csv and try again.');
    } finally {
      setParsing(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function runImport() {
    if (importing || toImport.length === 0) return;
    setImporting(true);
    try {
      const response = await productsApi.importRows(
        toImport.map((r) => r.data),
        false
      );
      setResult(response);
      toast.success(
        `Import finished: ${response.summary.created} added, ${response.summary.updated} updated.`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The import failed. Nothing was changed.');
    } finally {
      setImporting(false);
    }
  }

  async function downloadTemplate() {
    try {
      downloadBlob(await buildTemplateXlsx(), 'blynk-products-template.xlsx');
    } catch {
      toast.error('Could not build the template.');
    }
  }

  function downloadErrors() {
    const csv = errorsCsv(rows ?? [], result ?? dryRun);
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'blynk-import-errors.csv');
  }

  const totalErrors = clientErrorCount + ((result ?? dryRun)?.summary.errors ?? 0);

  return (
    <>
      <PageHeader
        title="Import products"
        description="Add or update many products at once from a spreadsheet. Rows are matched on SKU, so importing the same file again updates instead of duplicating."
        actions={
          <button type="button" className="button button--ghost" onClick={() => navigate('/products')}>
            Back to products
          </button>
        }
      />

      <section className="panel import__steps" aria-label="File">
        <p className="panel__body">
          Columns, in this order: <span className="mono">{TEMPLATE_COLUMNS.join(', ')}</span>. Required: name,
          category (must already exist), unit, cost_price, sku.
        </p>
        <div className="row-actions">
          <button type="button" className="button button--ghost" onClick={() => void downloadTemplate()}>
            Download template
          </button>
          <button
            type="button"
            className="button button--ghost"
            onClick={() =>
              downloadBlob(new Blob([templateCsv()], { type: 'text/csv;charset=utf-8' }), 'blynk-products-template.csv')
            }
          >
            Template as CSV
          </button>
        </div>
        <label className="field">
          <span className="field__label">Spreadsheet (.xlsx or .csv)</span>
          <input
            ref={inputRef}
            className="input"
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            onChange={(e) => void onFile(e)}
          />
        </label>
        {fileName ? <p className="form__note">File: {fileName}</p> : null}
        {fileError ? <p className="field__error">{fileError}</p> : null}
      </section>

      {parsing && !rows ? <Spinner label="Reading the file" /> : null}

      {result ? (
        <section className="panel import__summary" aria-label="Import summary">
          <h2 className="panel__title">Import finished</h2>
          <p className="panel__body">
            {result.summary.created} created · {result.summary.updated} updated · {result.summary.skipped} skipped ·{' '}
            {result.summary.errors + clientErrorCount} errors
          </p>
          <div className="row-actions">
            {result.summary.errors + clientErrorCount > 0 ? (
              <button type="button" className="button button--ghost" onClick={downloadErrors}>
                Download errors
              </button>
            ) : null}
            <button type="button" className="button" onClick={() => navigate('/products')}>
              Back to products
            </button>
          </div>
        </section>
      ) : null}

      {rows && !result ? (
        rows.length === 0 ? (
          <EmptyState title="No products in this file" />
        ) : (
          <>
            <div className="import__bar">
              <p className="form__note">
                {rows.length} {rows.length === 1 ? 'row' : 'rows'} · {toImport.length} ready ·{' '}
                {rows.length - toImport.length} with errors
                {dryRun
                  ? ` · ${dryRun.summary.created} new, ${dryRun.summary.updated} updates, ${dryRun.summary.skipped} unchanged`
                  : ''}
              </p>
              {checking ? <Spinner label="Checking with the store" /> : null}
              {dryRunError ? <p className="field__error">{dryRunError}</p> : null}
              <div className="row-actions">
                {totalErrors > 0 ? (
                  <button type="button" className="button button--ghost" onClick={downloadErrors}>
                    Download errors
                  </button>
                ) : null}
                <button
                  type="button"
                  className="button"
                  disabled={importing || checking || toImport.length === 0}
                  onClick={() => void runImport()}
                >
                  {importing ? 'Importing…' : `Import ${toImport.length} ${toImport.length === 1 ? 'product' : 'products'}`}
                </button>
              </div>
            </div>
            <div className="table-wrap">
              <table className="table" aria-label="Preview">
                <thead>
                  <tr>
                    <th scope="col" className="num">Row</th>
                    <th scope="col">Product</th>
                    <th scope="col">Category</th>
                    <th scope="col" className="num">Cost</th>
                    <th scope="col" className="num">Selling</th>
                    <th scope="col">Stock</th>
                    <th scope="col">Check</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const server = serverByRow.get(r.row);
                    const messages = r.errors.length
                      ? r.errors.map((e) => `${e.field}: ${e.message}`)
                      : server?.status === 'error'
                        ? server.errors?.length
                          ? server.errors.map((e) => `${e.field}: ${e.message}`)
                          : [server.message ?? 'Rejected by the store.']
                        : [];
                    return (
                      <tr key={r.row} className={messages.length ? 'import__row--error' : undefined}>
                        <td className="num mono">{r.row}</td>
                        <td>
                          <span className="cell__primary">{r.data.name || '-'}</span>
                          <span className="cell__secondary">
                            {r.data.sku || '-'} · {r.data.unit || '-'}
                          </span>
                        </td>
                        <td>{r.data.category || '-'}</td>
                        <td className="num">{r.data.cost_price}</td>
                        <td className="num">{r.data.selling_price ?? 'Default'}</td>
                        <td className="cell__secondary">
                          {r.data.tracked === 'yes' ? `Tracked${r.data.opening_stock != null ? ` · ${r.data.opening_stock}` : ''}` : '-'}
                        </td>
                        <td>
                          {messages.length ? (
                            <ul className="import__errors">
                              {messages.map((m) => (
                                <li key={m} className="field__error">
                                  {m}
                                </li>
                              ))}
                            </ul>
                          ) : server ? (
                            <span className="cell__secondary">{server.message ?? STATUS_TEXT[server.status]}</span>
                          ) : (
                            <span className="cell__secondary">{checking ? 'Checking…' : 'Looks fine'}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : null}
    </>
  );
}
