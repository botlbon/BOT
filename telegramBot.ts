import fs from 'fs';
import { Markup, Telegraf } from 'telegraf';
import type { Context } from 'telegraf';
import type { Strategy } from './bot/types';
import { getErrorMessage, limitHistory, hasWallet, walletKeyboard } from './bot/helpers';
import { filterTokensByStrategy } from './bot/strategy';
import dotenv from 'dotenv';
dotenv.config();
import { loadKeypair, getConnection } from './wallet';
import { parseSolanaPrivateKey, toBase64Key } from './keyFormat';
import { unifiedBuy, unifiedSell } from './tradeSources';
import { helpMessages } from './helpMessages';
import { loadUsers, saveUsers } from './bot/helpers';
import { monitorCopiedWallets } from './utils/portfolioCopyMonitor';

// Telegram bot
export const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
console.log('🚀 Telegram bot script loaded.');

// Telegram bot core variables
let users: Record<string, any> = loadUsers();
let awaitingUsers: Record<string, any> = {};

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

// Track tokens bought automatically per user to avoid duplicates
let boughtTokens: Record<string, Set<string>> = {};

// Define fetchUnifiedTokenList at top level
async function fetchUnifiedTokenList() {
  // ...existing code for fetching tokens...
  // This should be the same logic as previously implemented
  // If you need the full code, copy from previous implementation
  return []; // Placeholder, replace with actual logic
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

// Restore Wallet button handler
bot.action('restore_wallet', async (ctx: any) => {
  const userId = String(ctx.from?.id);
  awaitingUsers[userId] = 'await_restore_secret';
  await ctx.reply(
    '🔑 To restore your wallet, please send your Solana private key in one of the following formats:\n\n1. Base58 (most common, 44-88 characters, letters & numbers)\n2. Base64 (88 characters)\n3. JSON Array (64 numbers)\n\nExample (Base58):\n4f3k2...\nExample (Base64):\nM3J5dG...Z2F0ZQ==\nExample (JSON Array):\n[12,34,...]\n\n⚠️ Never share your private key with anyone!\nYou can press Cancel to exit.',
    {...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'cancel_restore_wallet')]])}
  );
});

// Create Wallet button handler
bot.action('create_wallet', async (ctx: any) => {
  const userId = String(ctx.from?.id);
  // Generate new wallet using generateKeypair utility
  const { generateKeypair } = await import('./wallet');
  const keypair = generateKeypair();
  users[userId] = users[userId] || { trades: 0, activeTrades: 1, history: [] };
  users[userId].wallet = keypair.publicKey.toBase58();
  users[userId].secret = Buffer.from(keypair.secretKey).toString('base64');
  users[userId].history = users[userId].history || [];
  users[userId].history.push('Created new wallet');
  saveUsers(users);
  await ctx.reply('✅ New wallet created! Your address: ' + users[userId].wallet);
  await sendMainMenu(ctx);
});

// Export Private Key button handler

// === Add generic handlers for all main menu buttons that have no logic yet ===
const unimplementedActions = [
  'set_strategy',
  'honey_points',
  'buy',
  'sell',
  'sell_all_wallet',
  'invite_friends',
  'copy_trade',
  'my_wallet'
];
for (const action of unimplementedActions) {
  bot.action(action, async (ctx: any) => {
    await ctx.answerCbQuery(); // Close Telegram loading animation
    await ctx.reply('🚧 هذا الزر قيد التطوير أو لم يتم تفعيله بعد.');
  });
}
bot.action('exportkey', async (ctx: any) => {
  const userId = String(ctx.from?.id);
  const user = users[userId];
  if (!user || !user.secret) {
    return await ctx.reply(helpMessages.wallet_needed, walletKeyboard());
  }
  await ctx.reply('⚠️ Your private key (base64):\n' + user.secret, { parse_mode: 'Markdown' });
});

// Back to main menu button handler
bot.action('back_to_menu', async (ctx: any) => {
  await sendMainMenu(ctx);
});

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
function formatNumber(val: any, digits = 2) {
  if (typeof val === 'number') return val.toLocaleString(undefined, { maximumFractionDigits: digits });
  if (!isNaN(Number(val))) return Number(val).toLocaleString(undefined, { maximumFractionDigits: digits });
  return val ?? '-';
}

