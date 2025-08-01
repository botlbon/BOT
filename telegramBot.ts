// --- Sent Tokens Rotating File System ---

import crypto from 'crypto';
import path from 'path';

import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import { STRATEGY_FIELDS, buildTokenMessage } from './utils/tokenUtils';
import { Markup, Telegraf } from 'telegraf';
import type { Context } from 'telegraf';
import type { Strategy } from './bot/types';
import { getErrorMessage, limitHistory, hasWallet, walletKeyboard, loadUsers, saveUsers } from './bot/helpers';
import { filterTokensByStrategy } from './bot/strategy';
import { loadKeypair, getConnection } from './wallet';
import { parseSolanaPrivateKey, toBase64Key } from './keyFormat';
import { unifiedBuy, unifiedSell } from './tradeSources';
import { helpMessages } from './helpMessages';
import { monitorCopiedWallets } from './utils/portfolioCopyMonitor';

console.log('Loaded TELEGRAM_BOT_TOKEN:', process.env.TELEGRAM_BOT_TOKEN);

export const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
console.log('🚀 Telegram bot script loaded.');

// أمر للمطور: عرض جميع الحقول التي ستظهر في معالج الاستراتيجية
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
// ...existing code...

type StrategyWizardState = { step: number, data: any, isConfirm?: boolean };
let strategyWizard: Record<string, StrategyWizardState> = {};


// زر إلغاء المعالج
bot.action('cancel_strategy', async (ctx: any) => {
  const userId = String(ctx.from?.id);
  delete strategyWizard[userId];
  await ctx.answerCbQuery('Strategy setup cancelled.');
  await ctx.reply('❌ Strategy setup cancelled.');
  await sendMainMenu(ctx);
});

// بدء معالج الاستراتيجية
bot.action('set_strategy', async (ctx: any) => {
  const userId = String(ctx.from?.id);
  // جلب الحقول الديناميكية ودمجها قبل الثابتة

  strategyWizard[userId] = { step: 0, data: { ...((users[userId] && users[userId].strategy) || {}) } };
  await ctx.answerCbQuery();
  await askStrategyField(ctx, userId);
});

