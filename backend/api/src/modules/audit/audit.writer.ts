import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../database/types.js';

/** Who made a change, as recorded in audit_logs (migration 001). */
export interface AuditActor {
  actorId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * audit_logs.entity_id is a NOT NULL UUID. Store-wide settings have no row id
 * of their own, so their entries use the nil UUID and name the setting in
 * new_values.key.
 */
export const SETTINGS_ENTITY_ID = '00000000-0000-0000-0000-000000000000';

/** Only a plain IPv4/IPv6 address goes into audit_logs.ip_address (INET). */
function inetOrNull(ip?: string | null): string | null {
  if (!ip) return null;
  const v = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  return /^[0-9.]+$/.test(v) || /^[0-9a-f:]+$/i.test(v) ? v : null;
}

export async function writeAudit(
  executor: Kysely<Database> | Transaction<Database>,
  actor: AuditActor,
  entry: {
    action: string;
    entityType: string;
    entityId: string;
    oldValues?: Record<string, unknown> | null;
    newValues?: Record<string, unknown> | null;
  }
) {
  await executor
    .insertInto('audit_logs')
    .values({
      actor_user_id: actor.actorId,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      old_values: entry.oldValues ? JSON.stringify(entry.oldValues) : null,
      new_values: entry.newValues ? JSON.stringify(entry.newValues) : null,
      ip_address: inetOrNull(actor.ipAddress),
      user_agent: actor.userAgent ?? null,
    })
    .execute();
}
