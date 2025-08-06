// Confirm strategy wizard button
// --- Sent Tokens Rotating File System ---

import crypto from 'crypto';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();
import fs from 'fs';
import { STRATEGY_FIELDS, buildTokenMessage } from './utils/tokenUtils';
import fetchDefault from 'node-fetch';
const fetch: typeof fetchDefault = (globalThis.fetch ? globalThis.fetch : (fetchDefault as any));
import { Markup, Telegraf } from 'telegraf';
import type { Context } from 'telegraf';
import type { Strategy } from './bot/types';
import { getErrorMessage, limitHistory, hasWallet, walletKeyboard, loadUsers, saveUsers } from './bot/helpers';
import { filterTokensByStrategy } from './bot/strategy';
import { loadKeypair, getConnection } from './wallet';
import { parseSolanaPrivateKey, toBase64Key } from './keyFormat';
const { unifiedBuy, unifiedSell } = require('./tradeSources');
import { helpMessages } from './helpMessages';
import { monitorCopiedWallets } from './utils/portfolioCopyMonitor';

console.log('Loaded TELEGRAM_BOT_TOKEN:', process.env.TELEGRAM_BOT_TOKEN);

// Declare users and bot at the top before any usage
let users: Record<string, any> = loadUsers();
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
console.log('🚀 Telegram bot script loaded.');

const SENT_TOKENS_DIR = path.join(__dirname, 'sent_tokens');

const MAX_HASHES_PER_USER = 6000; // Max per user (configurable)
const CLEANUP_TRIGGER_COUNT = 3000; // Cleanup starts at this count
const CLEANUP_BATCH_SIZE = 10; // Number of addresses deleted per batch
const SENT_TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 1 day only
const SENT_TOKEN_LOCK_MS = 2000; // Simple file lock duration (2 seconds)

// Ensure sent_tokens directory exists at startup
try {
  if (!fs.existsSync(SENT_TOKENS_DIR)) fs.mkdirSync(SENT_TOKENS_DIR);
} catch (e) {
  console.error('❌ Failed to create sent_tokens directory:', e);
}



// Get sent_tokens file name for each user
function getUserSentFile(userId: string): string {
  return path.join(SENT_TOKENS_DIR, `${userId}.json`);
}

// Simple file lock
function lockFile(file: string): Promise<void> {
  const lockPath = file + '.lock';
  return new Promise((resolve) => {
    const tryLock = () => {
      if (!fs.existsSync(lockPath)) {
        fs.writeFileSync(lockPath, String(Date.now()));
        setTimeout(resolve, 10); // Small delay
      } else {
        // If lock is old > 2 seconds, delete it
        try {
          const ts = Number(fs.readFileSync(lockPath, 'utf8'));
          if (Date.now() - ts > SENT_TOKEN_LOCK_MS) fs.unlinkSync(lockPath);
        } catch {}
        setTimeout(tryLock, 20);
      }
    };
    tryLock();
  });
}
function unlockFile(file: string) {
  const lockPath = file + '.lock';
  if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
}


// Hash a token address (normalized)
export function hashTokenAddress(addr: string): string {
  return crypto.createHash('sha256').update(addr.trim().toLowerCase()).digest('hex');
}



// Read all valid hashes for the user (with smart cleanup)
export async function readSentHashes(userId: string): Promise<Set<string>> {
  const file = getUserSentFile(userId);
  await lockFile(file);
  let hashes: string[] = [];
  const now = Date.now();
  let arr: any[] = [];
  let valid: any[] = [];
  try {
    if (fs.existsSync(file)) {
      arr = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(arr)) arr = [];
      // Remove expired (older than 1 day)
      valid = arr.filter((obj: any) => obj && obj.hash && (now - (obj.ts || 0) < SENT_TOKEN_EXPIRY_MS));
      hashes = valid.map(obj => obj.hash);
      // If length changed, rewrite with smart error handling
      if (valid.length !== arr.length) {
        let retry = 0;
        while (retry < 3) {
          try {
            fs.writeFileSync(file, JSON.stringify(valid));
            break;
          } catch (e) {
            retry++;
            await new Promise(res => setTimeout(res, 50 * retry));
            if (retry === 3) console.warn(`[sent_tokens] Failed to clean (read) ${file} after retries:`, e);
          }
        }
      }
    }
  } catch (e) {
    console.warn(`[sent_tokens] Failed to read/clean ${file}:`, e);
  }
  unlockFile(file);
  return new Set(hashes);
}



// Add a new hash for the user (with deduplication and cleanup)
export async function appendSentHash(userId: string, hash: string) {
  const file = getUserSentFile(userId);
  await lockFile(file);
  const now = Date.now();
  let arr: any[] = [];
  try {
    if (fs.existsSync(file)) {
      arr = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(arr)) arr = [];
    }
    // Remove expired (older than 1 day)
    arr = arr.filter((obj: any) => obj && obj.hash && (now - (obj.ts || 0) < SENT_TOKEN_EXPIRY_MS));
    // Prevent duplicates
    if (arr.some(obj => obj.hash === hash)) {
      unlockFile(file);
      return;
    }
    arr.push({ hash, ts: now });
    // If reached CLEANUP_TRIGGER_COUNT or more, delete oldest CLEANUP_BATCH_SIZE
    if (arr.length >= CLEANUP_TRIGGER_COUNT) {
      arr = arr.slice(CLEANUP_BATCH_SIZE);
    }
    // If exceeded max, keep only last MAX_HASHES_PER_USER
    if (arr.length > MAX_HASHES_PER_USER) {
      arr = arr.slice(arr.length - MAX_HASHES_PER_USER);
    }
    // Smart error handling on write
    let retry = 0;
    while (retry < 3) {
      try {
        fs.writeFileSync(file, JSON.stringify(arr));
        break;
      } catch (e) {
        retry++;
        await new Promise(res => setTimeout(res, 50 * retry));
        if (retry === 3) console.warn(`[sent_tokens] Failed to write ${file} after retries:`, e);
      }
    }
  } catch (e) {
    console.warn(`[sent_tokens] Failed to write ${file}:`, e);
  }
  unlockFile(file);
}



// No longer need rotateAndCleanIfNeeded with the new system

// Developer command: show all fields used in strategy wizard
bot.command('debug_fields', async (ctx: any) => {
  let msg = '<b>STRATEGY_FIELDS:</b>\n';
  msg += STRATEGY_FIELDS.map(f => `• <b>${f.label}</b> (<code>${f.key}</code>) [${f.type}]`).join('\n');
  await ctx.reply(msg, { parse_mode: 'HTML' });
});

// Always reply to /start for any user (new or existing)
bot.start(async (ctx: any) => {
  const user = getOrRegisterUser(ctx);
  await ctx.reply('👋 Welcome! You are now registered. Here is the main menu:', { parse_mode: 'HTML' });
  await sendMainMenu(ctx);
});

// Helper: Register user if new, always returns the user object
function getOrRegisterUser(ctx: any): any {
  const userId = String(ctx.from?.id);
  if (!users[userId]) {
    users[userId] = {
      id: userId,
      username: ctx.from?.username || '',
      firstName: ctx.from?.first_name || '',
      registeredAt: Date.now(),
      trades: 0,
      activeTrades: 1,
      history: [],
      // Add more default fields as needed
    };
    saveUsers(users);
    ctx.reply('👋 Welcome! You are now registered. Here is the main menu:', { parse_mode: 'HTML' });
    sendMainMenu(ctx);
  }
  return users[userId];
}