bot.on('text', async (ctx: any, next: any) => {
  const userId = String(ctx.from?.id);
  if (!strategyWizard[userId]) return next();
  const wizard = strategyWizard[userId];
  // دعم الإلغاء بالنص
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
    // قبل الحفظ، أرسل ملخص الاستراتيجية واطلب التأكيد
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

// ملخص الاستراتيجية
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

// تأكيد الاستراتيجية
bot.action('confirm_strategy', async (ctx: any) => {
  const userId = String(ctx.from?.id);
  const wizard = strategyWizard[userId];
  if (!wizard || !wizard.isConfirm) {
    try {
      await ctx.answerCbQuery('No strategy to confirm.');
    } catch (e) {
      console.warn('answerCbQuery failed (possibly expired):', e);
    }
    return;
  }
  // Ensure user is registered before setting strategy
  const user = getOrRegisterUser(ctx);
  user.strategy = wizard.data;
  saveUsers(users);
  delete strategyWizard[userId];
  try {
    await ctx.answerCbQuery('Strategy saved!');
  } catch (e) {
    console.warn('answerCbQuery failed (possibly expired):', e);
  }
  await ctx.reply('✅ Your strategy has been updated and saved!');
  await sendMainMenu(ctx);
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
  if (user.wallet) {
    await ctx.reply(`👛 Your wallet address:\n<code>${user.wallet}</code>`, { parse_mode: 'HTML' });
  } else {
    await ctx.reply('You do not have a wallet yet. Use the "Create Wallet" button to generate one.');
  }
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





// Telegram bot core variables
let users: Record<string, any> = loadUsers();

// --- Sent Tokens Rotating File System ---
const SENT_TOKENS_DIR = path.join(__dirname, 'sent_tokens');
const MAX_FILE_COUNT = 3;
const MAX_HASHES_PER_FILE = 2000;
const ROTATE_CLEAN_THRESHOLD = Math.floor(MAX_HASHES_PER_FILE * 1.5);

// Ensure sent_tokens directory exists at startup
try {
  if (!fs.existsSync(SENT_TOKENS_DIR)) fs.mkdirSync(SENT_TOKENS_DIR);
} catch (e) {
  console.error('❌ Failed to create sent_tokens directory:', e);
}

function getUserSentFiles(userId: string) {
  return Array.from({ length: MAX_FILE_COUNT }, (_, i) => path.join(SENT_TOKENS_DIR, `${userId}_${i+1}.json`));
}


export function hashTokenAddress(addr: string): string {
  // توحيد العنوان: lowercase + trim
  return crypto.createHash('sha256').update(addr.trim().toLowerCase()).digest('hex');
}

export function readSentHashes(userId: string): Set<string> {
  const files = getUserSentFiles(userId);
  let hashes: string[] = [];
  for (const file of files) {
    try {
      if (fs.existsSync(file)) {
        const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (Array.isArray(arr)) hashes = hashes.concat(arr);
        console.log(`[sent_tokens] Read ${arr.length} hashes from ${file}`);
      }
    } catch (e) {
      console.warn(`[sent_tokens] Failed to read ${file}:`, e);
    }
  }
  return new Set(hashes);
}

export function appendSentHash(userId: string, hash: string) {
  const files = getUserSentFiles(userId);
  let fileIdx = 0;
  for (let i = 0; i < files.length; i++) {
    try {
      let arr: string[] = [];
      if (fs.existsSync(files[i])) {
        arr = JSON.parse(fs.readFileSync(files[i], 'utf8'));
        if (arr.includes(hash)) {
          console.log(`[sent_tokens] Hash already exists in ${files[i]}`);
          return;
        }
      }
      if (arr.length < MAX_HASHES_PER_FILE) {
        arr.push(hash);
        fs.writeFileSync(files[i], JSON.stringify(arr));
        console.log(`[sent_tokens] Appended hash to ${files[i]} (${arr.length})`);
        return;
      }
    } catch (e) {
      console.warn(`[sent_tokens] Failed to write ${files[i]}:`, e);
    }
    fileIdx = i;
  }
  // If all full, rotate: overwrite the oldest
  let arr: string[] = [hash];
  fs.writeFileSync(files[fileIdx], JSON.stringify(arr));
  console.log(`[sent_tokens] Rotated and started new ${files[fileIdx]}`);
}

function rotateAndCleanIfNeeded(userId: string) {
  const files = getUserSentFiles(userId);
  let total = 0;
  let arrs: string[][] = [];
  for (const file of files) {
    let arr: string[] = [];
    try {
      if (fs.existsSync(file)) arr = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {}
    arrs.push(arr);
    total += arr.length;
  }
  if (arrs[2] && arrs[2].length >= Math.floor(MAX_HASHES_PER_FILE/2)) {
    for (let i = 0; i < 2; i++) {
      try { fs.unlinkSync(files[i]); console.log(`[sent_tokens] Cleaned ${files[i]}`); } catch (e) { console.warn(`[sent_tokens] Failed to clean ${files[i]}:`, e); }
    }
  }
}



// Register strategy handlers and token notifications from wsListener (after users is defined)

import { registerWsNotifications } from './wsListener';

// Register token notification logic (DexScreener or WebSocket)
registerWsNotifications(bot, users);


// Global Token Cache for Sniper Speed
let globalTokenCache: any[] = [];
let lastCacheUpdate = 0;
const CACHE_TTL = 60 * 1000; // 1 minute

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


// Multi-source token fetch: CoinGecko (main), Jupiter (secondary), DexScreener (fallback)
async function fetchUnifiedTokenList(): Promise<any[]> {
  const { fetchDexScreenerTokens } = await import('./utils/tokenUtils');
  let allTokens: any[] = [];
  try {
    // CoinGecko
    const cgTokens = await fetchDexScreenerTokens();
    if (Array.isArray(cgTokens)) allTokens = allTokens.concat(cgTokens);
  } catch (e) {
    console.error('CoinGecko fetch error:', e);
  }
  // Jupiter
  try {
    const jupRes = await fetch('https://quote-api.jup.ag/v6/tokens');
    if (jupRes.ok) {
      const jupData = await jupRes.json();
      if (Array.isArray(jupData.tokens)) {
        allTokens = allTokens.concat(jupData.tokens.map((t: any) => ({
          name: t.name,
          symbol: t.symbol,
          address: t.address,
          priceUsd: t.price,
          imageUrl: t.logoURI,
          verified: t.tags?.includes('verified'),
          description: t.extensions?.description,
          links: [
            ...(t.extensions?.website ? [{ label: 'Website', url: t.extensions.website, type: 'website' }] : []),
            ...(t.extensions?.twitter ? [{ label: 'Twitter', url: t.extensions.twitter, type: 'twitter' }] : []),
            ...(t.extensions?.discord ? [{ label: 'Discord', url: t.extensions.discord, type: 'discord' }] : []),
          ],
        })));
      }
    }
  } catch (e) {
    console.error('Jupiter fetch error:', e);
  }
  // DexScreener fallback (if needed)
  // ...existing DexScreener logic can be added here if desired...
  // Deduplicate by address
  const seen = new Set();
  const deduped = allTokens.filter(t => {
    const addr = t.address || t.tokenAddress || t.pairAddress;
    if (!addr || seen.has(addr)) return false;
    seen.add(addr);
    return true;
  });
  return deduped;
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

// === Auto Strategy Monitor ===
async function autoStrategyMonitor() {
  for (const userId in users) {
    const user = users[userId];
    if (!user?.strategy || !user.strategy.enabled || !user.secret) continue;
    let tokens: any[] = [];
    try {
      tokens = await getCachedTokenList();
    } catch {}
    if (!tokens || tokens.length === 0) continue;
    const strat = user.strategy;
    const filtered = filterTokensByStrategy(tokens, strat);
    boughtTokens[userId] = boughtTokens[userId] || new Set();
    for (const t of filtered) {
      if (!t.address) continue;
      if (boughtTokens[userId].has(t.address)) continue;
      // Prepare buyAmount, profitTargets, sellPercents, stopLossPercent from user settings
      const buyAmount = user.strategy.buyAmount ?? 0.01;
      const profitTargets = user.strategy.profitTargets ?? [20, 50];
      const sellPercents = user.strategy.sellPercents ?? [50, 50];
      const stopLossPercent = user.strategy.stopLossPercent ?? 15;
      try {
        const { tx, source } = await unifiedBuy(t.address, buyAmount, user.secret);
        boughtTokens[userId].add(t.address);
        user.history = user.history || [];
        user.history.push(`AutoBuy: ${t.address} | Amount: ${buyAmount} SOL | Source: ${source} | Tx: ${tx}`);
        saveUsers(users);
        await bot.telegram.sendMessage(userId,
          `🤖 <b>Auto-buy executed by strategy!</b>\n\n` +
          `<b>Token:</b> <code>${t.address}</code>\n` +
          `<b>Amount:</b> ${buyAmount} SOL\n` +
          `<b>Profit Targets:</b> ${profitTargets.join(', ')}%\n` +
          `<b>Sell Percents:</b> ${sellPercents.join(', ')}%\n` +
          `<b>Stop Loss:</b> ${stopLossPercent}%\n` +
          `<b>Source:</b> ${source}\n` +
          `<b>Transaction:</b> <a href='https://solscan.io/tx/${tx}'>${tx}</a>`,
          { parse_mode: 'HTML' }
        );
      } catch (e: any) {
        // Optionally notify user of error
        // await bot.telegram.sendMessage(userId, `❌ Auto-buy failed: ${e?.message || e}`);
      }
    }
  }
  }

// Run auto strategy monitor every 5 seconds (for faster response in testing)
setInterval(autoStrategyMonitor, 5000);

// Restore Wallet button handler is now registered in wsListener


// Create Wallet button handler
bot.action('create_wallet', async (ctx: any) => {
  const user = getOrRegisterUser(ctx);
  // Generate new wallet using generateKeypair utility
  const { generateKeypair } = await import('./wallet');
  const keypair = generateKeypair();
  user.wallet = keypair.publicKey.toBase58();
  user.secret = Buffer.from(keypair.secretKey).toString('base64');
  user.history = user.history || [];
  user.history.push('Created new wallet');
  saveUsers(users);
  await ctx.reply('✅ New wallet created! Your address: ' + user.wallet);
  await sendMainMenu(ctx);
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

// تنفيذ الشراء عند اختيار توكن
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
    await ctx.reply('❌ Buy failed: ' + getErrorMessage(e));
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
// (تم حذف الكود الخاطئ الذي كان خارج أي دالة)

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
  await ctx.reply('🔄 جاري جلب أحدث التوكنات ...');
  try {
    // كاش مخصص لكل مستخدم (تحسين الأداء)
    const userId = String(ctx.from?.id);
    ctx.session = ctx.session || {};
    if (!ctx.session.tokenCache) ctx.session.tokenCache = { tokens: [], last: 0 };
    const now = Date.now();
    let tokens: any[] = [];
    if (ctx.session.tokenCache.tokens.length === 0 || now - ctx.session.tokenCache.last > CACHE_TTL) {
      tokens = await getCachedTokenList();
      ctx.session.tokenCache.tokens = tokens;
      ctx.session.tokenCache.last = now;
    } else {
      tokens = ctx.session.tokenCache.tokens;
    }
    if (!tokens || tokens.length === 0) {
      await ctx.reply('❌ لم يتم العثور على توكنات متاحة حاليًا. حاول لاحقًا.');
      return;
    }
    // Ignore blocked users
    const user = users[userId];
    if (user && user.blocked) {
      await ctx.reply('❌ You have blocked the bot.');
      return;
    }
    let filtered = tokens;
    let strategyLog = '';
    if (user && user.strategy) {
      if (user.strategy.minHolders === undefined || user.strategy.minHolders === null) {
        user.strategy.minHolders = 0;
      }
      filtered = filterTokensByStrategy(tokens, user.strategy);
      strategyLog = JSON.stringify(user.strategy);
    }
    // لوج: عناوين العملات بعد الفلترة
    const filteredAddresses = filtered.map(t => (t.address || t.tokenAddress || t.pairAddress || '').trim().toLowerCase());
    console.log(`[show_tokens] User ${userId} | strategy: ${strategyLog} | tokens: ${tokens.length}, filtered: ${filtered.length}`);
    console.log(`[show_tokens] User ${userId} | filtered addresses:`, filteredAddresses);
    if (!filtered || filtered.length === 0) {
      await ctx.reply('❌ لا توجد توكنات تطابق استراتيجيتك. جرب تعديل الفلاتر.');
      return;
    }
    if (!fs.existsSync(SENT_TOKENS_DIR)) fs.mkdirSync(SENT_TOKENS_DIR);
    const sentHashes = readSentHashes(userId);
    // لوج: محتوى sentHashes
    console.log(`[show_tokens] User ${userId} | sentHashes:`, Array.from(sentHashes));
    const uniqueFiltered = filtered.filter(t => {
      const addr = t.address || t.tokenAddress || t.pairAddress;
      if (!addr) return false;
      const h = hashTokenAddress(addr);
      return !sentHashes.has(h);
    });
    // لوج: عناوين العملات الفريدة بعد sent_tokens
    const uniqueAddresses = uniqueFiltered.map(t => (t.address || t.tokenAddress || t.pairAddress || '').trim().toLowerCase());
    console.log(`[show_tokens] User ${userId} | unique tokens after sent_tokens: ${uniqueFiltered.length}`);
    console.log(`[show_tokens] User ${userId} | unique addresses:`, uniqueAddresses);
    if (!uniqueFiltered || uniqueFiltered.length === 0) {
      await ctx.reply('✅ لقد شاهدت كل التوكنات الجديدة المتاحة حاليًا. انتظر تحديثات جديدة أو اضغط تحديث لاحقًا.');
      return;
    }

// أمر إداري: تدوير ملفات sent_tokens يدويًا (حذف أقدم ملف فقط)
// للاستخدام من المطور فقط (مثلاً عبر معرف المستخدم)
const ADMIN_IDS = [process.env.ADMIN_ID || '123456789']; // ضع معرف المطور هنا أو في المتغيرات البيئية
bot.command('rotate_sent_tokens', async (ctx: any) => {
  const userId = String(ctx.from?.id);
  if (!ADMIN_IDS.includes(userId)) {
    await ctx.reply('❌ هذا الأمر مخصص للمطور فقط.');
    return;
  }
  const targetId = ctx.message.text.split(' ')[1] || userId;
  const files = getUserSentFiles(targetId);
  if (fs.existsSync(files[0])) {
    try {
      fs.unlinkSync(files[0]);
      await ctx.reply(`✅ تم حذف أقدم ملف sent_tokens (${path.basename(files[0])}) للمستخدم ${targetId}.`);
    } catch (e) {
      await ctx.reply(`❌ فشل حذف الملف: ${e}`);
    }
  } else {
    await ctx.reply('لا يوجد ملف sent_tokens أقدم للحذف.');
  }
});
    // Show up to 10 tokens per page, with "more" button
    const page = ctx.session.page || 0;
    const pageSize = 10;
    const start = page * pageSize;
    const sorted = uniqueFiltered.slice(start, start + pageSize);
    let sent = 0;
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
        if (addr) {
          const h = hashTokenAddress(addr);
          appendSentHash(userId, h);
          rotateAndCleanIfNeeded(userId);
          console.log(`[show_tokens] User ${userId} sent token: ${addr} (hash: ${h})`);
        }
        sent++;
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
        // Don't append hash if sending failed
      }
    }
    // Navigation buttons: more/refresh
    const hasMore = uniqueFiltered.length > start + pageSize;
    const navButtons = [];
    if (hasMore) navButtons.push({ text: '➡️ المزيد', callback_data: 'show_tokens_more' });
    navButtons.push({ text: '🔄 تحديث', callback_data: 'show_tokens' });
    if (sent === 0) {
      await ctx.reply('❌ لا توجد توكنات متاحة للعرض.');
    } else {
      await ctx.reply('اختر إجراء:', {
        reply_markup: { inline_keyboard: [navButtons] }
      });
    }
    // Only reset page if user pressed refresh
    if (ctx.session._resetPage) {
      ctx.session.page = 0;
      ctx.session._resetPage = false;
    }
  } catch (e) {
    console.error('Error in show_tokens:', e);
    await ctx.reply('❌ حدث خطأ أثناء جلب التوكنات. حاول لاحقًا.');
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
// ...existing code...


// Start the Telegram bot if this file is run directly
if (require.main === module) {
  bot.launch()
    .then(() => console.log('✅ Telegram bot started and listening for users!'))
    .catch((err: any) => console.error('❌ Bot launch failed:', err));
}
// Dynamic strategy input (step-by-step)
