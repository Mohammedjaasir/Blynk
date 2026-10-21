/**
 * Push check: why a phone does or does not get Blynk notifications (owner, 2026-10-21: "I don't
 * receive notifications in ops app for new orders"; riders get none for a new delivery).
 *
 * Shows every step a push goes through: the Firebase key on the server, the outbox worker, which
 * phones are registered (by role), and what happened to the latest pushes. Changes nothing.
 * With --send-test it also sends one test notification to every registered staff and rider
 * phone and prints Google's answer for each.
 *
 * Run in the API container (Coolify > blynk-api > Terminal):
 *   node dist/database/push-check.js
 *   node dist/database/push-check.js --send-test
 */
import { env } from '../config/env.js';
import { pool } from './connection.js';
import { pushServiceAccount } from '../modules/notifications/push/push.config.js';
import { getPushSender } from '../modules/notifications/push/push.sender.js';

const STAFF_AND_RIDERS = ['ADMIN', 'OPERATIONS', 'PACKING_STAFF', 'RIDER'];
const short = (t: string) => (t.length > 16 ? `${t.slice(0, 8)}…${t.slice(-6)}` : t);
const when = (d: Date | string | null) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '-');

async function main() {
  const sendTest = process.argv.includes('--send-test');
  const client = await pool.connect();
  try {
    console.log('\n1. Firebase key on the server (FIREBASE_SERVICE_ACCOUNT_JSON)');
    let projectId: string | null = null;
    try {
      projectId = pushServiceAccount()?.project_id ?? null;
      console.log(projectId ? `   OK - project ${projectId}` : '   NOT SET - no push can be sent. Add it in Coolify > blynk-api > Environment Variables and redeploy.');
    } catch (err) {
      console.log(`   UNREADABLE - ${err instanceof Error ? err.message : String(err)}`);
    }

    console.log('\n2. Outbox worker (sends queued SMS and pushes)');
    console.log(`   ${env.NOTIFICATION_WORKER_ENABLED ? 'ON in the API process' : 'OFF in the API process (NOTIFICATION_WORKER_ENABLED=false) - a separate worker must run'}`);

    console.log('\n3. Registered phones');
    const byRole = await client.query(
      `SELECT u.role::text AS role, d.platform::text AS platform, count(*)::int AS n, max(d.last_seen_at) AS last
         FROM device_tokens d JOIN users u ON u.id = d.user_id GROUP BY 1, 2 ORDER BY 1, 2`
    );
    if (!byRole.rows.length) console.log('   none - no phone has registered for notifications');
    for (const r of byRole.rows) console.log(`   ${r.role.padEnd(13)} ${r.platform.padEnd(8)} ${String(r.n).padStart(4)} phone(s), last seen ${when(r.last)}`);

    const staff = await client.query(
      `SELECT u.role::text AS role, coalesce(u.email, u.phone, u.full_name) AS who, d.platform::text AS platform, d.token, d.last_seen_at
         FROM device_tokens d JOIN users u ON u.id = d.user_id
        WHERE u.role::text = ANY($1) ORDER BY u.role, who`,
      [STAFF_AND_RIDERS]
    );
    console.log('\n   Staff and rider phones:');
    if (!staff.rows.length) console.log('   none - open Blynk Ops (2.0 or newer) on the phone, sign in and allow notifications');
    for (const s of staff.rows) console.log(`   ${s.role.padEnd(13)} ${String(s.who).padEnd(32)} ${s.platform.padEnd(8)} ${short(s.token)}  seen ${when(s.last_seen_at)}`);

    const who = await client.query(
      `SELECT u.role::text AS role, count(*)::int AS n FROM users u WHERE u.role::text = ANY($1) AND u.is_active GROUP BY 1 ORDER BY 1`,
      [STAFF_AND_RIDERS]
    );
    console.log('\n   Active accounts: ' + (who.rows.map((r) => `${r.role} ${r.n}`).join(', ') || 'none'));

    console.log('\n4. Latest pushes (newest first)');
    const last = await client.query(
      `SELECT n.notification_type AS type, n.status::text AS status, n.provider_message_id AS result, n.error_message AS error,
              n.created_at, u.role::text AS role
         FROM notifications n LEFT JOIN users u ON u.id = n.user_id
        WHERE n.channel::text = 'PUSH' ORDER BY n.created_at DESC LIMIT 15`
    );
    if (!last.rows.length) console.log('   none queued yet');
    for (const n of last.rows) {
      console.log(`   ${when(n.created_at)}  ${String(n.type).padEnd(26)} to ${String(n.role ?? '?').padEnd(13)} ${String(n.status).padEnd(10)} ${n.result ?? ''}${n.error ? `  ERROR: ${n.error}` : ''}`);
    }

    if (sendTest) {
      console.log('\n5. Test notification to every staff and rider phone');
      const sender = getPushSender();
      if (!sender) console.log('   skipped - no Firebase key (step 1)');
      else if (!staff.rows.length) console.log('   skipped - no staff or rider phone registered (step 3)');
      else {
        const outcomes = await sender.send(
          staff.rows.map((s) => s.token as string),
          { title: 'Blynk test notification', body: 'If you can read this, notifications reach this phone.', data: { type: 'staff_order' } }
        );
        outcomes.forEach((o, i) => {
          const s = staff.rows[i];
          console.log(`   ${String(s.who).padEnd(32)} ${o.ok ? 'SENT' : `FAILED (${o.error}${o.detail ? `: ${o.detail}` : ''})`}`);
        });
      }
    }
    console.log('');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`\nPush check stopped: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
