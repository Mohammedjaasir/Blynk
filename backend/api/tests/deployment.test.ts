import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { fileURLToPath } from 'url';
import { createApp } from '../src/app.js';
import { validateEnv, envSchema } from '../src/config/env.js';
import { NotificationWorker } from '../src/modules/notifications/notification.worker.js';
import { SmsProvider } from '../src/modules/notifications/providers/sms.provider.js';
import { WhatsAppProvider } from '../src/modules/notifications/providers/whatsapp.provider.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Stage 7: Deployment, Docker & Environment Packaging', () => {
  const app = createApp();

  describe('1. Production Environment Schema & Invariant Validation', () => {
    const validProdBase = {
      NODE_ENV: 'production',
      PORT: '3000',
      DATABASE_URL: 'postgresql://prod_user:SuperSecureSecretPassword123!@db.internal.blynk.lk:5432/blynk_prod',
      JWT_ACCESS_SECRET: 'production_high_entropy_jwt_access_secret_64_bytes_secure_string_here_ok!',
      JWT_REFRESH_SECRET: 'production_high_entropy_jwt_refresh_secret_64_bytes_secure_string_here_ok!',
      OTP_SECRET: 'production_high_entropy_otp_hmac_secret_32_bytes_ok!',
      CORS_ORIGINS: 'https://admin.blynk.lk,https://app.blynk.lk',
      SMS_PROVIDER: 'notifylk',
      SMS_API_KEY: 'live_notifylk_api_key_secure_value',
      SMS_USER_ID: 'live_notifylk_user_id_12345',
      SMS_SENDER_ID: 'Blynk',
      WHATSAPP_API_TOKEN: 'live_meta_whatsapp_cloud_token_secure_value',
      WHATSAPP_PHONE_NUMBER_ID: '109876543210987',
      NOTIFICATION_WORKER_ENABLED: 'true',
    };

    it('passes validation when production configuration is fully secure', () => {
      const result = envSchema.safeParse(validProdBase);
      expect(result.success).toBe(true);
    });

    it('rejects production startup if JWT_ACCESS_SECRET uses dev placeholder', () => {
      const badConfig = {
        ...validProdBase,
        JWT_ACCESS_SECRET: 'dev_jwt_access_secret_change_me_in_production_min_32_chars!',
      };
      const result = envSchema.safeParse(badConfig);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes('JWT_ACCESS_SECRET'))).toBe(true);
      }
    });

    it('rejects production startup if JWT_REFRESH_SECRET uses dev placeholder', () => {
      const badConfig = {
        ...validProdBase,
        JWT_REFRESH_SECRET: 'dev_jwt_refresh_secret_change_me_in_production_min_32_chars!',
      };
      const result = envSchema.safeParse(badConfig);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes('JWT_REFRESH_SECRET'))).toBe(true);
      }
    });

    it('rejects production startup if OTP_SECRET uses dev placeholder', () => {
      const badConfig = {
        ...validProdBase,
        OTP_SECRET: 'dev_otp_hmac_secret_min_32_chars_random_string!',
      };
      const result = envSchema.safeParse(badConfig);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes('OTP_SECRET'))).toBe(true);
      }
    });

    it('rejects production startup if CORS_ORIGINS is wildcard (*)', () => {
      const badConfig = {
        ...validProdBase,
        CORS_ORIGINS: '*',
      };
      const result = envSchema.safeParse(badConfig);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes('CORS_ORIGINS'))).toBe(true);
      }
    });

    it('rejects production startup if DATABASE_URL points to localhost', () => {
      const badConfig = {
        ...validProdBase,
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/blynk_db',
      };
      const result = envSchema.safeParse(badConfig);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes('DATABASE_URL'))).toBe(true);
      }
    });

    it('rejects production startup if SMS_API_KEY is missing or placeholder', () => {
      const badConfig = {
        ...validProdBase,
        SMS_API_KEY: 'dev_notifylk_api_key_placeholder',
      };
      const result = envSchema.safeParse(badConfig);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes('SMS_API_KEY'))).toBe(true);
      }
    });

    it('throws descriptive error when validateEnv() is called with invalid production env', () => {
      expect(() =>
        validateEnv({
          ...validProdBase,
          JWT_ACCESS_SECRET: 'dev_insecure_key',
        })
      ).toThrowError(/Invalid environment configuration/);
    });
  });

  describe('2. Migration Artifact Bundling & Rollback Integrity', () => {
    const srcMigrations = path.join(__dirname, '../src/database/migrations');
    const distMigrations = path.join(__dirname, '../dist/database/migrations');

    it('contains all required migration scripts (001, 002, 003) and rollbacks in src/', () => {
      const files = fs.readdirSync(srcMigrations);
      expect(files).toContain('001_initial_schema.sql');
      expect(files).toContain('001_initial_schema_down.sql');
      expect(files).toContain('002_outbox_worker_extensions.sql');
      expect(files).toContain('002_outbox_worker_extensions_down.sql');
      expect(files).toContain('003_sourcing_and_inventory.sql');
      expect(files).toContain('003_sourcing_and_inventory_down.sql');
    });

    it('bundles all SQL migrations into dist/ during npm run build for compiled runtime', () => {
      expect(fs.existsSync(distMigrations)).toBe(true);
      const distFiles = fs.readdirSync(distMigrations);
      expect(distFiles).toContain('001_initial_schema.sql');
      expect(distFiles).toContain('002_outbox_worker_extensions.sql');
      expect(distFiles).toContain('003_sourcing_and_inventory.sql');
    });

    it('bundles compiled dev_seed.js into dist/ for non-tsx container seeding', () => {
      const distSeed = path.join(__dirname, '../dist/database/seeds/dev_seed.js');
      expect(fs.existsSync(distSeed)).toBe(true);
      const content = fs.readFileSync(distSeed, 'utf-8');
      expect(content).toContain('runDevSeed');
    });
  });

  describe('3. Production Gateway Mock Prevention', () => {
    it('SmsProvider rejects mock delivery when executed under production environment', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        const sms = new SmsProvider();
        const result = await sms.send({
          notificationId: 'notif-1',
          recipient: '+94771234567',
          message: 'Your order has been placed!',
        });

        // Must permanently fail rather than silently simulating delivery
        expect(result.success).toBe(false);
        expect(result.errorType).toBe('PERMANENT');
        expect(result.errorMessage).toContain('Mock SMS is strictly prohibited in production');
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });

    it('WhatsAppProvider rejects mock delivery when executed under production environment', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        const wa = new WhatsAppProvider();
        const result = await wa.send({
          notificationId: 'notif-2',
          recipient: '+94771234567',
          message: 'Your order has been placed!',
        });

        expect(result.success).toBe(false);
        expect(result.errorType).toBe('PERMANENT');
        expect(result.errorMessage).toContain('Mock WhatsApp is strictly prohibited in production');
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });
  });

  describe('4. Standalone Worker Lifecycle & Graceful Stop', () => {
    it('instantiates NotificationWorker with custom worker options', () => {
      const worker = new NotificationWorker({
        workerId: 'test_worker_unit',
        intervalMs: 10000,
        batchSize: 5,
        leaseTimeoutMs: 60000,
      });

      expect(worker.workerId).toBe('test_worker_unit');
      expect(worker.intervalMs).toBe(10000);
      expect(worker.batchSize).toBe(5);
      expect(worker.leaseTimeoutMs).toBe(60000);
    });

    it('executes processBatch without unhandled errors', async () => {
      const worker = new NotificationWorker({
        workerId: 'test_worker_batch',
        batchSize: 5,
      });

      const processed = await worker.processBatch();
      expect(typeof processed).toBe('number');
      expect(processed).toBeGreaterThanOrEqual(0);
    });

    it('gracefully stops worker without hanging or crashing', async () => {
      const worker = new NotificationWorker({
        workerId: 'test_worker_stop',
        intervalMs: 50000,
      });

      worker.start();
      await expect(worker.stop()).resolves.toBeUndefined();
    });
  });

  describe('5. Health Check Endpoint Contract Verification', () => {
    it('GET /health returns 200 with structured database connectivity and latency', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.status).toBe('ok');
      expect(res.body.data.version).toBe('1.0.0');
      expect(res.body.data.environment).toBeDefined();
      expect(res.body.data.database.status).toBe('connected');
      expect(typeof res.body.data.database.latencyMs).toBe('number');
      expect(res.body.data.database.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });
});
