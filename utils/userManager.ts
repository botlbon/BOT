// User Manager: unified user load/save for all bot modules
import fs from 'fs';

export interface User {
  wallet?: string;
  secret?: string;
  trades?: number;
  activeTrades?: number;
  history?: string[];
  referrer?: string;
  referrals?: string[];
  strategy?: Record<string, any>;
  lastTokenList?: any[];
  honeyTemp?: any;
  _pendingSellAll?: any[];
  copiedWallets?: string[];
  lastMessageAt?: number;
}

const USERS_FILE = 'users.json';

export function loadUsers(): Record<string, User> {
  try {
    if (fs.existsSync(USERS_FILE)) {
      return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    }
    return {};
  } catch {
    return {};
  }
}

export function saveUsers(users: Record<string, User>) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (e) {
    console.error('Failed to save users:', e);
  }
}
