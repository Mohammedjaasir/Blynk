import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Encryption at rest for payment gateway secrets (migration 047). AES-256-GCM
 * with a key derived (SHA-256) from PAYMENT_SECRET_KEY, read at call time.
 * Stored form: "v1:<iv b64>:<tag b64>:<ciphertext b64>". Never log the input
 * or the output of decrypt.
 */
const PREFIX = 'v1';

export class PaymentSecretKeyMissingError extends Error {
  constructor() {
    super('PAYMENT_SECRET_KEY is not set');
  }
}

export function paymentSecretKeyConfigured(): boolean {
  const k = process.env.PAYMENT_SECRET_KEY;
  return typeof k === 'string' && k.length >= 32;
}

function key(): Buffer {
  if (!paymentSecretKeyConfigured()) throw new PaymentSecretKeyMissingError();
  return createHash('sha256').update(process.env.PAYMENT_SECRET_KEY as string, 'utf8').digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

/** Null when the stored value cannot be read with the current key (key changed, tampered). */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(parts[1], 'base64'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8');
  } catch (err) {
    if (err instanceof PaymentSecretKeyMissingError) return null;
    return null;
  }
}
