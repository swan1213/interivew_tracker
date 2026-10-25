import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** AES-256-GCM with a key derived from the secret. Output: base64(iv | tag | ciphertext). */
export function encrypt(plain: string, secret: string): string {
  const key = createHash('sha256').update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decrypt(packed: string, secret: string): string {
  const key = createHash('sha256').update(secret).digest();
  const buf = Buffer.from(packed, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export const b64url = (s: string | Buffer): string =>
  Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const fromB64url = (s: string): Buffer => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export const sha256b64url = (s: string): string => b64url(createHash('sha256').update(s).digest());
