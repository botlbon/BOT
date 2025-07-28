// keyFormat.ts
// Utility for Solana private key format detection and conversion

import bs58 from 'bs58';

/**
 * Detects the format of a Solana private key string and converts it to a Buffer (Uint8Array)
 * Supported formats:
 *   - Base58 (most common, letters & numbers, 44-88 chars)
 *   - Base64 (88 chars)
 *   - JSON Array (64 numbers)
 * Returns null if invalid or unsupported
 */
export function parseSolanaPrivateKey(input: string): Buffer | null {
  input = input.trim();
  // Try Base64
  try {
    const buf = Buffer.from(input, 'base64');
    if (buf.length === 64) return buf;
  } catch {}
  // Try Base58
  if (/^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(input)) {
    try {
      const decoded = bs58.decode(input);
      if (decoded.length === 64) return Buffer.from(decoded);
    } catch {}
  }
  // Try JSON Array
  if (input.startsWith('[') && input.endsWith(']')) {
    try {
      const arr = JSON.parse(input);
      if (Array.isArray(arr) && arr.length === 64) {
        return Buffer.from(arr);
      }
    } catch {}
  }
  // Try plain text (utf-8, fallback)
  if (/^[A-Za-z0-9]{64,}$/.test(input) && input.length >= 64 && input.length <= 100) {
    try {
      let buf = Buffer.from(input, 'utf-8');
      if (buf.length < 64) {
        let padded = Buffer.alloc(64);
        buf.copy(padded);
        buf = padded;
      } else if (buf.length > 64) {
        buf = buf.slice(0, 64);
      }
      if (buf.length === 64) return buf;
    } catch {}
  }
  return null;
}

/**
 * Converts a Solana private key Buffer to base64 string (accepted format for the bot)
 */
export function toBase64Key(buf: Buffer): string {
  return buf.toString('base64');
}

/**
 * Converts a Solana private key Buffer to base58 string
 */
export function toBase58Key(buf: Buffer): string {
  return bs58.encode(buf);
}

/**
 * Converts a Solana private key Buffer to JSON array string
 */
export function toJsonArrayKey(buf: Buffer): string {
  return JSON.stringify(Array.from(buf));
}
