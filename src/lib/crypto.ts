import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const secret =
    process.env.TOKEN_ENCRYPTION_KEY ||
    process.env.CRON_SECRET ||
    'default-dev-only-32-byte-secret-key!!';
  return crypto.createHash('sha256').update(secret).digest();
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
