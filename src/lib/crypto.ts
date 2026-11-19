import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const secret = process.env.TOKEN_ENCRYPTION_KEY;
  if (!secret || secret === 'replace-with-openssl-rand-base64-32') {
    throw new Error(
      'CRITICAL SECURITY ERROR: TOKEN_ENCRYPTION_KEY must be set in environment variables.'
    );
  }
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Generates a cryptographically random 32-byte hex state token for OAuth CSRF protection.
 */
export function generateOAuthState(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Constant-time comparison to prevent timing attacks on secrets/tokens.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Validates that an external offer URL uses only http: or https: protocol (prevents javascript: XSS).
 */
export function sanitizeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Encrypts sensitive OAuth tokens (access_token / refresh_token) before storing in PostgreSQL.
 */
export function encryptToken(plainText: string | null | undefined): string | null {
  if (!plainText) return null;
  if (plainText.startsWith('enc:v1:')) return plainText;

  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `enc:v1:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts stored OAuth tokens in memory when communicating with Gmail API.
 */
export function decryptToken(cipherText: string | null | undefined): string | null {
  if (!cipherText) return null;
  if (!cipherText.startsWith('enc:v1:')) return cipherText;

  const parts = cipherText.split(':');
  if (parts.length !== 5) return null;

  const iv = Buffer.from(parts[2], 'hex');
  const authTag = Buffer.from(parts[3], 'hex');
  const encrypted = Buffer.from(parts[4], 'hex');
  const key = getEncryptionKey();

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}
