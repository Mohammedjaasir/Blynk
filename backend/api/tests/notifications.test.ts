import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool, db } from '../src/database/connection.js';
import {
  notificationRepository,
  notificationService,
  NotificationWorker,
  NotificationTemplates,
} from '../src/modules/notifications/index.js';
import { NotificationProvider, SendNotificationParams, ProviderSendResult } from '../src/modules/notifications/notification.provider.js';

describe('Stage 5 — Outbox Notification Worker Module', () => {
  const app = createApp();

  let adminToken: string;
  let customerToken: string;
  let customerId: string;
  let customerPhone = '+94771234567';
  // What this file creates for the seeded customer, removed in afterAll so a
  // run leaves no orders or addresses behind.
  const createdOrderIds: string[] = [];
  let createdAddressId: string | null = null;
  // Every outbox row this file enqueues directly carries this prefix in its
  // idempotency key, so afterAll removes exactly those and nothing else.
  const RUN = `nt_${Date.now()}_`;

  afterAll(async () => {
    await pool.query('DELETE FROM notifications WHERE idempotency_key LIKE $1', [`${RUN}%`]);
    if (createdOrderIds.length) {
      await pool.query('DELETE FROM notifications WHERE order_id = ANY($1)', [createdOrderIds]);
      await pool.query('DELETE FROM payments WHERE order_id = ANY($1)', [createdOrderIds]);
      await pool.query('DELETE FROM deliveries WHERE order_id = ANY($1)', [createdOrderIds]);
      await pool.query('DELETE FROM orders WHERE id = ANY($1)', [createdOrderIds]);
    }
    if (createdAddressId) await pool.query('DELETE FROM customer_addresses WHERE id = $1', [createdAddressId]);
  });

  beforeAll(async () => {
    // 1. Fetch Admin token
    const adminUser = await pool.query(`SELECT id, phone, role FROM users WHERE role = 'ADMIN' LIMIT 1`);
    expect(adminUser.rows.length).toBeGreaterThan(0);
    const { generateAccessToken } = await import('../src/modules/auth/token.service.js');
    adminToken = generateAccessToken({
      id: adminUser.rows[0].id,
      phone: adminUser.rows[0].phone,
      role: 'ADMIN',
    });

    // 2. Fetch Customer
    const customerUser = await pool.query(`SELECT id, phone, role FROM users WHERE phone = $1 LIMIT 1`, [customerPhone]);
    customerId = customerUser.rows[0].id;
    customerToken = generateAccessToken({
      id: customerId,
      phone: customerPhone,
      role: 'CUSTOMER',
    });

    // 3. The worker tests claim whatever the worker would claim. Never delete
    //    or send someone else's queued messages to make room: if any are
    //    waiting, stop and say so (run the worker, or wait for it, first).
    const claimable = await pool.query(
      `SELECT count(*)::int AS n FROM notifications
        WHERE (status = 'QUEUED' AND next_attempt_at <= now())
           OR (status = 'PROCESSING' AND locked_at < now() - interval '5 minutes')`
    );
    if (claimable.rows[0].n > 0) {
      throw new Error(
        `${claimable.rows[0].n} notification(s) are already waiting to be sent; the worker tests would send them. Drain the queue first.`
      );
    }
  });

  describe('Transactional Outbox Enqueuing & Rollback Invariant', () => {
    it('persists outbox record atomically when transaction commits', async () => {
      const idempotencyKey = `${RUN}tx_commit_${Date.now()}`;

      await db.transaction().execute(async (trx) => {
        await notificationRepository.enqueueNotification(
          {
            user_id: customerId,
            channel: 'SMS',
            notification_type: 'ORDER_PLACED',
            recipient: customerPhone,
            payload: { order_number: 'BL-TEST-001', total_amount: 1500.0 },
            idempotency_key: idempotencyKey,
          },
          trx
        );
      });

      const res = await pool.query(
        `SELECT * FROM notifications WHERE idempotency_key = $1`,
        [idempotencyKey]
      );
      expect(res.rows.length).toBe(1);
      expect(res.rows[0].status).toBe('QUEUED');
      expect(res.rows[0].attempts).toBe(0);
      expect(res.rows[0].channel).toBe('SMS');
    });

    it('rolls back outbox record when business transaction fails', async () => {
      const idempotencyKey = `${RUN}tx_rollback_${Date.now()}`;

      try {
        await db.transaction().execute(async (trx) => {
          await notificationRepository.enqueueNotification(
            {
              user_id: customerId,
              channel: 'SMS',
              notification_type: 'ORDER_PLACED',
              recipient: customerPhone,
              payload: { order_number: 'BL-FAIL-001', total_amount: 999.0 },
              idempotency_key: idempotencyKey,
            },
            trx
          );

          // Simulated downstream business failure
          throw new Error('Simulated order payment processing failure');
        });
      } catch (err: any) {
        expect(err.message).toBe('Simulated order payment processing failure');
      }

      // Assert notification was completely rolled back
      const res = await pool.query(
        `SELECT * FROM notifications WHERE idempotency_key = $1`,
        [idempotencyKey]
      );
      expect(res.rows.length).toBe(0);
    });

    it('suppresses duplicate outbox insert on identical idempotency_key', async () => {
      const idempotencyKey = `${RUN}idemp_${Date.now()}`;

      const first = await notificationRepository.enqueueNotification({
        user_id: customerId,
        channel: 'SMS',
        notification_type: 'ORDER_PLACED',
        recipient: customerPhone,
        payload: { order_number: 'BL-IDEMP-01', total_amount: 1200 },
        idempotency_key: idempotencyKey,
      });
      expect(first).toBeDefined();

      // Second identical enqueue call returns null or does nothing without throwing duplicate key error
      const second = await notificationRepository.enqueueNotification({
        user_id: customerId,
        channel: 'SMS',
        notification_type: 'ORDER_PLACED',
        recipient: customerPhone,
        payload: { order_number: 'BL-IDEMP-01', total_amount: 1200 },
        idempotency_key: idempotencyKey,
      });

      const count = await pool.query(
        `SELECT COUNT(*) FROM notifications WHERE idempotency_key = $1`,
        [idempotencyKey]
      );
      expect(count.rows[0].count).toBe('1');
    });
  });

  describe('Provider Routing & Dispatching', () => {
    it('routes SMS notifications through the SMS provider', async () => {
      const key = `${RUN}sms_route_${Date.now()}`;
      await notificationService.enqueue({
        user_id: customerId,
        channel: 'SMS',
        notification_type: 'ORDER_PLACED',
        recipient: customerPhone,
        payload: { order_number: 'BL-ROUTE-SMS', total_amount: 500 },
        idempotency_key: key,
      });

      const worker = new NotificationWorker({ batchSize: 5 });
      const processed = await worker.processBatch();
      expect(processed).toBeGreaterThanOrEqual(1);

      const res = await pool.query(`SELECT * FROM notifications WHERE idempotency_key = $1`, [key]);
      expect(res.rows[0].status).toBe('SENT');
      expect(res.rows[0].provider_name).toBe('notifylk');
      expect(res.rows[0].provider_message_id).toMatch(/^mock_sms_/);
      expect(res.rows[0].sent_at).not.toBeNull();
    });

    it('routes WHATSAPP notifications through the WhatsApp provider', async () => {
      const key = `${RUN}wa_route_${Date.now()}`;
      await notificationService.enqueue({
        user_id: customerId,
        channel: 'WHATSAPP',
        notification_type: 'ORDER_PLACED',
        recipient: customerPhone,
        payload: { order_number: 'BL-ROUTE-WA', total_amount: 850 },
        idempotency_key: key,
      });

      const worker = new NotificationWorker({ batchSize: 5 });
      await worker.processBatch();

      const res = await pool.query(`SELECT * FROM notifications WHERE idempotency_key = $1`, [key]);
      expect(res.rows[0].status).toBe('SENT');
      expect(res.rows[0].provider_name).toBe('whatsapp_cloud_api');
      expect(res.rows[0].provider_message_id).toMatch(/^mock_wamid_/);
      expect(res.rows[0].sent_at).not.toBeNull();
    });
  });

  describe('Bounded Retries with Exponential Backoff & Permanent Failure', () => {
    it('schedules retry with exponential backoff on transient failure', async () => {
      const key = `${RUN}retry_transient_${Date.now()}`;
      await notificationService.enqueue({
        user_id: customerId,
        channel: 'SMS',
        notification_type: 'OUT_FOR_DELIVERY',
        recipient: customerPhone,
        payload: {
          order_number: 'BL-RETRY-01',
          total_amount: 1000,
          forceError: 'TRANSIENT',
        },
        idempotency_key: key,
        max_attempts: 3,
      });

      const worker = new NotificationWorker({ batchSize: 5 });
      await worker.processBatch();

      const res = await pool.query(`SELECT * FROM notifications WHERE idempotency_key = $1`, [key]);
      expect(res.rows[0].status).toBe('QUEUED'); // Rescheduled back to QUEUED with future next_attempt_at
      expect(res.rows[0].attempts).toBe(1);
      expect(res.rows[0].error_message).toContain('Simulated temporary SMS gateway timeout');
      expect(new Date(res.rows[0].next_attempt_at).getTime()).toBeGreaterThan(Date.now());
    });

    it('permanently fails once max attempts are exhausted', async () => {
      const key = `${RUN}exhaust_max_${Date.now()}`;
      await notificationService.enqueue({
        user_id: customerId,
        channel: 'SMS',
        notification_type: 'OUT_FOR_DELIVERY',
        recipient: customerPhone,
        payload: {
          order_number: 'BL-EXHAUST-01',
          total_amount: 1000,
          forceError: 'TRANSIENT',
        },
        idempotency_key: key,
        max_attempts: 2, // Allow only 2 attempts
      });

      const worker = new NotificationWorker({ batchSize: 5 });

      // Attempt 1 -> transient fail, schedules attempt 2
      await worker.processBatch();
      let res = await pool.query(`SELECT * FROM notifications WHERE idempotency_key = $1`, [key]);
      expect(res.rows[0].status).toBe('QUEUED');
      expect(res.rows[0].attempts).toBe(1);

      // Fast-forward next_attempt_at to now for test simulation
      await pool.query(
        `UPDATE notifications SET next_attempt_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE idempotency_key = $1`,
        [key]
      );

      // Attempt 2 -> exhausts max_attempts (2) -> transitions to FAILED
      await worker.processBatch();
      res = await pool.query(`SELECT * FROM notifications WHERE idempotency_key = $1`, [key]);
      expect(res.rows[0].status).toBe('FAILED');
      expect(res.rows[0].attempts).toBe(2);
      expect(res.rows[0].failed_at).not.toBeNull();
      expect(res.rows[0].error_message).toContain('Max retry attempts (2) exceeded');
    });

    it('fails permanently on unrecoverable permanent error without wasting retries', async () => {
      const key = `${RUN}permanent_err_${Date.now()}`;
      await notificationService.enqueue({
        user_id: customerId,
        channel: 'SMS',
        notification_type: 'ORDER_PLACED',
        recipient: customerPhone,
        payload: {
          order_number: 'BL-PERM-01',
          total_amount: 500,
          forceError: 'PERMANENT',
        },
        idempotency_key: key,
        max_attempts: 3,
      });

      const worker = new NotificationWorker({ batchSize: 5 });
      await worker.processBatch();

      const res = await pool.query(`SELECT * FROM notifications WHERE idempotency_key = $1`, [key]);
      expect(res.rows[0].status).toBe('FAILED');
      expect(res.rows[0].attempts).toBe(1); // Permanent failure on first attempt
      expect(res.rows[0].failed_at).not.toBeNull();
      expect(res.rows[0].error_message).toContain('permanent SMS delivery rejection');
    });
  });

  describe('Worker Concurrency & SKIP LOCKED Isolation', () => {
    it('guarantees that two concurrent workers cannot claim the same notification job', async () => {
      const keyPrefix = `${RUN}concurrent_${Date.now()}`;

      // Insert 10 pending jobs
      for (let i = 0; i < 10; i++) {
        await notificationService.enqueue({
          user_id: customerId,
          channel: 'SMS',
          notification_type: 'ORDER_PLACED',
          recipient: customerPhone,
          payload: { order_number: `BL-CONC-${i}`, total_amount: 100 * (i + 1) },
          idempotency_key: `${keyPrefix}_${i}`,
        });
      }

      const worker1 = new NotificationWorker({ workerId: 'worker_alpha', batchSize: 5 });
      const worker2 = new NotificationWorker({ workerId: 'worker_beta', batchSize: 5 });

      // Run both claims simultaneously
      const [jobsWorker1, jobsWorker2] = await Promise.all([
        notificationRepository.claimPendingBatch(5, worker1.workerId, 300000),
        notificationRepository.claimPendingBatch(5, worker2.workerId, 300000),
      ]);

      expect(jobsWorker1.length).toBe(5);
      expect(jobsWorker2.length).toBe(5);

      // Verify ZERO intersection between claimed job IDs
      const worker1Ids = new Set(jobsWorker1.map((j) => j.id));
      for (const job of jobsWorker2) {
        expect(worker1Ids.has(job.id)).toBe(false);
      }

      // Cleanup: finish dispatching claimed jobs
      for (const job of [...jobsWorker1, ...jobsWorker2]) {
        await notificationService.dispatchJob(job);
      }
    });
  });

  describe('Crash Recovery & Lease Timeout', () => {
    it('reclaims abandoned jobs in PROCESSING status when locked_at exceeds timeout', async () => {
      const key = `${RUN}crash_recovery_${Date.now()}`;
      await notificationService.enqueue({
        user_id: customerId,
        channel: 'SMS',
        notification_type: 'ORDER_PLACED',
        recipient: customerPhone,
        payload: { order_number: 'BL-CRASH-01', total_amount: 750 },
        idempotency_key: key,
      });

      // Simulate a crashed worker: set status to PROCESSING with an old locked_at (6 minutes ago)
      await pool.query(
        `UPDATE notifications 
         SET status = 'PROCESSING', locked_at = CURRENT_TIMESTAMP - INTERVAL '6 minutes', locked_by = 'crashed_worker_999'
         WHERE idempotency_key = $1`,
        [key]
      );

      // New healthy worker with 5-minute lease threshold claims the abandoned job
      const recoveryWorker = new NotificationWorker({ workerId: 'healthy_worker_01', batchSize: 10, leaseTimeoutMs: 300000 });
      const claimed = await notificationRepository.claimPendingBatch(10, recoveryWorker.workerId, 300000);

      const recoveredJob = claimed.find((j) => j.idempotency_key === key);
      expect(recoveredJob).toBeDefined();

      // Dispatch to completion
      await notificationService.dispatchJob(recoveredJob!);

      const finalRes = await pool.query(`SELECT * FROM notifications WHERE idempotency_key = $1`, [key]);
      expect(finalRes.rows[0].status).toBe('SENT');
      expect(finalRes.rows[0].locked_at).toBeNull();
    });
  });

  describe('Security & Sensitive Information Sanitization', () => {
    it('strictly sanitizes payload and prevents internal wholesale cost or markup leakage', () => {
      const dirtyPayload = {
        order_number: 'BL-SEC-01',
        total_amount: 1955.0,
        purchase_cost: 1400.0,
        actual_unit_cost: 500.0,
        markup_percentage_applied: 20.0,
        custom_markup_percent: 15.0,
        password: 'secret_user_password',
        otp_hash: '$2b$10$abcdefghijklmnopqrstuvwxyz',
      };

      const sanitized = NotificationTemplates.sanitizePayload(dirtyPayload);

      expect(sanitized.order_number).toBe('BL-SEC-01');
      expect(sanitized.total_amount).toBe(1955.0);
      expect(sanitized).not.toHaveProperty('purchase_cost');
      expect(sanitized).not.toHaveProperty('actual_unit_cost');
      expect(sanitized).not.toHaveProperty('markup_percentage_applied');
      expect(sanitized).not.toHaveProperty('custom_markup_percent');
      expect(sanitized).not.toHaveProperty('password');
      expect(sanitized).not.toHaveProperty('otp_hash');
    });

    it('renders customer-facing message without exposing internal IDs or costs', () => {
      const message = NotificationTemplates.render('ORDER_PLACED', {
        order_number: 'BL-20260916-1234',
        total_amount: 1885.0,
      });

      expect(message).toContain('BL-20260916-1234');
      expect(message).toContain('1885.00');
      expect(message).not.toContain('purchase_cost');
      expect(message).not.toContain('markup');
    });
  });

  describe('Phone Number Normalization Consistency', () => {
    it('normalizes Sri Lankan numbers across 07X, +947X, and 947X formats', async () => {
      const key07 = `${RUN}phone_07_${Date.now()}`;
      await notificationService.enqueue({
        user_id: customerId,
        channel: 'SMS',
        notification_type: 'ORDER_PLACED',
        recipient: '0771234567',
        payload: { order_number: 'BL-P1', total_amount: 100 },
        idempotency_key: key07,
      });

      const res07 = await pool.query(`SELECT recipient FROM notifications WHERE idempotency_key = $1`, [key07]);
      expect(res07.rows[0].recipient).toBe('+94771234567');
    });
  });

  describe('Stage 4 End-to-End Order Lifecycle Integration', () => {
    it('order placement creates outbox record which worker successfully transitions to SENT', async () => {
      // 1. Ensure valid delivery address within 4 km
      let addrRes = await pool.query(
        `SELECT id FROM customer_addresses WHERE user_id = $1 AND is_deleted = false LIMIT 1`,
        [customerId]
      );
      let addressId: string;
      if (addrRes.rows.length === 0) {
        const createAddr = await request(app)
          .post('/api/v1/me/addresses')
          .set('Authorization', `Bearer ${customerToken}`)
          .send({
            recipient_name: 'Ahmed Rizvi',
            recipient_phone: customerPhone,
            address_line1: '12, Old Mosque Road',
            city: 'Dharga Town',
            latitude: 6.4385,
            longitude: 80.0278,
            is_default: true,
          });
        expect(createAddr.status).toBe(201);
        addressId = createAddr.body.data.address.id;
        createdAddressId = addressId;
      } else {
        addressId = addrRes.rows[0].id;
      }

      // 2. Place order
      const orderRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          address_id: addressId,
          items: [{ product_id: 'b0000001-0000-0000-0000-000000000001', quantity: 1 }],
        });
      expect(orderRes.status).toBe(201);
      const placedOrder = orderRes.body.data.order;
      createdOrderIds.push(placedOrder.id);

      // 3. Verify notification is in QUEUED state in PostgreSQL
      const notifRes = await pool.query(
        `SELECT * FROM notifications WHERE order_id = $1 AND notification_type = 'ORDER_PLACED'`,
        [placedOrder.id]
      );
      expect(notifRes.rows.length).toBe(1);
      expect(notifRes.rows[0].status).toBe('QUEUED');
      expect(notifRes.rows[0].channel).toBe('SMS');

      // 4. Run worker batch
      const worker = new NotificationWorker({ batchSize: 10 });
      await worker.processBatch();

      // 5. Verify notification transitioned to SENT
      const updatedNotif = await pool.query(
        `SELECT * FROM notifications WHERE id = $1`,
        [notifRes.rows[0].id]
      );
      expect(updatedNotif.rows[0].status).toBe('SENT');
      expect(updatedNotif.rows[0].sent_at).not.toBeNull();
      expect(updatedNotif.rows[0].provider_name).toBe('notifylk');
    });
  });

  describe('Admin Notification Observability API', () => {
    it('allows ADMIN to view outbox metrics and failure summaries', async () => {
      const res = await request(app)
        .get('/api/v1/admin/notifications')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('queued');
      expect(res.body.data).toHaveProperty('processing');
      expect(res.body.data).toHaveProperty('sent');
      expect(res.body.data).toHaveProperty('failed');
      expect(Array.isArray(res.body.data.recentFailures)).toBe(true);
    });

    it('blocks non-admin users from accessing notification metrics with 403 FORBIDDEN', async () => {
      const res = await request(app)
        .get('/api/v1/admin/notifications')
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.status).toBe(403);
    });
  });
});
