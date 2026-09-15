import crypto from 'crypto';
import bcrypt from 'bcryptjs';

/**
 * Generates a cryptographically random 6-digit numeric OTP.
 */
export function generateOtp(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Hashes an OTP with bcrypt (10 rounds) for persistence in otp_verifications.
 */
export async function hashOtp(otp: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(otp, salt);
}

/**
 * Verifies submitted plaintext OTP against stored bcrypt hash in constant-time.
 */
export async function compareOtp(otp: string, hash: string): Promise<boolean> {
  return bcrypt.compare(otp, hash);
}
