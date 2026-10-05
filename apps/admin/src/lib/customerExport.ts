import type { CustomerExportRow } from '../api/types';
import { formatDay } from './coupons';
import { loadXlsx } from './productImport';

/**
 * The Customers "Download Excel" sheet (2026-10-05): one row per customer,
 * by name, for promotional SMS sent by hand. Phone numbers are written as
 * text so Excel keeps the + and never turns them into 9.48E+10.
 */
export const CUSTOMER_EXPORT_COLUMNS = [
  'Name',
  'Phone',
  'Phone (SMS format)',
  'Orders',
  'Delivered spend (LKR)',
  'Last order',
  'Joined',
  'Account',
] as const;

export function customerSheetRows(rows: CustomerExportRow[]): (string | number)[][] {
  return [
    [...CUSTOMER_EXPORT_COLUMNS],
    ...rows.map((c) => [
      c.full_name?.trim() || '',
      c.phone,
      // 94771234567: the form most bulk SMS portals take for uploads.
      c.phone.replace(/^\+/, ''),
      c.orders_count,
      c.delivered_spend,
      c.last_order_at ? formatDay(c.last_order_at) : 'Never',
      formatDay(c.created_at),
      c.is_active ? 'Active' : 'Blocked',
    ]),
  ];
}

export async function buildCustomersXlsx(rows: CustomerExportRow[]): Promise<Blob> {
  const XLSX = await loadXlsx();
  const sheet = XLSX.utils.aoa_to_sheet(customerSheetRows(rows));
  sheet['!cols'] = [{ wch: 28 }, { wch: 16 }, { wch: 18 }, { wch: 8 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 10 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Customers');
  const out = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** blynk-customers-2026-10-05.xlsx, dated in Colombo. */
export const customerExportFilename = (now = new Date()) =>
  `blynk-customers-${now.toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })}.xlsx`;
