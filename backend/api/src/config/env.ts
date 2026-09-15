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

  // Logging
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Providers (Optional in dev/test)
  SMS_PROVIDER: z.string().optional().default('notifylk'),
  SMS_API_KEY: z.string().optional(),
  WHATSAPP_API_TOKEN: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errorDetails = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    console.error(`\n❌ CRITICAL CONFIGURATION ERROR: Invalid environment variables:\n${errorDetails}\n`);
    throw new Error('Invalid environment configuration. Application cannot start.');
  }

  return result.data;
}

export const env = validateEnv();
