import type { SellerStatus } from '../api/types';
import type { ChipTone } from './products';

/** The shop's approval status as a chip. */
export const STATUS_CHIP: Record<SellerStatus, { label: string; tone: ChipTone }> = {
  APPROVED: { label: 'Approved', tone: 'ok' },
  PENDING: { label: 'Waiting for approval', tone: 'wait' },
  REJECTED: { label: 'Not approved', tone: 'bad' },
  SUSPENDED: { label: 'Switched off', tone: 'off' },
};

/** "Nimal Farm" -> "NF", for the round badge beside the shop name. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? '?').slice(0, 2)).toUpperCase();
}

/** "October 2026" from an ISO timestamp (Colombo time). */
export function monthYear(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'Asia/Colombo' });
}