// Helper: Format token info for display (unified fields)
function formatTokenMsg(t: any, i: number) {
  const address = t.address || t.tokenAddress || t.pairAddress || '-';
  const symbol = t.symbol || t.baseToken?.symbol || '-';
  const name = t.name || t.baseToken?.name || '-';
  const priceUsd = formatNumber(t.priceUsd ?? t.price ?? t.priceNative);
  const marketCap = formatNumber(t.marketCap ?? t.fdv);
  const holders = formatNumber(t.holders);
  const age = formatNumber(t.age);
  const verified = t.verified !== undefined ? t.verified : (t.baseToken?.verified !== undefined ? t.baseToken.verified : '-');
  const volume = formatNumber(t.volume ?? t.volume24h);
  const url = t.url || (t.pairAddress ? `https://dexscreener.com/solana/${t.pairAddress}` : '');
  let msg = `<b>${i+1}. ${name} (${symbol})</b>\n` +
    `Address: <code>${address}</code>\n` +
    `Price (USD): $${priceUsd}\n` +
    `MarketCap: ${marketCap}\n` +
    `Volume (24h): ${volume}\n` +
    `Holders: ${holders}\n` +
    `Age (min): ${age}\n` +
    `Verified: ${verified}`;
  if (url && url !== '-') msg += `\n<a href='${url}'>View on DexScreener</a>`;
  return msg;
}

// Show Tokens button handler
bot.action('show_tokens', async (ctx: any) => {
  await ctx.reply('🔄 Fetching latest tokens ...');
  try {
    let tokens = await getCachedTokenList();
    if (!tokens || tokens.length === 0) {
      await ctx.reply('No tokens found from the available sources. Please try again later.');
      return;
    }
    // Show only the first 10 tokens
    const sorted = tokens.slice(0, 10);
    for (const [i, t] of sorted.entries()) {
      let msg = formatTokenMsg(t, i);
      await ctx.reply(msg, { parse_mode: 'HTML', disable_web_page_preview: true });
    }
    await ctx.reply('Use the buttons below to refresh or interact.', {
      reply_markup: { inline_keyboard: [[Markup.button.callback('Refresh', 'show_tokens')]] }
    });
  } catch (e) {
    console.error('Error in show_tokens:', e);
    await ctx.reply('Error fetching tokens. Please try again later.');
  }
});

// ====== User, wallet, and menu helper functions ======
// ...existing code...


