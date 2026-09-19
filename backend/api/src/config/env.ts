import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env file
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  API_PREFIX: z.string().default('/api/v1'),
  APP_NAME: z.string().default('blynk-backend-api'),

  // Database URL
  DATABASE_URL: z.string().url({ message: 'DATABASE_URL must be a valid PostgreSQL connection URL' }),

  // Auth & Security
  JWT_ACCESS_SECRET: z.string().min(32, { message: 'JWT_ACCESS_SECRET must be at least 32 characters' }),
  JWT_REFRESH_SECRET: z.string().min(32, { message: 'JWT_REFRESH_SECRET must be at least 32 characters' }),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('30d'),
  OTP_SECRET: z.string().min(16, { message: 'OTP_SECRET must be at least 16 characters' }),
  OTP_EXPIRY_MINUTES: z.coerce.number().int().positive().default(5),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),

  // CORS
  CORS_ORIGINS: z.string().default('*'),

  // Media storage (admin-uploaded product / promotion images).
  // MEDIA_ROOT is a directory on the API host; PUBLIC_BASE_URL is the
  // origin clients use to fetch what's stored there.
  MEDIA_ROOT: z.string().default('uploads'),
  PUBLIC_BASE_URL: z.string().default('http://localhost:4000'),

  // Logging
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Notification Providers (Phase 1 SMS via NotifyLK & WhatsApp Cloud API)
  SMS_PROVIDER: z.string().optional().default('notifylk'),
  SMS_API_KEY: z.string().optional(),
  SMS_USER_ID: z.string().optional(),
  SMS_SENDER_ID: z.string().optional().default('Blynk'),
  WHATSAPP_API_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),

  // Notification Outbox Worker Daemon
  NOTIFICATION_WORKER_ENABLED: z
    .preprocess((val) => (val === 'false' ? false : val === 'true' ? true : val), z.boolean())
    .default(true),
  NOTIFICATION_WORKER_INTERVAL_MS: z.coerce.number().int().positive().default(3000),
  NOTIFICATION_WORKER_BATCH_SIZE: z.coerce.number().int().positive().default(20),
  NOTIFICATION_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  NOTIFICATION_PROCESSING_TIMEOUT_MS: z.coerce.number().int().positive().default(300000), // 5 minutes lease
}).superRefine((data, ctx) => {
  if (data.NODE_ENV === 'production') {
    // 1. Insecure Secrets
    if (data.JWT_ACCESS_SECRET.startsWith('dev_') || data.JWT_ACCESS_SECRET.includes('change_me')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_ACCESS_SECRET'],
        message: 'Production requires a secure, high-entropy JWT_ACCESS_SECRET (cannot use dev placeholder)',
      });
    }

    if (data.JWT_REFRESH_SECRET.startsWith('dev_') || data.JWT_REFRESH_SECRET.includes('change_me')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'Production requires a secure, high-entropy JWT_REFRESH_SECRET (cannot use dev placeholder)',
      });
    }

    if (data.OTP_SECRET.startsWith('dev_') || data.OTP_SECRET.includes('random_string')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OTP_SECRET'],
        message: 'Production requires a secure, high-entropy OTP_SECRET (cannot use dev placeholder)',
      });
    }

    // 2. CORS wildcard prohibited in production
    if (data.CORS_ORIGINS === '*' || data.CORS_ORIGINS.includes('*')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'Wildcard CORS (*) is not permitted in production. Explicit comma-separated origins required.',
      });
    }

    // 3. Database URL must not be localhost
    if (data.DATABASE_URL.includes('localhost') || data.DATABASE_URL.includes('127.0.0.1')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'Production DATABASE_URL must not point to localhost or 127.0.0.1',
      });
    }

    // 4. SMS credentials required in production
    if (!data.SMS_API_KEY || data.SMS_API_KEY.startsWith('dev_') || !data.SMS_USER_ID || data.SMS_USER_ID.startsWith('dev_')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMS_API_KEY'],
        message: 'Production requires valid SMS_API_KEY and SMS_USER_ID credentials for live SMS delivery (mock fallback prohibited in production)',
      });
    }
  }
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(customEnv?: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(customEnv ?? process.env);

  if (!result.success) {
    const errorDetails = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    if (!customEnv) {
      console.error(`\n❌ CRITICAL CONFIGURATION ERROR: Invalid environment variables:\n${errorDetails}\n`);
    }
    throw new Error(`Invalid environment configuration:\n${errorDetails}`);
  }

  return result.data;
}

export { envSchema };
export const env = validateEnv();
