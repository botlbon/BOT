// User wallet management
import { Keypair } from '@solana/web3.js';
import { User } from './types';
import { parseSolanaPrivateKey, toBase64Key } from '../keyFormat';

export function hasWallet(user?: User): boolean {
  return !!(user && user.wallet && user.secret);
}

export function createWallet(user: User): User {
  const keypair = Keypair.generate();
  user.wallet = keypair.publicKey.toBase58();
  user.secret = Buffer.from(keypair.secretKey).toString('base64');
  user.history = user.history || [];
  user.history.push('Created new wallet');
  return user;
}

export function restoreWallet(user: User, secret: string): User | null {
  try {
    const secretKey = parseSolanaPrivateKey(secret);
    if (secretKey && secretKey.length === 64) {
      const keypair = Keypair.fromSecretKey(secretKey);
      user.wallet = keypair.publicKey.toBase58();
      user.secret = toBase64Key(secretKey);
      user.history = user.history || [];
      user.history.push('Wallet restored from private key');
      return user;
    }
  } catch {}
  return null;
}
