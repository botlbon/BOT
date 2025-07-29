import { Keypair, Connection, clusterApiUrl } from '@solana/web3.js';

// Load a keypair from an array, Uint8Array, or base64/JSON string
export function loadKeypair(secret: number[] | Uint8Array | string) {
  let key: Uint8Array;
  if (typeof secret === 'string') {
    // Accept base64 or JSON array string
    if (secret.startsWith('[')) {
      key = Uint8Array.from(JSON.parse(secret));
    } else {
      key = Uint8Array.from(Buffer.from(secret, 'base64'));
    }
  } else if (Array.isArray(secret)) {
    key = Uint8Array.from(secret);
  } else if (secret instanceof Uint8Array) {
    key = secret;
  } else {
    throw new Error('Invalid private key type. Must be array, Uint8Array, or base64 string.');
  }
  if (key.length < 32) throw new Error('Invalid private key length. Must be at least 32 bytes.');
  return Keypair.fromSecretKey(key);
}

// Generate a new keypair
export function generateKeypair() {
  return Keypair.generate();
}

// Export secret key as base64 string
export function exportSecretKey(keypair: any): string {
  return Buffer.from(keypair.secretKey).toString('base64');
}

// Create a Solana connection (Mainnet or Devnet)
export function getConnection() {
  const network = process.env.NETWORK === 'devnet' ? 'devnet' : 'mainnet-beta';
  const rpcUrl = process.env.HELIUS_RPC_URL || process.env.RPC_URL || clusterApiUrl(network);
  return new Connection(rpcUrl, 'confirmed');
}
