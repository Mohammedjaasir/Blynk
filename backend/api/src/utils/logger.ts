import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.otp',
      'req.body.code',
      'req.body.password',
      'user.phone',
      'user.email',
      'phone',
      'email',
      'password',
      'token',
      'accessToken',
      'refreshToken',
      'otp_hash',
      'token_hash',
      // PayHere (migration 047): the merchant secret never reaches a log.
      'req.body.merchant_secret',
      'merchant_secret',
      'merchant_secret_encrypted',
      'md5sig',
      'req.body.md5sig',
    ],
    censor: '[REDACTED]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport:
    env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
});