// === Activity Button Handler ===
// === Enhanced Activity Button Handler ===
bot.action('show_activity', async (ctx: any) => {
  const user = getOrRegisterUser(ctx);
  await ctx.answerCbQuery();
  if (!user.wallet || !user.secret) {
    await ctx.reply('❌ No wallet found. Please create or restore your wallet first.', walletKeyboard());
    return;
  }
  await ctx.reply('⏳ Fetching your wallet tokens and recent trades...');
  // 1. Fetch wallet tokens and balances
  let tokensMsg = '<b>👛 Your Wallet Tokens:</b>\n';
  let hasTokens = false;
  try {
    const { getConnection } = await import('./wallet');
    const conn = getConnection();
    const publicKey = (await import('@solana/web3.js')).PublicKey;
    const pk = new publicKey(user.wallet);
    // Fetch SOL balance
    const solBalance = await conn.getBalance(pk);
    tokensMsg += `• <b>SOL:</b> <code>${(solBalance / 1e9).toFixed(4)}</code>\n`;
    // Fetch SPL token accounts
    const { getParsedTokenAccountsByOwner } = conn;
    let tokenAccounts: any[] = [];
    try {
      const res = await conn.getParsedTokenAccountsByOwner(pk, { programId: (await import('@solana/spl-token')).TOKEN_PROGRAM_ID });
      tokenAccounts = res.value || [];
    } catch {}
    if (tokenAccounts.length > 0) {
      for (const acc of tokenAccounts) {
        const info = acc.account.data.parsed.info;
        const mint = info.mint;
        const amount = info.tokenAmount.uiAmountString;
        if (Number(amount) > 0) {
          tokensMsg += `• <b>Token:</b> <code>${mint}</code> | <b>Balance:</b> <code>${amount}</code>\n`;
          hasTokens = true;
        }
      }
    }
    if (!hasTokens && solBalance === 0) {
      tokensMsg += '<i>No tokens or SOL found in your wallet.</i>\n';
    }
  } catch (e) {
    tokensMsg += '<i>Failed to fetch wallet tokens.</i>\n';
  }

  // 2. Show last real trades (from user.history)
  let tradesMsg = '\n<b>📈 Your Recent Trades:</b>\n';
  let tradeEntries = [];
  if (Array.isArray(user.history)) {
    // Only show real trades (ManualBuy, AutoBuy, Sell, etc.)
    tradeEntries = user.history.filter((entry: string) => /ManualBuy|AutoBuy|Sell/i.test(entry));
  }
  if (tradeEntries.length === 0) {
    tradesMsg += '<i>No trades found.</i>';
  } else {
    // Show up to 10 most recent trades, newest first
    const lastTrades = tradeEntries.slice(-10).reverse();
    for (const t of lastTrades) {
      // Try to format trade entry professionally
      let formatted = t;
      // Example: ManualBuy: <address> | Amount: <amt> SOL | Source: <src> | Tx: <tx>
      const buyMatch = t.match(/(ManualBuy|AutoBuy): ([^|]+) \| Amount: ([^ ]+) SOL \| Source: ([^|]+) \| Tx: ([^\s]+)/);
      if (buyMatch) {
        formatted = `• <b>${buyMatch[1]}</b> <code>${buyMatch[2]}</code> | <b>Amount:</b> <code>${buyMatch[3]}</code> SOL | <b>Source:</b> <code>${buyMatch[4]}</code> | <a href='https://solscan.io/tx/${buyMatch[5]}'>View Tx</a>`;
      }
      const sellMatch = t.match(/Sell: ([^|]+) \| Amount: ([^ ]+) SOL \| Source: ([^|]+) \| Tx: ([^\s]+)/);
      if (sellMatch) {
        formatted = `• <b>Sell</b> <code>${sellMatch[1]}</code> | <b>Amount:</b> <code>${sellMatch[2]}</code> SOL | <b>Source:</b> <code>${sellMatch[3]}</code> | <a href='https://solscan.io/tx/${sellMatch[4]}'>View Tx</a>`;
      }
      tradesMsg += formatted + '\n';
    }
  }

  await ctx.reply(tokensMsg + tradesMsg, { parse_mode: 'HTML', disable_web_page_preview: false });
});

// === Sell Button Handler ===
bot.action('sell', async (ctx: any) => {
  await ctx.answerCbQuery();
  await ctx.reply('🛑 Sell feature is coming soon!');
});

// === Buy Button Handler ===
bot.action('buy', async (ctx: any) => {
  await ctx.answerCbQuery();
  await ctx.reply('🟢 To buy a token, please select one from the token list or use /start to refresh the menu.');
});



// === Set Strategy Button Handler (Wizard) ===

type StrategyWizardState = { step: number, data: any, isConfirm?: boolean };
let strategyWizard: Record<string, StrategyWizardState> = {};


// Cancel strategy wizard button
bot.action('cancel_strategy', async (ctx: any) => {
  const userId = String(ctx.from?.id);
  delete strategyWizard[userId];
  await ctx.answerCbQuery('Strategy setup cancelled.');
  await ctx.reply('❌ Strategy setup cancelled.');
  await sendMainMenu(ctx);
});

// Start strategy wizard
bot.action('set_strategy', async (ctx: any) => {
// Confirm strategy wizard button
bot.action('confirm_strategy', async (ctx: any) => {
  const userId = String(ctx.from?.id);
  const wizard = strategyWizard[userId];
  if (!wizard || !wizard.isConfirm) {
    await ctx.answerCbQuery('No strategy to confirm.');
    return;
  }
  // Save strategy to user
  if (!users[userId]) users[userId] = {};
  users[userId].strategy = { ...wizard.data };
  saveUsers(users);
  delete strategyWizard[userId];
  await ctx.answerCbQuery('Strategy confirmed!');
  await ctx.reply('✅ Your strategy has been saved and activated.', { parse_mode: 'HTML' });
  await sendMainMenu(ctx);
});
  const userId = String(ctx.from?.id);
  // Get dynamic fields and merge before static

  strategyWizard[userId] = { step: 0, data: { ...((users[userId] && users[userId].strategy) || {}) } };
  await ctx.answerCbQuery();
  await askStrategyField(ctx, userId);
});

bot.on('text', async (ctx: any, next: any) => {
  const userId = String(ctx.from?.id);
  if (!strategyWizard[userId]) return next();
  const wizard = strategyWizard[userId];
  // Support cancel by text
  if (ctx.message.text.trim().toLowerCase() === 'cancel') {
    delete strategyWizard[userId];
    await ctx.reply('❌ Strategy setup cancelled.');
    await sendMainMenu(ctx);
    return;
  }
  const field = STRATEGY_FIELDS[wizard.step];
  let value = ctx.message.text.trim();
  // Allow skip
  if (value.toLowerCase() === 'skip' && field.optional) {
    wizard.data[field.key] = undefined;
  } else if (field.type === 'number') {
    const num = Number(value);
    if (isNaN(num)) {
      await ctx.reply('❌ Please enter a valid number or type skip.', cancelKeyboard());
      return;
    }
    wizard.data[field.key] = num;
  } else if (field.type === 'boolean') {
    if (['yes', 'y', 'true', '✅'].includes(value.toLowerCase())) {
      wizard.data[field.key] = true;
    } else if (['no', 'n', 'false', '❌'].includes(value.toLowerCase())) {
      wizard.data[field.key] = false;
    } else {
      await ctx.reply('❌ Please answer with Yes or No.', cancelKeyboard());
      return;
    }
  } else if (field.type === 'string') {
    wizard.data[field.key] = value;
  }
  wizard.step++;
  if (wizard.step < STRATEGY_FIELDS.length) {
    await askStrategyField(ctx, userId);
  } else {
    // Before saving, send strategy summary and ask for confirmation
    strategyWizard[userId].isConfirm = true;
    await ctx.reply('📝 Please review your strategy below. If all is correct, press Confirm. Otherwise, press Cancel.', {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Confirm', 'confirm_strategy'), Markup.button.callback('❌ Cancel', 'cancel_strategy')]
      ])
    });
    await ctx.reply(formatStrategySummary(wizard.data), { parse_mode: 'HTML' });
  }
});

function cancelKeyboard() {
  return Markup.keyboard([['Cancel']]).oneTime().resize();
}

async function askStrategyField(ctx: any, userId: string) {
  const wizard = strategyWizard[userId];
  const field = STRATEGY_FIELDS[wizard.step];
  let current = wizard.data[field.key];
  let msg = `Step ${wizard.step + 1}/${STRATEGY_FIELDS.length}\n`;
  msg += `Set <b>${field.label}</b>`;
  if (field.type === 'boolean') {
    msg += ` (Yes/No)`;
  } else if (field.optional) {
    msg += ` (or type skip)`;
  }
  if (current !== undefined) {
    msg += `\nCurrent: <code>${current}</code>`;
  }
  msg += `\n<em>Type 'Cancel' anytime to exit.</em>`;
  await ctx.reply(msg, { parse_mode: 'HTML', ...cancelKeyboard() });
}

