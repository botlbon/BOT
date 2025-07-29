import { Keypair, Connection, clusterApiUrl } from '@solana/web3.js';

// تحميل المفتاح من ملف البيئة
export function loadKeypair(secret: number[]): Keypair {
  if (!secret || !Array.isArray(secret) || secret.length < 32) {
    throw new Error('Invalid private key. Check PRIVATE_KEY in the environment file.');
  }
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

// إنشاء اتصال بالشبكة (Mainnet أو Devnet)
export function getConnection(): Connection {
  const network = process.env.NETWORK === 'devnet' ? 'devnet' : 'mainnet-beta';
  const rpcUrl = process.env.HELIUS_RPC_URL || process.env.RPC_URL || clusterApiUrl(network);
  return new Connection(rpcUrl, 'confirmed');
}
