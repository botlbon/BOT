import { User } from './types';
import { Markup } from 'telegraf';
import fs from 'fs';

export function getErrorMessage(e: any): string {
  return e?.message || String(e);
}

export function limitHistory(user: User) {
  if (user.history && user.history.length > 100) {
    user.history = user.history.slice(-100);
  }
}

export function hasWallet(user?: User): boolean {
  return !!(user && user.wallet && user.secret);
}

export function walletKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔑 Restore Wallet', 'restore_wallet'), Markup.button.callback('🆕 Create Wallet', 'create_wallet')]
  ]);
}

export function saveUsers(users: Record<string, User>, file: string = 'users.json') {
  try {
    fs.writeFileSync(file, JSON.stringify(users, null, 2));
  } catch {}
}

export function loadUsers(file: string = 'users.json'): Record<string, User> {
  try {
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf8');
      return JSON.parse(raw);
    }
  } catch {}
  return {};
}
