import fs from 'fs';
import { Markup, Telegraf } from 'telegraf';
import type { Context } from 'telegraf';
import type { Strategy } from './bot/types';
import { getErrorMessage, limitHistory, hasWallet, walletKeyboard, loadUsers, saveUsers } from './bot/helpers';
import { filterTokensByStrategy } from './bot/strategy';
import dotenv from 'dotenv';

dotenv.config();


import { loadKeypair, getConnection } from './wallet';
import { parseSolanaPrivateKey, toBase64Key } from './keyFormat';
import { unifiedBuy, unifiedSell } from './tradeSources';
import { helpMessages } from './helpMessages';
import { monitorCopiedWallets } from './utils/portfolioCopyMonitor';

dotenv.config();



export const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
console.log('🚀 Telegram bot script loaded.');

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
const STRATEGY_FIELDS = [
  { key: 'minVolume', label: 'Minimum Volume (USD)', type: 'number', optional: true },
  { key: 'minHolders', label: 'Minimum Holders', type: 'number', optional: true },
  { key: 'minAge', label: 'Minimum Age (minutes)', type: 'number', optional: true },
  { key: 'minMarketCap', label: 'Minimum MarketCap (USD)', type: 'number', optional: true },
  { key: 'maxAge', label: 'Maximum Age (minutes)', type: 'number', optional: true },
  { key: 'onlyVerified', label: 'Only Verified Tokens?', type: 'boolean', optional: true },
  { key: 'fastListing', label: 'Fast Listing Only?', type: 'boolean', optional: true },
  { key: 'enabled', label: 'Enable Strategy?', type: 'boolean', optional: false },
];

let strategyWizard: Record<string, { step: number, data: any }> = {};

bot.action('set_strategy', async (ctx: any) => {
  const userId = String(ctx.from?.id);
  strategyWizard[userId] = { step: 0, data: { ...((users[userId] && users[userId].strategy) || {}) } };
  await ctx.answerCbQuery();
  await askStrategyField(ctx, userId);
});

bot.on('text', async (ctx: any, next: any) => {
  const userId = String(ctx.from?.id);
  if (!strategyWizard[userId]) return next();
  const wizard = strategyWizard[userId];
  const field = STRATEGY_FIELDS[wizard.step];
  let value = ctx.message.text.trim();
  // Allow skip
  if (value.toLowerCase() === 'skip' && field.optional) {
    wizard.data[field.key] = undefined;
  } else if (field.type === 'number') {
    const num = Number(value);
    if (isNaN(num)) {
      await ctx.reply('❌ Please enter a valid number or type skip.');
      return;
    }
    wizard.data[field.key] = num;
  } else if (field.type === 'boolean') {
    if (['yes', 'y', 'true', '✅'].includes(value.toLowerCase())) {
      wizard.data[field.key] = true;
    } else if (['no', 'n', 'false', '❌'].includes(value.toLowerCase())) {
      wizard.data[field.key] = false;
    } else {
      await ctx.reply('❌ Please answer with Yes or No.');
      return;
    }
  }
  wizard.step++;
  if (wizard.step < STRATEGY_FIELDS.length) {
    await askStrategyField(ctx, userId);
  } else {
    // Save strategy
    users[userId].strategy = wizard.data;
    saveUsers(users);
    delete strategyWizard[userId];
    await ctx.reply('✅ Your strategy has been updated and saved!');
    await sendMainMenu(ctx);
  }
});

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
  await ctx.reply(msg, { parse_mode: 'HTML' });
}

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

// Placeholder: Replace with real token fetch logic (e.g., from dexscreener API or your own source)
async function fetchUnifiedTokenList(): Promise<any[]> {
  // TODO: Implement real token fetch logic here
  return [];
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


// Start the Telegram bot if this file is run directly
if (require.main === module) {
  bot.launch()
    .then(() => console.log('✅ Telegram bot started and listening for users!'))
    .catch((err: any) => console.error('❌ Bot launch failed:', err));
}
// Dynamic strategy input (step-by-step)