// Strategy summary
function formatStrategySummary(data: any): string {
  let msg = '<b>Strategy Summary:</b>\n';
  for (const field of STRATEGY_FIELDS) {
    let val = data[field.key];
    if (val === undefined) val = '<i>Not set</i>';
    // Special label for age
    let label = field.label;
    if (field.key === 'age') label = 'Minimum Age (minutes)';
    msg += `• <b>${label}:</b> <code>${val}</code>\n`;
  }
  return msg;
}

// Admin command: manually rotate sent_tokens files (delete oldest file)
// For developer use only (e.g. via user ID)
const ADMIN_IDS = [process.env.ADMIN_ID || '123456789']; // Set developer ID here or in env
bot.command('rotate_sent_tokens', async (ctx: any) => {
  const userId = String(ctx.from?.id);
  if (!ADMIN_IDS.includes(userId)) {
    await ctx.reply('❌ This command is for developers only.');
    return;
  }
  const targetId = ctx.message.text.split(' ')[1] || userId;
  const file = getUserSentFile(targetId);
  if (fs.existsSync(file)) {
    try {
      fs.unlinkSync(file);
      await ctx.reply(`✅ sent_tokens file (${path.basename(file)}) deleted for user ${targetId}.`);
    } catch (e) {
      await ctx.reply(`❌ Failed to delete file: ${e}`);
    }
  } else {
    await ctx.reply('No sent_tokens file to delete.');
  }
});




// === Honey Points Button Handler ===
bot.action('honey_points', async (ctx: any) => {
  await ctx.answerCbQuery();
  await ctx.reply('🍯 Honey Points system is coming soon!');
});

// === My Wallet Button Handler ===
bot.action('my_wallet', async (ctx: any) => {
  const user = getOrRegisterUser(ctx);
  await ctx.answerCbQuery();
  let replyText = user.wallet
    ? `👛 Your wallet address:\n<code>${user.wallet}</code>`
    : 'You do not have a wallet yet. Use the "Create Wallet" button to generate one.';
  let buttons = [];
  if (user.wallet) {
    buttons.push([{ text: '🔑 Show Private Key', callback_data: 'show_private_key' }]);
  }
  await ctx.reply(replyText, {
    parse_mode: 'HTML',
    reply_markup: buttons.length ? { inline_keyboard: buttons } : undefined
  });
});

// Show actual private key (in all available formats)
bot.action('show_private_key', async (ctx: any) => {
  const userId = String(ctx.from?.id);
  const user = users[userId];
  if (!user || !user.secret) {
    return await ctx.reply(helpMessages.wallet_needed, walletKeyboard());
  }
  // Try to show in base64, base58, hex if possible
  let base64 = user.secret;
  let base58 = '';
  let hex = '';
  try {
    const { parseKey } = await import('./wallet');
    const keypair = parseKey(base64);
    const secretKey = Buffer.from(keypair.secretKey);
    base58 = require('bs58').encode(secretKey);
    hex = secretKey.toString('hex');
  } catch {}
  let msg = '⚠️ <b>Your private key:</b>\n';
  msg += `<b>Base64:</b> <code>${base64}</code>\n`;
  if (base58) msg += `<b>Base58:</b> <code>${base58}</code>\n`;
  if (hex) msg += `<b>Hex:</b> <code>${hex}</code>\n`;
  await ctx.reply(msg, { parse_mode: 'HTML' });
});

// === Sell All Wallet Button Handler ===
bot.action('sell_all_wallet', async (ctx: any) => {
  await ctx.answerCbQuery();
  await ctx.reply('💰 Sell All feature is coming soon!');
});

// === Copy Trade Button Handler ===
bot.action('copy_trade', async (ctx: any) => {
  await ctx.answerCbQuery();
  await ctx.reply('📋 Copy Trade feature is coming soon!');
});

// === Invite Friends Button Handler ===
bot.action('invite_friends', async (ctx: any) => {
  const userId = String(ctx.from?.id);
  const inviteLink = getUserInviteLink(userId, ctx);
  await ctx.answerCbQuery();
  await ctx.reply(`🔗 Share this link to invite your friends:\n${inviteLink}`);
});





// Removed duplicate and commented-out helper function definitions. All helper functions are defined once at the top of the file.



// Register strategy handlers and token notifications from wsListener (after users is defined)
import { registerWsNotifications } from './wsListener';

// Register token notification logic (DexScreener or WebSocket)
registerWsNotifications(bot, users);


// Global Token Cache for Sniper Speed
let globalTokenCache: any[] = [];
let lastCacheUpdate = 0;
const CACHE_TTL = 60 * 1000; // 1 minute

function getStrategyCacheKey(strategy: any): string {
  // استخدم JSON.stringify ثم sha256 للحصول على مفتاح فريد للاستراتيجية
  const str = JSON.stringify(strategy || {});
  return crypto.createHash('sha256').update(str).digest('hex');
}

function getUserInviteLink(userId: string, ctx?: any): string {
  // Use env BOT_USERNAME or fallback to ctx.botInfo.username
  const botUsername = process.env.BOT_USERNAME || ctx?.botInfo?.username || 'YourBotUsername';
  return `https://t.me/${botUsername}?start=${userId}`;
}

// Log every incoming update for tracing
bot.use((ctx: any, next: any) => {
  let text = undefined;
  let data = undefined;
  if ('message' in ctx && ctx.message && typeof ctx.message === 'object' && 'text' in ctx.message) {
    text = (ctx.message as any).text;
  }
  if ('callbackQuery' in ctx && ctx.callbackQuery && typeof ctx.callbackQuery === 'object' && 'data' in ctx.callbackQuery) {
    data = (ctx.callbackQuery as any).data;
  }
  console.log('📥 Incoming update:', {
    type: ctx.updateType,
    from: ctx.from?.id,
    text,
    data
  });
  return next();
});

// Welcome sticker
const WELCOME_STICKER = 'CAACAgUAAxkBAAEBQY1kZ...'; // Welcome sticker ID

// Users file
const USERS_FILE = 'users.json';

let boughtTokens: Record<string, Set<string>> = {};
// Cleanup boughtTokens for users who have not bought tokens in the last 24h
function cleanupBoughtTokens() {
  const now = Date.now();
  for (const userId in boughtTokens) {
    const user = users[userId];
    if (!user || !user.history) {
      delete boughtTokens[userId];
      continue;
    }
    // Remove tokens older than 24h from the set (if you store timestamps in history)
    // For now, just keep the set as is, but you can enhance this logic if you store timestamps
    // Optionally, clear the set if user has no active strategy
    if (!user.strategy || !user.strategy.enabled) {
      boughtTokens[userId].clear();
    }
  }
}
setInterval(cleanupBoughtTokens, 60 * 60 * 1000); // Clean every hour