// ========== User Registration and Wallet Setup ==========
// Single event handler for all text cases
bot.on('text', async (ctx: any) => {
  const userId = String(ctx.from?.id);
  const text = ctx.message.text.trim();
  if (text === '/start') {
    await sendMainMenu(ctx);
    return;
  }
  if (!users[userId]) users[userId] = { trades: 0, activeTrades: 1, history: [] };
  const user = users[userId];
  user.lastMessageAt = Date.now();
  limitHistory(user);
  console.log(`📝 Received text from ${userId}: ${text}`);

  // Restore wallet secret
  if (awaitingUsers[userId] === 'await_restore_secret') {
    try {
      let secretKey: number[] | null = null;
      if (text.length >= 44 && text.length <= 88) {
        const decoded = Buffer.from(text, text.includes('=') ? 'base64' : 'utf8');
        if (decoded.length === 32) secretKey = Array.from(decoded);
      } else if (text.startsWith('[') && text.endsWith(']')) {
        secretKey = JSON.parse(text);
      }
      if (secretKey) {
        const keypair = loadKeypair(secretKey);
        users[userId].wallet = keypair.publicKey.toBase58();
        users[userId].secret = Buffer.from(keypair.secretKey).toString('base64');
        users[userId].history = users[userId].history || [];
        users[userId].history.push('Restored wallet');
        saveUsers(users);
        await ctx.reply('✅ Wallet restored! Your address: ' + users[userId].wallet);
        await sendMainMenu(ctx);
      } else {
        await ctx.reply('Invalid secret key format. Please send your private key in Base58, Base64, or JSON Array format.');
      }
    } catch (e) {
      console.error('❌ Error restoring wallet:', e);
      await ctx.reply('Error restoring wallet: ' + getErrorMessage(e));
    }
    return;
  }

  // Dynamic strategy input (step-by-step)

// Start the Telegram bot if this file is run directly
if (require.main === module) {
  bot.launch()
    .then(() => console.log('✅ Telegram bot started and listening for users!'))
    .catch((err: any) => console.error('❌ Bot launch failed:', err));
}
  if (awaitingUsers[userId] && typeof awaitingUsers[userId] === 'object' && 'step' in awaitingUsers[userId]) {
    // Unified with DEXSCREENER fields
    const strategyFields = [
      { key: 'minVolume', label: 'Min Volume (USD)', type: 'number', default: 1000 },
      { key: 'minHolders', label: 'Min Holders', type: 'number', default: 50 },
      { key: 'minAge', label: 'Min Age (minutes)', type: 'number', default: 10 },
      { key: 'minMarketCap', label: 'Min MarketCap (USD)', type: 'number', default: 50000 },
      { key: 'maxAge', label: 'Max Age (minutes)', type: 'number', default: 60 },
      { key: 'onlyVerified', label: 'Verified only', type: 'select', options: ['true', 'false'], default: 'true' },
      { key: 'fastListing', label: 'Fast listing', type: 'select', options: ['true', 'false'], default: 'true' }
    ];
    let step = Number(awaitingUsers[userId]?.step ?? 0);
    let temp = typeof awaitingUsers[userId]?.temp === 'object' && awaitingUsers[userId].temp ? awaitingUsers[userId].temp : {};

    // تحقق من صحة الخطوة الحالية
    if (step < 0 || step >= strategyFields.length) {
      delete awaitingUsers[userId];
      await ctx.reply('❌ Strategy setup error. Please start again.');
      return;
    }

    const currentField = strategyFields[step];
    if (currentField.type === 'number') {
      const val = parseFloat(text);
      if (isNaN(val) || val < 0) {
        await ctx.reply(`❌ Please enter a valid positive number for ${currentField.label} (default: ${currentField.default}).`);
        return;
      }
      temp[currentField.key] = val;
    } else if (currentField.type === 'select') {
      // لا يتم التعامل مع select هنا بل عبر الأزرار
    }

    step++;
    if (step < strategyFields.length) {
      awaitingUsers[userId] = { step, temp };
      const nextField = strategyFields[step];
      if (nextField.type === 'number') {
        await ctx.reply(`Enter value for <b>${nextField.label}</b> (default: ${nextField.default}):`, { parse_mode: 'HTML' });
      } else if (nextField.type === 'select') {
        const options = Array.isArray(nextField.options) ? nextField.options : ['true', 'false'];
        await ctx.reply(`Choose value for <b>${nextField.label}</b>:`, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: options.map(opt => [Markup.button.callback(opt, `strategy_${nextField.key}_${opt}`)]) }
        });
      }
      return;
    }

    // جميع القيم جاهزة، حفظ الاستراتيجية
    user.strategy = {
      minVolume: temp.minVolume ?? 1000,
      minHolders: temp.minHolders ?? 50,
      minAge: temp.minAge ?? 10,
      minMarketCap: temp.minMarketCap ?? 50000,
      maxAge: temp.maxAge ?? 60,
      onlyVerified: temp.onlyVerified === 'true',
      fastListing: temp.fastListing === 'true',
      enabled: true
    } as Strategy;
    user.history = user.history || [];
    user.history.push(`Saved strategy: ${JSON.stringify(user.strategy)}`);
    saveUsers(users);
    delete awaitingUsers[userId];
    // Show summary of the saved strategy
    let summary = `<b>Strategy saved!</b>\nHere are your settings:`;
    for (const f of strategyFields) {
      summary += `\n- <b>${f.label}:</b> ${user.strategy[f.key]}`;
    }
    await ctx.reply(summary, { parse_mode: 'HTML' });
    await ctx.reply('Fetching tokens matching your strategy ...');
    try {
      let tokens = await getCachedTokenList();
      if (!tokens || tokens.length === 0) {
        await ctx.reply('No tokens found from the available sources. Try again later.');
        return;
      }
      const filtered = filterTokensByStrategy(tokens, user.strategy);
      const sorted = filtered.slice(0, 10);
      user.lastTokenList = sorted;
      user.history = user.history || [];
      user.history.push('Viewed tokens matching strategy');
      saveUsers(users);
      if (sorted.length === 0) {
        await ctx.reply('❌ No tokens match your strategy at the moment.');
      } else {
        for (const [i, t] of sorted.entries()) {
          let msg = formatTokenMsg(t, i);
          await ctx.reply(msg, { parse_mode: 'HTML', disable_web_page_preview: true });
        }
        await ctx.reply('Use the button below to refresh the results.', {
          reply_markup: { inline_keyboard: [[Markup.button.callback('Refresh', 'refresh_tokens')]] }
        });
      }
    } catch (e) {
      await ctx.reply('Error fetching tokens: ' + getErrorMessage(e));
    }
    return;
  }
  // ... باقي منطق الحالات (buy, sell, honey points) ...
});
// Start the Telegram bot if this file is run directly
if (require.main === module) {
  bot.launch()
    .then(() => console.log('✅ Telegram bot started and listening for users!'))
    .catch((err: any) => console.error('❌ Bot launch failed:', err));
}
  // Dynamic strategy input (step-by-step)