// --- DexScreener API: fetch all pairs for a token address ---
async function fetchDexScreenerPairs(tokenAddress: string): Promise<any[]> {
  try {
    const res = await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${tokenAddress}`);
    if (!res.ok) return [];
    const data: unknown = await res.json();
    if (Array.isArray(data)) return data;
    if (typeof data === 'object' && data !== null && 'pairs' in data && Array.isArray((data as any).pairs)) return (data as any).pairs;
    return [];
  } catch (e) {
    console.error('DexScreener API error:', e);
    return [];
  }
}

// --- Unified token fetch: DexScreener (main), Jupiter (secondary) ---
async function fetchUnifiedTokenList(): Promise<any[]> {
  let allTokens: any[] = [];
  try {
    // 1. Boosts endpoint
    const boostsRes = await fetch('https://api.dexscreener.com/token-boosts/latest/v1');
    let boostsTokens: any[] = [];
    if (boostsRes.ok) {
      const boostsData = await boostsRes.json();
      console.log('[DEBUG] DexScreener boosts response:', JSON.stringify(boostsData).slice(0, 500));
      boostsTokens = Array.isArray(boostsData) ? boostsData : (Array.isArray(boostsData.boosts) ? boostsData.boosts : []);
      allTokens = allTokens.concat(boostsTokens.map((p: any) => ({
        name: p.name,
        symbol: p.symbol,
        address: p.tokenAddress,
        priceUsd: p.priceUsd,
        priceNative: p.priceNative,
        marketCap: p.marketCap,
        volume: p.amount ?? p.volume,
        holders: p.holders,
        age: p.createdAt ?? p.age,
        verified: p.verified,
        url: p.url,
        pairAddress: p.pairAddress,
        dexId: p.dexId,
        quoteToken: p.quoteToken,
        txns: p.txns,
        liquidity: p.liquidity
      })));
    }
    // 2. Profiles endpoint
    const profilesRes = await fetch('https://api.dexscreener.com/token-profiles/latest/v1?chainId=solana&limit=100');
    let profilesTokens: any[] = [];
    if (profilesRes.ok) {
      const profilesData = await profilesRes.json();
      console.log('[DEBUG] DexScreener profiles response:', JSON.stringify(profilesData).slice(0, 500));
      profilesTokens = Array.isArray(profilesData) ? profilesData : (Array.isArray(profilesData.profiles) ? profilesData.profiles : []);
      allTokens = allTokens.concat(profilesTokens.map((p: any) => ({
        name: p.name,
        symbol: p.symbol,
        address: p.tokenAddress,
        priceUsd: p.priceUsd,
        priceNative: p.priceNative,
        marketCap: p.marketCap,
        volume: p.amount ?? p.volume,
        holders: p.holders,
        age: p.createdAt ?? p.age,
        verified: p.verified,
        url: p.url,
        pairAddress: p.pairAddress,
        dexId: p.dexId,
        quoteToken: p.quoteToken,
        txns: p.txns,
        liquidity: p.liquidity
      })));
    }
  } catch (e) {
    console.error('DexScreener boosts/profiles fetch error:', e);
  }
  // استبعاد العملات الكبيرة المعروفة (مثل USDC, SOL)
  const blacklist = [
    'So11111111111111111111111111111111111111112', // SOL
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    'Es9vMFrzaCERa8wF5wF4QG1rj5Q3g9Q2r5r9Q2r5r9Q2', // USDT (مثال)
  ];
  // فلترة توكنات سولانا فقط مع pairAddress صحيح واستبعاد عناوين 0x و ::
  allTokens = allTokens.filter(t => {
    const addr = t.address || t.tokenAddress || t.pairAddress;
    if (!addr) return false;
    if (blacklist.includes(addr)) return false;
    if (typeof addr === 'string' && (addr.startsWith('0x') || addr.includes('::'))) return false;
    // يجب أن يكون url يحتوي /solana/
    if (!(t.url && t.url.includes('/solana/'))) return false;
    return true;
  });
  // Deduplicate by address
  const seen = new Set();
  const deduped = allTokens.filter(t => {
    const addr = t.address || t.tokenAddress || t.pairAddress;
    if (!addr || seen.has(addr)) return false;
    seen.add(addr);
    return true;
  });
  // جلب بيانات تفصيلية لأي رمز ناقص marketCap أو liquidity أو age أو holders
  async function fetchTokenDetails(address: string) {
    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
      if (!res.ok) return null;
      const data = await res.json();
      // ابحث عن أول نتيجة تخص سولانا
      const solanaPair = (data.pairs || []).find((p: any) => p.chainId === 'solana');
      if (!solanaPair) return null;
      return {
        marketCap: solanaPair.fdv || solanaPair.marketCap,
        liquidity: solanaPair.liquidity && solanaPair.liquidity.usd,
        volume: solanaPair.volume && solanaPair.volume.h24,
        age: solanaPair.age,
        holders: solanaPair.holders,
        ...solanaPair
      };
    } catch (e) {
      return null;
    }
  }

  // أكمل البيانات الناقصة فقط
  const completed = await Promise.all(deduped.map(async t => {
    if (t.marketCap && t.liquidity && t.age && t.holders) return t;
    const details = await fetchTokenDetails(t.address || t.tokenAddress || t.pairAddress);
    return details ? { ...t, ...details } : t;
  }));
  return completed;
}

// Define addHoneyToken at top level
function addHoneyToken(userId: string, tokenData: any, users: any) {
  // ...existing logic for adding honey token...
  // Placeholder implementation
  if (!users[userId].honeyTokens) users[userId].honeyTokens = [];
  users[userId].honeyTokens.push(tokenData);
}

// Define getCachedTokenList at top level
async function getCachedTokenList() {
  const now = Date.now();
  if (globalTokenCache.length === 0 || now - lastCacheUpdate > CACHE_TTL) {
    const tokens = await fetchUnifiedTokenList();
    globalTokenCache = Array.isArray(tokens) ? tokens : [];
    lastCacheUpdate = now;
  }
  return globalTokenCache;
}


// === Auto Strategy Monitor & Trade Watcher ===
async function autoStrategyMonitorAndTradeWatcher() {
  const gAny = globalThis as any;
  if (!gAny.openTrades) gAny.openTrades = {};
  for (const userId in users) {
    const user = users[userId];
    if (!user?.strategy || !user.strategy.enabled || !user.secret) continue;
    // 1. Auto-buy logic (كما هو سابقًا)
    let tokens: any[] = [];
    try {
      tokens = await getCachedTokenList();
    } catch {}
    if (!tokens || tokens.length === 0) continue;
    const strat = user.strategy;
    const filtered = filterTokensByStrategy(tokens, strat);
    boughtTokens[userId] = boughtTokens[userId] || new Set();
    gAny.openTrades[userId] = gAny.openTrades[userId] || [];
    // افتح صفقات جديدة إذا لم تتجاوز الحد
    for (const t of filtered) {
      if (!t.address) continue;
      if (boughtTokens[userId].has(t.address)) continue;
      if (gAny.openTrades[userId].length >= user.strategy.maxActiveTrades) break;
      // تحقق من الرصيد
      let solBalance = 0;
      try {
        const { getConnection } = await import('./wallet');
        const conn = getConnection();
        const publicKey = (await import('@solana/web3.js')).PublicKey;
        solBalance = await conn.getBalance(new publicKey(user.wallet));
      } catch {}
      if (solBalance < (user.strategy.buyAmount * 1e9)) break;
      // نفذ شراء
      try {
        const { tx, source } = await unifiedBuy(t.address, user.strategy.buyAmount, user.secret);
        boughtTokens[userId].add(t.address);
        user.history = user.history || [];
        user.history.push(`AutoBuy: ${t.address} | Amount: ${user.strategy.buyAmount} SOL | Source: ${source} | Tx: ${tx}`);
        saveUsers(users);
        // أضف الصفقة إلى openTrades
        const entryPrice = Number(t.priceUsd || t.price || 0);
        const trade = {
          tokenAddress: t.address,
          amount: user.strategy.buyAmount,
          entryPrice,
          sold1: false,
          sold2: false,
          stopped: false,
          tx,
          source
        };
        gAny.openTrades[userId].push(trade);
        await bot.telegram.sendMessage(userId,
          `🤖 <b>Auto-buy executed by strategy!</b>\n\n` +
          `<b>Token:</b> <code>${t.address}</code>\n` +
          `<b>Amount:</b> ${user.strategy.buyAmount} SOL\n` +
          `<b>Profit Targets:</b> ${(user.strategy.profitTargets ?? [20,50]).join(', ')}%\n` +
          `<b>Sell Percents:</b> ${(user.strategy.sellPercents ?? [50,50]).join(', ')}%\n` +
          `<b>Stop Loss:</b> ${user.strategy.stopLossPercent ?? 15}%\n` +
          `<b>Source:</b> ${source}\n` +
          `<b>Transaction:</b> <a href='https://solscan.io/tx/${tx}'>${tx}</a>`,
          { parse_mode: 'HTML' }
        );
      } catch (e: any) {
        // Surface buy errors to user and terminal, and fetch logs if possible
        let errorMsg = `❌ <b>Auto-buy failed for token:</b> <code>${t.address}</code>\n`;
        let logs: string[] | undefined;
        if (e && typeof e === 'object') {
          if (e.message) errorMsg += `\n<b>Error:</b> <code>${e.message}</code>`;
          // If it's a SendTransactionError and has getLogs, fetch logs
          if (e.name === 'SendTransactionError' && typeof e.getLogs === 'function') {
            try {
              logs = await e.getLogs();
              if (logs) errorMsg += `\n<b>Logs:</b> <pre>${Array.isArray(logs) ? logs.join('\n') : logs}</pre>`;
            } catch (logErr: any) {
              errorMsg += `\n<b>Log fetch error:</b> <code>${logErr && typeof logErr === 'object' && 'message' in logErr ? logErr.message : String(logErr)}</code>`;
            }
          }
          // Always show transactionLogs if present
          if (e.transactionLogs) {
            errorMsg += `\n<b>Transaction Logs:</b> <pre>${Array.isArray(e.transactionLogs) ? e.transactionLogs.join('\n') : e.transactionLogs}</pre>`;
          }
          // Always show transactionMessage if present
          if (e.transactionMessage) {
            errorMsg += `\n<b>Transaction Message:</b> <code>${e.transactionMessage}</code>`;
          }
          if (e.logs) {
            errorMsg += `\n<b>Logs:</b> <pre>${Array.isArray(e.logs) ? e.logs.join('\n') : e.logs}</pre>`;
          }
        } else {
          errorMsg += `\n<b>Error:</b> <code>${e}</code>`;
        }
        // Print to terminal for debugging
        console.error('Auto-buy error:', e);
        if (logs) console.error('Transaction logs:', logs);
        // Send to user via Telegram
        await bot.telegram.sendMessage(userId, errorMsg, { parse_mode: 'HTML' });
      }
    }
    // 2. مراقبة الصفقات المفتوحة وتنفيذ البيع/وقف الخسارة تلقائيًا
    for (const trade of [...gAny.openTrades[userId]]) {
      if (trade._watching) continue; // لا تكرر المراقبة
      trade._watching = true;
      (async function watch(tradeObj, userObj, userIdStr) {
        // unifiedSell متوفر من الأعلى بنمط require
        let active = true;
        while (active) {
          await new Promise(res => setTimeout(res, 2000));
          // Fetch current price (DexScreener direct API)
          let price = 0;
          try {
            const pairs = await fetchDexScreenerPairs(tradeObj.tokenAddress);
            const token = pairs.find((p: any) => p.priceUsd);
            if (token) price = Number(token.priceUsd || token.priceNative || 0);
          } catch {}
          if (!price || !tradeObj.entryPrice) continue;
          const changePct = ((price - tradeObj.entryPrice) / tradeObj.entryPrice) * 100;
          // First profit target
          if (!tradeObj.sold1 && changePct >= userObj.strategy.profitTarget1) {
            try {
              await unifiedSell(tradeObj.tokenAddress, tradeObj.amount * (userObj.strategy.sellPercent1 / 100), userObj.secret);
              tradeObj.sold1 = true;
              tradeObj.sold1Price = price;
              await bot.telegram.sendMessage(userIdStr, `✅ Sold ${userObj.strategy.sellPercent1}% of ${tradeObj.tokenAddress} at +${userObj.strategy.profitTarget1}% profit.`);
            } catch {}
          }
          // Second profit target
          if (userObj.strategy.profitTarget2 && !tradeObj.sold2 && changePct >= userObj.strategy.profitTarget2) {
            try {
              await unifiedSell(tradeObj.tokenAddress, tradeObj.amount * (userObj.strategy.sellPercent2 / 100), userObj.secret);
              tradeObj.sold2 = true;
              tradeObj.sold2Price = price;
              await bot.telegram.sendMessage(userIdStr, `✅ Sold ${userObj.strategy.sellPercent2}% of ${tradeObj.tokenAddress} at +${userObj.strategy.profitTarget2}% profit.`);
            } catch {}
          }
          // Stop loss
          if (!tradeObj.stopped && changePct <= -Math.abs(userObj.strategy.stopLossPercent)) {
            try {
              await unifiedSell(
                tradeObj.tokenAddress,
                tradeObj.amount - (tradeObj.sold1 ? tradeObj.amount * (userObj.strategy.sellPercent1 / 100) : 0) - (tradeObj.sold2 ? tradeObj.amount * (userObj.strategy.sellPercent2 / 100) : 0),
                userObj.secret
              );
              tradeObj.stopped = true;
              tradeObj.stoppedPrice = price;
              await bot.telegram.sendMessage(userIdStr, `🛑 Stop loss triggered for ${tradeObj.tokenAddress} at ${userObj.strategy.stopLossPercent}% loss.`);
            } catch {}
          }
          // End trade if all sold or stopped
          if ((tradeObj.sold1 && (!userObj.strategy.profitTarget2 || tradeObj.sold2)) || tradeObj.stopped) {
            active = false;
            gAny.openTrades[userIdStr] = gAny.openTrades[userIdStr].filter((t: any) => t !== tradeObj);
          }
        }
      })(trade, user, userId);
    }
  }
}
// Run auto strategy monitor & trade watcher every 5 seconds
setInterval(autoStrategyMonitorAndTradeWatcher, 5000);

// Restore Wallet button handler is now registered in wsListener


// === Restore Wallet Button Handler ===
const restoreWalletSessions: Record<string, boolean> = {};
bot.action('restore_wallet', async (ctx: any) => {
  const userId = String(ctx.from?.id);
  restoreWalletSessions[userId] = true;
  await ctx.answerCbQuery();
  await ctx.reply(
    '🔑 Please send your private key, mnemonic, or JSON array to restore your wallet.\n\n' +
    'Supported formats: base64, base58, hex, or 12/24-word mnemonic.\n' +
    '<b>Warning:</b> Never share your private key with anyone you do not trust!',
    { parse_mode: 'HTML' }
  );
});

// Handler for processing wallet restoration input
bot.on('text', async (ctx: any, next: any) => {
  const userId = String(ctx.from?.id);
  if (!restoreWalletSessions[userId]) return next();
  const input = ctx.message.text.trim();
  const { parseKey } = await import('./wallet');
  try {
    const keypair = parseKey(input);
    users[userId].wallet = keypair.publicKey.toBase58();
    users[userId].secret = Buffer.from(keypair.secretKey).toString('base64');
    users[userId].history = users[userId].history || [];
    users[userId].history.push('Restored wallet');
    saveUsers(users);
    delete restoreWalletSessions[userId];
    await ctx.reply('✅ Wallet restored successfully! Your address: ' + users[userId].wallet);
    await sendMainMenu(ctx);
  } catch (e: any) {
    await ctx.reply('❌ Failed to restore wallet. Please provide a valid key (mnemonic, base58, base64, or hex) or type /cancel.');
  }
});

// Create Wallet button handler
bot.action('create_wallet', async (ctx: any) => {
  const user = getOrRegisterUser(ctx);
  // Try to create wallet from any key type (mnemonic, base58, base64, hex)
  const { generateKeypair, parseKey } = await import('./wallet');
  let keypair;
  // Check if user provided a key in message or session
  let providedKey = ctx.session?.providedKey || null;
  if (!providedKey && ctx.message && ctx.message.text) {
    providedKey = ctx.message.text.trim();
  }
  try {
    if (providedKey) {
      // Try to parse any type
      keypair = parseKey(providedKey);
    } else {
      keypair = generateKeypair();
    }
    user.wallet = keypair.publicKey.toBase58();
    user.secret = Buffer.from(keypair.secretKey).toString('base64');
    user.history = user.history || [];
    user.history.push('Created new wallet');
    saveUsers(users);
    await ctx.reply('✅ New wallet created! Your address: ' + user.wallet);
    await sendMainMenu(ctx);
  } catch (e: any) {
    await ctx.reply('❌ Failed to create wallet. Please provide a valid key (mnemonic, base58, base64, or hex) or try again.');
  }
});

// Export Private Key button handler

// === Add generic handlers for all main menu buttons that have no logic yet ===


// === Activity Button Handler ===
bot.action('show_activity', async (ctx: any) => {
  const user = getOrRegisterUser(ctx);
  await ctx.answerCbQuery();
  if (!Array.isArray(user.history) || user.history.length === 0) {
    await ctx.reply('No activity found for your account.');
    return;
  }
  const lastHistory = user.history.slice(-20).reverse();
  const msg = [
    '<b>Your recent activity:</b>',
    ...lastHistory.map((entry: string) => `- ${entry}`)
  ].join('\n');
  await ctx.reply(msg, { parse_mode: 'HTML' });
});

// Execute buy when a token is selected
bot.action(/buy_token_(.+)/, async (ctx: any) => {
  const userId = String(ctx.from?.id);
  const user = users[userId];
  if (!user || !user.secret) {
    await ctx.reply(helpMessages.wallet_needed, walletKeyboard());
    return;
  }
  const tokenAddress = ctx.match[1];
  const buyAmount = user.strategy?.buyAmount ?? 0.01;
  await ctx.reply(`🚀 Executing buy...\nAddress: ${tokenAddress}\nAmount: ${buyAmount} SOL`);
  try {
    const { tx, source } = await unifiedBuy(tokenAddress, buyAmount, user.secret);
    user.history = user.history || [];
    user.history.push(`ManualBuy: ${tokenAddress} | Amount: ${buyAmount} SOL | Source: ${source} | Tx: ${tx}`);
    saveUsers(users);
    await ctx.reply(
      `✅ Token bought successfully!\n\n` +
      `<b>Token:</b> <code>${tokenAddress}</code>\n` +
      `<b>Amount:</b> ${buyAmount} SOL\n` +
      `<b>Source:</b> ${source}\n` +
      `<b>Transaction:</b> <a href='https://solscan.io/tx/${tx}'>${tx}</a>`,
      { parse_mode: 'HTML' }
    );
  } catch (e: any) {
    // Surface buy errors to user and terminal, and fetch logs if possible
    let errorMsg = `❌ Buy failed: `;
    let logs: string[] | undefined;
    // Debug: Print error type and keys
    console.error('Manual buy error:', e);
    console.error('Manual buy error typeof:', typeof e);
    if (e && typeof e === 'object') {
      console.error('Manual buy error keys:', Object.keys(e));
      console.error('Manual buy error constructor:', e.constructor?.name);
    }
    if (e && typeof e === 'object') {
      if (e.message) errorMsg += `\n<b>Error:</b> <code>${e.message}</code>`;
      // If it's a SendTransactionError and has getLogs, fetch logs
      if (e.name === 'SendTransactionError' && typeof e.getLogs === 'function') {
        try {
          logs = await e.getLogs();
          if (logs) errorMsg += `\n<b>Logs:</b> <pre>${Array.isArray(logs) ? logs.join('\n') : logs}</pre>`;
        } catch (logErr: any) {
          errorMsg += `\n<b>Log fetch error:</b> <code>${logErr && typeof logErr === 'object' && 'message' in logErr ? logErr.message : String(logErr)}</code>`;
        }
      } else if (e.logs) {
        errorMsg += `\n<b>Logs:</b> <pre>${Array.isArray(e.logs) ? e.logs.join('\n') : e.logs}</pre>`;
      }
    } else {
      errorMsg += `\n<b>Error:</b> <code>${e}</code>`;
    }
    if (logs) console.error('Transaction logs:', logs);
    await ctx.reply(errorMsg, { parse_mode: 'HTML' });
  }
});
bot.action('exportkey', async (ctx: any) => {
  const userId = String(ctx.from?.id);
  const user = users[userId];
  if (!user || !user.secret) {
    return await ctx.reply(helpMessages.wallet_needed, walletKeyboard());
  }
  await ctx.reply('⚠️ Your private key (base64):\n' + user.secret, { parse_mode: 'Markdown' });
});

// Back to main menu button handler
// (Removed incorrect code that was outside any function)

// Send main menu
async function sendMainMenu(ctx: any) {
  await ctx.reply(
    helpMessages.main_menu,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🟢 Buy', 'buy'), Markup.button.callback('🔴 Sell', 'sell')],
        [Markup.button.callback('⚙️ Strategy', 'set_strategy'), Markup.button.callback('🍯 Honey Points', 'honey_points')],
        [Markup.button.callback('📊 Activity', 'show_activity'), Markup.button.callback('👛 Wallet', 'my_wallet')],
        [Markup.button.callback('💰 Sell All', 'sell_all_wallet'), Markup.button.callback('📋 Copy Trade', 'copy_trade')],
        [Markup.button.callback('🔗 Invite Friends', 'invite_friends')],
        [Markup.button.callback('🪙 Show Tokens', 'show_tokens')],
        [Markup.button.callback('🔑 Restore Wallet', 'restore_wallet'), Markup.button.callback('🆕 Create Wallet', 'create_wallet')]
      ])
    }
  );
}

// Helper: Format numbers for display
function formatNumber(val: number | string, digits = 2): string {
  if (typeof val === 'number') return val.toLocaleString(undefined, { maximumFractionDigits: digits });
  if (!isNaN(Number(val))) return Number(val).toLocaleString(undefined, { maximumFractionDigits: digits });
  return val ? String(val) : '-';
}

// Helper: Format token info for display (unified fields)
function formatTokenMsg(t: Record<string, any>, i: number): string {
  const address = t.address || t.tokenAddress || t.pairAddress || '-';
  const symbol = t.symbol || t.baseToken?.symbol || '-';
  const name = t.name || t.baseToken?.name || '-';
  const priceUsd = formatNumber(t.priceUsd ?? t.price ?? t.priceNative);
  const marketCap = formatNumber(t.marketCap ?? t.fdv);
  const holders = formatNumber(t.holders);
  // Calculate age in minutes if t.age is a timestamp (ms or s)
  let age = '-';
  if (t.age) {
    let ageMs = t.age;
    if (typeof ageMs === 'string') ageMs = Number(ageMs);
    let ageVal: number | string = '-';
    if (ageMs > 1e12) { // ms timestamp
      ageVal = Math.floor((Date.now() - ageMs) / 60000);
    } else if (ageMs > 1e9) { // s timestamp
      ageVal = Math.floor((Date.now() - ageMs * 1000) / 60000);
    } else if (ageMs < 1e7 && ageMs > 0) { // already in minutes
      ageVal = ageMs;
    }
    age = formatNumber(ageVal);
  }
  const verified = t.verified !== undefined ? t.verified : (t.baseToken?.verified !== undefined ? t.baseToken.verified : '-');
  const volume = formatNumber(t.volume ?? t.volume24h);
  const url = t.url || (t.pairAddress ? `https://dexscreener.com/solana/${t.pairAddress}` : '');
  let msg = `<b>${i+1}. ${name} (${symbol})</b>\n` +
    `Address: <code>${address}</code>\n` +
    `Price (USD): $${priceUsd}\n` +
    `MarketCap: ${marketCap}\n` +
    `Volume (24h): ${volume}\n` +
    `Holders: ${holders}\n` +
    `⏳ Age (minutes): ${age}\n` +
    `Verified: ${verified}`;
  if (url && url !== '-') msg += `\n<a href='${url}'>View on DexScreener</a>`;
  return msg;
}

// Show Tokens button handler (redesigned for clarity, accuracy, and sharing)
bot.action('show_tokens', async (ctx: any) => {
  // --- Ultra-fast auto-buy/sell logic integrated with Show Tokens ---
  await ctx.reply('🔄 Fetching latest tokens and managing auto-trades ...');
  try {
    ctx.session = ctx.session || {};
    const user = getOrRegisterUser(ctx);
    const userId = String(ctx.from?.id);
    // --- 1. Prepare and filter tokens as before ---
    const strategyKey = getStrategyCacheKey(user?.strategy);
    ctx.session.tokenCache = ctx.session.tokenCache || {};
    ctx.session.tokenCache[strategyKey] = ctx.session.tokenCache[strategyKey] || { tokens: [], last: 0 };
    const now = Date.now();
    let tokens: any[] = [];
    if (ctx.session.tokenCache[strategyKey].tokens.length === 0 || now - ctx.session.tokenCache[strategyKey].last > CACHE_TTL) {
      tokens = await fetchUnifiedTokenList();
      console.log('[show_tokens] Tokens fetched:', tokens.length);
      // --- Debug: Print original token object before normalization ---
      console.log('[show_tokens] Raw tokens from API:');
      tokens.forEach((t, i) => {
        console.log(`#${i+1} RAW:`, JSON.stringify(t));
      });

      // --- Fetch full details for each token and merge ---
      const tokensWithDetails = [];
      for (const t of tokens) {
        // استبعاد التوكنات غير التابعة لشبكة Solana أو التي ليس لديها pairAddress
        if ((t.chainId && t.chainId !== 'solana') || !t.pairAddress) continue;
        let merged = { ...t };
        try {
          const addr = t.address || t.tokenAddress || t.pairAddress;
          if (addr) {
            const pairs = await fetchDexScreenerPairs(addr);
            if (pairs && pairs.length > 0) {
              // Merge the first pair's data into your token object
              merged = { ...t, ...pairs[0] };
            }
          }
        } catch (e) {
          // If error, just use t
        }
        tokensWithDetails.push(merged);
      }

      // --- Normalize all tokens for numeric filtering ---
      function normalizeTokenFields(token: any): any {
        // Calculate age in minutes from pairCreatedAt if available, else fallback to token.age
        let ageMinutes = 0;
        const now = Date.now();
        if (token.pairCreatedAt) {
          // pairCreatedAt is usually in ms
          if (typeof token.pairCreatedAt === 'string') {
            const ts = Number(token.pairCreatedAt);
            if (!isNaN(ts)) ageMinutes = Math.floor((now - ts) / 60000);
          } else if (typeof token.pairCreatedAt === 'number') {
            ageMinutes = Math.floor((now - token.pairCreatedAt) / 60000);
          }
        } else if (token.age) {
          // fallback: if age is a timestamp, convert to minutes
          let ageVal = token.age;
          if (typeof ageVal === 'string') ageVal = Number(ageVal);
          if (typeof ageVal === 'number') {
            if (ageVal > 1e12) {
              ageMinutes = Math.floor((now - ageVal) / 60000);
            } else if (ageVal > 1e9) {
              ageMinutes = Math.floor((now - ageVal * 1000) / 60000);
            } else if (ageVal < 1e7 && ageVal > 0) {
              ageMinutes = ageVal;
            }
          }
        }
        const norm = {
          ...token,
          marketCap: Number(token.marketCap ?? token.fdv ?? 0),
          liquidity: Number(token.liquidity?.usd ?? token.liquidity ?? 0),
          volume: Number(token.volume?.h24 ?? token.volume ?? token.volume24h ?? 0),
          holders: Number(token.holders ?? 0),
          age: ageMinutes,
        };
        // Debug: Print normalized token
        console.log(`[show_tokens] NORMALIZED #${token.name || token.symbol || token.address}:`, JSON.stringify(norm));
        return norm;
      }
      tokens = tokensWithDetails.map(normalizeTokenFields);
      // --- Debug: Print all tokens' key fields before filtering ---
      console.log('[show_tokens] Token fields before filtering:');
      tokens.forEach((t, i) => {
        console.log(`#${i+1} ${t.name || t.symbol || t.address}: marketCap=${t.marketCap}, liquidity=${t.liquidity}, volume=${t.volume}, age=${t.age}`);
      });
      if (user && user.strategy) {
        if (user.strategy.minHolders === undefined || user.strategy.minHolders === null) user.strategy.minHolders = 0;
        const before = tokens.length;
        // فلترة مرنة: تجاهل الشرط إذا القيمة 0 أو غير متوفرة
        tokens = tokens.filter(t => {
          // marketCap
          if (user.strategy.minMarketCap && user.strategy.minMarketCap > 0 && t.marketCap > 0 && t.marketCap < user.strategy.minMarketCap) return false;
          // liquidity
          if (user.strategy.minLiquidity && user.strategy.minLiquidity > 0 && t.liquidity > 0 && t.liquidity < user.strategy.minLiquidity) return false;
          // volume
          if (user.strategy.minVolume && user.strategy.minVolume > 0 && t.volume < user.strategy.minVolume) return false;
          // age
          if (user.strategy.minAge && user.strategy.minAge > 0 && t.age > 0 && t.age < user.strategy.minAge) return false;
          // holders
          if (user.strategy.minHolders && user.strategy.minHolders > 0 && t.holders < user.strategy.minHolders) return false;
          return true;
        });
        console.log('[show_tokens] After FLEXIBLE filter:', tokens.length, 'strategy:', user.strategy, 'before:', before);
      }
      ctx.session.tokenCache[strategyKey].tokens = tokens;
      ctx.session.tokenCache[strategyKey].last = now;
    } else {
      tokens = ctx.session.tokenCache[strategyKey].tokens;
    }
    if (!tokens || tokens.length === 0) {
      await ctx.reply('❌ No tokens currently available. Try again later.');
      return;
    }
    if (user && user.blocked) {
      await ctx.reply('❌ You have blocked the bot.');
      return;
    }
    // بعد الفلترة المرنة بالأعلى، لا تعيد الفلترة الصارمة هنا
    let filtered = tokens;
    let strategyLog = '';
    // strategyLog فقط لأغراض السجل أو التصحيح
    if (user && user.strategy) {
      if (user.strategy.minHolders === undefined || user.strategy.minHolders === null) user.strategy.minHolders = 0;
      strategyLog = JSON.stringify(user.strategy);
    }
    // --- 2. Unique tokens logic as before ---
    if (!fs.existsSync(SENT_TOKENS_DIR)) fs.mkdirSync(SENT_TOKENS_DIR);
    const sentHashes = await readSentHashes(userId);
    const uniqueFiltered = filtered.filter(t => {
      const addr = t.address || t.tokenAddress || t.pairAddress;
      if (!addr) return false;
      const h = hashTokenAddress(addr);
      return !sentHashes.has(h);
    });
    if (!uniqueFiltered || uniqueFiltered.length === 0) {
      await ctx.reply('✅ You have seen all new available tokens. Wait for new updates or press refresh later.');
      return;
    }
    // --- 3. Ultra-fast auto-buy/sell logic per user ---
    // --- State for open trades ---
    const gAny = globalThis as any;
    if (!gAny.openTrades) gAny.openTrades = {};
    if (!gAny.openTrades[userId]) gAny.openTrades[userId] = [];
    const openTrades = gAny.openTrades[userId];
    // --- Helper: get SOL balance ---
    async function getSolBalance(pubkey: string) {
      try {
        const { getConnection } = await import('./wallet');
        const conn = getConnection();
        const publicKey = (await import('@solana/web3.js')).PublicKey;
        return await conn.getBalance(new publicKey(pubkey));
      } catch { return 0; }
    }
    // --- Helper: monitor price and execute sell/stop-loss ---
    async function monitorTrade(trade: any, user: any) {
      // This function will poll price every 2s and execute sell/stop-loss as needed
      // unifiedSell متوفر من الأعلى بنمط require
      let active = true;
      while (active) {
        await new Promise(res => setTimeout(res, 2000));
        // Fetch current price (DexScreener direct API)
        let price = 0;
        try {
          const pairs = await fetchDexScreenerPairs(trade.tokenAddress);
          // Pick the first pair with priceUsd
          const token = pairs.find((p: any) => p.priceUsd);
          if (token) price = Number(token.priceUsd || token.priceNative || 0);
        } catch {}
        if (!price || !trade.entryPrice) continue;
        const changePct = ((price - trade.entryPrice) / trade.entryPrice) * 100;
        // --- First profit target ---
        if (!trade.sold1 && changePct >= user.strategy.profitTarget1) {
          try {
            await unifiedSell(trade.tokenAddress, trade.amount * (user.strategy.sellPercent1 / 100), user.secret);
            trade.sold1 = true;
            trade.sold1Price = price;
            await ctx.reply(`✅ Sold ${user.strategy.sellPercent1}% of ${trade.tokenAddress} at +${user.strategy.profitTarget1}% profit.`);
          } catch (e: any) {
            await ctx.reply('❌ Sell 1 failed: ' + (e && typeof e === 'object' && 'message' in e ? (e as any).message : String(e)));
          }
        }
        // --- Second profit target ---
        if (user.strategy.profitTarget2 && !trade.sold2 && changePct >= user.strategy.profitTarget2) {
          try {
            await unifiedSell(trade.tokenAddress, trade.amount * (user.strategy.sellPercent2 / 100), user.secret);
            trade.sold2 = true;
            trade.sold2Price = price;
            await ctx.reply(`✅ Sold ${user.strategy.sellPercent2}% of ${trade.tokenAddress} at +${user.strategy.profitTarget2}% profit.`);
          } catch (e: any) {
            await ctx.reply('❌ Sell 2 failed: ' + (e && typeof e === 'object' && 'message' in e ? (e as any).message : String(e)));
          }
        }
        // --- Stop loss ---
        if (!trade.stopped && changePct <= -Math.abs(user.strategy.stopLossPercent)) {
          try {
            await unifiedSell(trade.tokenAddress, trade.amount - (trade.sold1 ? trade.amount * (user.strategy.sellPercent1 / 100) : 0) - (trade.sold2 ? trade.amount * (user.strategy.sellPercent2 / 100) : 0), user.secret);
            trade.stopped = true;
            trade.stoppedPrice = price;
            await ctx.reply(`🛑 Stop loss triggered for ${trade.tokenAddress} at ${user.strategy.stopLossPercent}% loss.`);
          } catch (e: any) {
            await ctx.reply('❌ Stop loss sell failed: ' + (e && typeof e === 'object' && 'message' in e ? (e as any).message : String(e)));
          }
        }
        // --- End trade if all sold or stopped ---
        if ((trade.sold1 && (!user.strategy.profitTarget2 || trade.sold2)) || trade.stopped) {
          active = false;
          // Remove from open trades
          gAny.openTrades[userId] = gAny.openTrades[userId].filter((t: any) => t !== trade);
          // Immediately try to open next trade if under maxActiveTrades
          if (gAny.openTrades[userId].length < user.strategy.maxActiveTrades) {
            // This will be handled by the main loop below
          }
        }
      }
    }
    // --- 4. Main loop: for each token, try to open a trade if allowed ---
    const page = ctx.session.page || 0;
    const pageSize = 10;
    const start = page * pageSize;
    const sorted = uniqueFiltered.slice(start, start + pageSize);
    let sent = 0;
    for (const t of sorted) {
      const addr = t.address || t.tokenAddress || t.pairAddress;
      // --- Safe access to strategy fields ---
      const strat = user.strategy || {};
      const maxActiveTrades = (typeof strat.maxActiveTrades === 'number' && strat.maxActiveTrades > 0) ? strat.maxActiveTrades : 1;
      const buyAmount = (typeof strat.buyAmount === 'number' && strat.buyAmount > 0) ? strat.buyAmount : 0.01;
      // --- Check if user can open a new trade ---
      if (gAny.openTrades[userId].length >= maxActiveTrades) {
        await ctx.reply('⚠️ Max active trades reached. Waiting for a trade to close before opening new ones.');
        break;
      }
      // --- Check wallet balance ---
      const solBalance = await getSolBalance(user.wallet);
      if (solBalance < (buyAmount * 1e9)) {
        await ctx.reply('❌ Not enough SOL balance to open new trade.');
        break;
      }
      // --- Execute buy instantly ---
      try {
        // unifiedBuy متوفر من الأعلى بنمط require
        const { tx, source } = await unifiedBuy(addr, buyAmount, user.secret);
        // Register trade state
        const entryPrice = Number(t.priceUsd || t.price || 0);
        const trade = {
          tokenAddress: addr,
          amount: buyAmount,
          entryPrice,
          sold1: false,
          sold2: false,
          stopped: false,
          tx,
          source
        };
        gAny.openTrades[userId].push(trade);
        const tokenAddr = addr || '-';
        await ctx.reply(`🚀 Bought ${buyAmount} SOL of ${tokenAddr} at $${entryPrice}. Monitoring for targets...`);
        // Start monitoring this trade
        monitorTrade(trade, user);
      } catch (e: any) {
        // Surface buy errors to user and terminal, and fetch logs if possible
        let errorMsg = `❌ Buy failed: `;
        let logs: string[] | undefined;
        // Debug: Print error type and keys
        console.error('Auto-buy error:', e);
        console.error('Auto-buy error typeof:', typeof e);
        if (e && typeof e === 'object') {
          console.error('Auto-buy error keys:', Object.keys(e));
          console.error('Auto-buy error constructor:', e.constructor?.name);
        }
        if (e && typeof e === 'object') {
          if (e.message) errorMsg += `\n<b>Error:</b> <code>${e.message}</code>`;
          // If it's a SendTransactionError and has getLogs, fetch logs
          if (e.name === 'SendTransactionError' && typeof e.getLogs === 'function') {
            try {
              logs = await e.getLogs();
              if (logs) errorMsg += `\n<b>Logs:</b> <pre>${Array.isArray(logs) ? logs.join('\n') : logs}</pre>`;
            } catch (logErr: any) {
              errorMsg += `\n<b>Log fetch error:</b> <code>${logErr && typeof logErr === 'object' && 'message' in logErr ? logErr.message : String(logErr)}</code>`;
            }
          }
          // Always show transactionLogs if present
          if (e.transactionLogs) {
            errorMsg += `\n<b>Transaction Logs:</b> <pre>${Array.isArray(e.transactionLogs) ? e.transactionLogs.join('\n') : e.transactionLogs}</pre>`;
          }
          // Always show transactionMessage if present
          if (e.transactionMessage) {
            errorMsg += `\n<b>Transaction Message:</b> <code>${e.transactionMessage}</code>`;
          }
          if (e.logs) {
            errorMsg += `\n<b>Logs:</b> <pre>${Array.isArray(e.logs) ? e.logs.join('\n') : e.logs}</pre>`;
          }
        } else {
          errorMsg += `\n<b>Error:</b> <code>${e}</code>`;
        }
        if (logs) console.error('Transaction logs:', logs);
        await ctx.reply(errorMsg, { parse_mode: 'HTML' });
        continue;
      }
      // --- Mark token as sent ---
      if (addr) {
        const h = hashTokenAddress(addr);
        await appendSentHash(userId, h);
      }
      sent++;
    }
    // --- 5. Show tokens as before (for user info) ---
    for (const t of sorted) {
      const addr = t.address || t.tokenAddress || t.pairAddress;
      const { msg, inlineKeyboard } = buildTokenMessage(
        t,
        ctx.botInfo?.username || process.env.BOT_USERNAME || 'YourBotUsername',
        t.pairAddress || t.address || t.tokenAddress || ''
      );
      if (!msg || typeof msg !== 'string' || msg.includes('بيانات العملة غير متوفرة') || msg.includes('غير مكتملة')) continue;
      try {
        await ctx.reply(msg, {
          parse_mode: 'HTML',
          disable_web_page_preview: false,
          reply_markup: { inline_keyboard: inlineKeyboard }
        });
      } catch (err) {
        // Detect if user blocked the bot
        if ((err as any)?.description?.includes('bot was blocked by the user')) {
          if (user) {
            user.blocked = true;
            saveUsers(users);
            console.warn(`[show_tokens] User ${userId} blocked the bot. Skipping.`);
          }
          break;
        }
        console.warn(`[show_tokens] Failed to send token to user ${userId}:`, err);
      }
    }
    // Navigation buttons: more/refresh
    const hasMore = uniqueFiltered.length > start + pageSize;
    const navButtons = [];
    if (hasMore) navButtons.push({ text: '➡️ More', callback_data: 'show_tokens_more' });
    navButtons.push({ text: '🔄 Refresh', callback_data: 'show_tokens' });
    if (sent === 0) {
      await ctx.reply('❌ No tokens available to display.');
    } else {
      await ctx.reply('Choose an action:', {
        reply_markup: { inline_keyboard: [navButtons] }
      });
    }
    if (ctx.session._resetPage) {
      ctx.session.page = 0;
      ctx.session._resetPage = false;
    }
  } catch (e) {
    console.error('Error in show_tokens:', e);
    await ctx.reply('❌ An error occurred while fetching tokens. Please try again later.');
  }
});

// زر المزيد (pagination)
bot.action('show_tokens_more', async (ctx: any) => {
  ctx.session = ctx.session || {};
  ctx.session.page = (ctx.session.page || 0) + 1;
  await ctx.answerCbQuery();
  try {
    await ctx.deleteMessage();
  } catch {}
  // Call the show_tokens handler directly to show the next page
  await bot.handleUpdate({
    ...ctx.update,
    callback_query: { ...ctx.callbackQuery, data: 'show_tokens' }
  }, ctx);
});

// Refresh button handler: resets pagination
bot.action('show_tokens', async (ctx: any, next: any) => {
  ctx.session = ctx.session || {};
  ctx.session._resetPage = true;
  if (typeof next === 'function') await next();
});

// ====== User, wallet, and menu helper functions ======


// Start the Telegram bot if this file is run directly
if (require.main === module) {
  bot.launch()
    .then(() => console.log('✅ Telegram bot started and listening for users!'))
    .catch((err: any) => console.error('❌ Bot launch failed:', err));
}
// Dynamic strategy input (step-by-step)
