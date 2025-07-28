// ========== Background Monitor for Profit/Stop Targets ========== //
import { setInterval } from 'timers';
import fs from 'fs';
import { Markup, Telegraf } from 'telegraf';


import dotenv from 'dotenv';
dotenv.config();

import { Keypair } from '@solana/web3.js';
import { fetchBirdeyeTokens } from './utils/birdeyeTokens';
import { fetchPumpFunTokens } from './utils/pumpFunApi';
import { autoBuy } from './utils/autoBuy';
import { sellWithOrca } from './sell';

// Replace with your actual sticker ID or import from a config/constants file
const WELCOME_STICKER = 'CAACAgUAAxkBAAEBQY1kZ...';

const USERS_FILE = 'users.json';
let boughtTokens: Record<string, Set<string>> = {};

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

// ========== User Types ========== //
type UserStrategy = {
  minVolume?: number;
  minHolders?: number;
  minAge?: number;
  enabled?: boolean;
};
type User = {
  trades: number;
  activeTrades: number;
  history: string[];
  wallet?: string;
  secret?: string;
  strategy?: UserStrategy;
  lastMessageAt?: number;
  profitTargets?: Record<string, number>; // tokenMint -> target price in SOL
  stopLosses?: Record<string, number>;   // tokenMint -> stop loss price in SOL
  referrer?: string; // userId of inviter
  referrals?: string[]; // userIds of invitees
  referralEarnings?: number; // in SOL
};



const awaitingUsers: Record<string, any> = Object.create(null);
const pendingWalletVerifications: Record<string, any> = Object.create(null);
// ========== Button Action Handlers for Buy, Sell, Strategy ========== //
// === Referral & Fee System ===

const users: Record<string, User> = loadUsers();

function getReferralPercent(refCount: number) {
  if (refCount >= 1000) return 0.7;
  if (refCount >= 100) return 0.4;
  return 0.2;
}


function getUserInviteLink(userId: string) {
  return `https://t.me/${bot.botInfo?.username || 'YOUR_BOT_USERNAME'}?start=${userId}`;
}

async function sendFeeAndReferral(amountSOL: number, userId: string, txType: string) {
  // Fee: max(1 USD in SOL, 10% of amount)
  let solPrice = 0;
  try {
    const solRes = await fetch('https://public-api.birdeye.so/public/price?address=So11111111111111111111111111111111111111112');
    const solData = await solRes.json();
    solPrice = solData?.data?.value || 0;
  } catch {}
  const minFeeSOL = solPrice ? 1 / solPrice : 0.01;
  let fee = Math.max(minFeeSOL, amountSOL * 0.1);
  // For profit auto-sell, only 8% of profit
  if (txType === 'profit') fee = amountSOL * 0.08;
  if (fee <= 0) return;
  // Send fee to bot wallet (simulate, replace with real transfer in production)
  // await sendSol(users[userId].wallet, BOT_FEE_WALLET, fee);
  // Referral reward
  const refId = users[userId]?.referrer;
  if (refId && users[refId]) {
    const refCount = users[refId].referrals?.length || 0;
    const percent = getReferralPercent(refCount);
    const reward = fee * percent;
    if (reward > 0) {
      users[refId].referralEarnings = (users[refId].referralEarnings || 0) + reward;
      // await sendSol(BOT_FEE_WALLET, users[refId].wallet, reward);
      await bot.telegram.sendMessage(refId,
        `🎁 You earned a referral reward of <b>${reward.toFixed(4)} SOL</b> from your friend <code>${userId}</code>!`,
        { parse_mode: 'HTML' }
      );
    }
    fee -= reward;
  }
  // The rest stays in bot wallet
}

bot.action('buy', async (ctx) => {
  const userId = String(ctx.from?.id);
  if (!hasWallet(users[userId])) {
    return await ctx.reply('You need a wallet to buy tokens. Please choose:', walletKeyboard());
  }
  awaitingUsers[userId + '_buy'] = true;
  await ctx.reply('🔍 Send the token mint address to buy:');
});

bot.action('sell', async (ctx) => {
  const userId = String(ctx.from?.id);
  if (!hasWallet(users[userId])) {
    return await ctx.reply('You need a wallet to sell tokens. Please choose:', walletKeyboard());
  }
  awaitingUsers[userId + '_sell'] = true;
  await ctx.reply('💰 Send the token mint address to sell:');
});

bot.action('set_strategy', async (ctx) => {
  const userId = String(ctx.from?.id);
  awaitingUsers[userId] = 'await_strategy_all';
  await ctx.reply(
    '⚙️ <b>Enter your strategy as: volume,holders,age</b>\nExample: <code>1000,50,10</code>\n' +
    '• volume: Minimum trading volume in USD\n' +
    '• holders: Minimum number of holders\n' +
    '• age: Minimum age in minutes\n' +
    'You can disable the strategy with /strategy_off or enable it with /strategy_on',
    { parse_mode: 'HTML' }
  );
});

function loadUsers(): Record<string, User> {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = fs.readFileSync(USERS_FILE, 'utf8');
      const parsed = JSON.parse(data);
      if (parsed.__boughtTokens) {
        boughtTokens = {};
        for (const userId in parsed.__boughtTokens) {
          boughtTokens[userId] = new Set(parsed.__boughtTokens[userId]);
        }
        delete parsed.__boughtTokens;
      }
      return parsed;
    }
  } catch (e) {
    console.error('Failed to load users:', e);
  }
  return Object.create(null);
}

function saveUsers() {
  try {
    const data = { ...users, __boughtTokens: {} as Record<string, string[]> };
    for (const userId in boughtTokens) {
      (data.__boughtTokens as Record<string, string[]>)[userId] = Array.from(boughtTokens[userId]);
    }
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Failed to save users:', e);
  }
}

function hasWallet(user: User) {
  return !!user?.wallet && !!user?.secret;
}

function walletKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Restore Wallet', 'restore_wallet')],
    [Markup.button.callback('Create New Wallet', 'create_wallet')],
    [Markup.button.callback('Cancel', 'cancel_input')]
  ]);
}

function limitHistory(user: User) {
  if (user.history.length > 50) {
    user.history = user.history.slice(-50);
  }
}

function getErrorMessage(e: any): string {
  return typeof e === 'object' && e && 'message' in e ? e.message : String(e);
}


async function sendMainMenu(ctx: any) {
  await ctx.replyWithSticker(WELCOME_STICKER).catch(() => {});
  const userId = String(ctx.from?.id);
  const user = users[userId] || {};
  let activityPreview = '';
  if (user.history && user.history.length) {
    const last3 = user.history.slice(-3).reverse();
    activityPreview = '\n\n<b>Recent Activity:</b>\n' + last3.map((h) => `• ${h}`).join('\n');
  }
  await ctx.reply(
    '🤖 <b>Welcome to the trading bot!</b>\n\n' +
   'Choose what you want to do from the buttons below 👇' +
    activityPreview,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🪙 Tokens', 'tokens'), Markup.button.callback('💸 Buy', 'buy')],
        [Markup.button.callback('💰 Sell', 'sell'), Markup.button.callback('⚙️ Strategy', 'set_strategy')],
        [Markup.button.callback('🧾 My Activity', 'show_activity'), Markup.button.callback('👛 My Wallet', 'my_wallet')],
        [Markup.button.callback('👥 Invite Friends', 'invite_friends'), Markup.button.callback('❓ Help', 'help')],
        [Markup.button.callback('🔄 Main Menu', 'back_to_menu')]
      ])
    }
  );
}

// Invite Friends button (English)
bot.action('invite_friends', async (ctx) => {
  const userId = String(ctx.from?.id);
  const inviteLink = getUserInviteLink(userId);
  await ctx.reply(
    `👥 <b>Invite Friends</b>\n\n` +
    `Share this link with your friends and earn rewards every time they trade using the bot!\n\n` +
    `<b>Your personal invite link:</b>\n<a href=\"${inviteLink}\">${inviteLink}</a>\n\n` +
    `• Anyone who joins using your link will be linked to your account.\n` +
    `• You will receive a percentage of the trading fees from your referrals.\n` +
    `• Simply forward this message or copy the link above.`,
    { parse_mode: 'HTML', ...Markup.inlineKeyboard([
      [Markup.button.url('🔗 Open Invite Link', inviteLink)],
      [Markup.button.callback('🔄 Main Menu', 'back_to_menu')]
    ]) }
  );
});

bot.action('my_wallet', async (ctx) => {
  const userId = String(ctx.from?.id);
  const user = users[userId];
  if (!user?.wallet) {
    return ctx.reply('No wallet is linked to your account.');
  }
  let msg = `<b>👛 Your Wallet Address:</b>\n<code>${user.wallet}</code>`;
  await ctx.reply(msg, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🔑 Export Private Key', 'exportkey')],
      [Markup.button.callback('🔄 Main Menu', 'back_to_menu')]
    ])
  });
});

// ========== Wallet Setup Actions ========== //
bot.action('restore_wallet', async (ctx) => {
  const userId = String(ctx.from?.id);
  awaitingUsers[userId] = 'await_restore_secret';
  await ctx.reply('Please send your wallet private key (base64):', walletKeyboard());
});

bot.action('create_wallet', async (ctx) => {
  const userId = String(ctx.from?.id);
  users[userId] = users[userId] || { trades: 0, activeTrades: 1, history: [] };
  if (!users[userId].secret || !users[userId].wallet) {
    const keypair = Keypair.generate();
    const publicKey = keypair.publicKey.toBase58();
    const secretKey = Buffer.from(keypair.secretKey).toString('base64');
    users[userId].wallet = publicKey;
    users[userId].secret = secretKey;
    users[userId].history.push('Created new wallet');
    saveUsers();
    delete awaitingUsers[userId];
    await ctx.reply('Your new Solana wallet has been created!\nAddress: ' + publicKey + '\n\n*Keep this address to receive tokens. You can export your private key later using /exportkey.*', { parse_mode: 'Markdown' });
    await sendMainMenu(ctx);
  } else {
    await ctx.reply('You already have a wallet.');
  }
});

bot.action('back_to_menu', async (ctx) => {
  await ctx.replyWithChatAction('typing');
  await sendMainMenu(ctx);
});

// ========== Main Commands ========== //
bot.start(async (ctx) => {
  const userId = String(ctx.from?.id);
  users[userId] = users[userId] || { trades: 0, activeTrades: 1, history: [] };
  // Referral registration
  const args = ctx.startPayload;
  if (args && args !== userId && !users[userId]?.referrer) {
    users[userId].referrer = args;
    users[args] = users[args] || { trades: 0, activeTrades: 1, history: [] };
    users[args].referrals = users[args].referrals || [];
    if (!users[args].referrals.includes(userId)) users[args].referrals.push(userId);
    saveUsers();
    await ctx.reply('🎉 You joined via referral! Your inviter will earn rewards from your trades.');
  }
  if (!hasWallet(users[userId])) {
    awaitingUsers[userId] = 'choose_wallet_action';
    await ctx.reply('Welcome! You need a wallet to use the bot. Please choose:', walletKeyboard());
    return;
  }
  await sendMainMenu(ctx);
});

bot.command('menu', async (ctx) => {
  const userId = String(ctx.from?.id);
  if (!hasWallet(users[userId])) {
    return await ctx.reply('You need a wallet to use the bot. Please choose:', walletKeyboard());
  }
  await sendMainMenu(ctx);
});

bot.command('help', async (ctx) => {
  await ctx.reply(
    '🤖 *Bot Usage Guide*\n\n' +
    '• /tokens — View the latest pump.fun tokens\n' +
    '• /buy — Buy a token by mint address\n' +
    '• /sell — Sell a token by mint address\n' +
    '• /strategy — Set your auto-buy strategy\n' +
    '• /exportkey — Export your private key (be careful!)\n' +
    '• /activity — View your activity\n' +
    '• /menu — Show main menu\n' +
    '\nTo get started, try /tokens or set your strategy with /strategy.',
    { parse_mode: 'Markdown' }
  );
});

// ========== Strategy Setup ========== //
bot.command('strategy', async (ctx) => {
  const userId = String(ctx.from?.id);
  awaitingUsers[userId] = 'await_strategy_all';
  await ctx.reply(
    '⚙️ <b>Enter your strategy as: SOL,holders,minutes</b>\nExample: <code>0.5,50,10</code>\n' +
    '• SOL: Minimum trading volume in SOL\n' +
    '• holders: Minimum number of holders\n' +
    '• minutes: Minimum age in minutes\n' +
    'You can disable the strategy with /strategy_off or enable it with /strategy_on\n' +
    'Show your current strategy with /strategy_show',
    { parse_mode: 'HTML' }
  );
});

bot.command('strategy_on', async (ctx) => {
  const userId = String(ctx.from?.id);
  users[userId] = users[userId] || { trades: 0, activeTrades: 1, history: [] };
  users[userId].strategy = users[userId].strategy || {};
  users[userId].strategy.enabled = true;
  saveUsers();
  await ctx.reply('✅ Auto-buy strategy enabled.');
});

bot.command('strategy_off', async (ctx) => {
  const userId = String(ctx.from?.id);
  users[userId] = users[userId] || { trades: 0, activeTrades: 1, history: [] };
  users[userId].strategy = users[userId].strategy || {};
  users[userId].strategy.enabled = false;
  saveUsers();
  await ctx.reply('⏸️ Auto-buy strategy disabled.');
});

// ========== Activity & Wallet Info ========== //
bot.action('show_activity', async (ctx) => {
  const userId = String(ctx.from?.id);
  if (!hasWallet(users[userId])) {
    return await ctx.reply('You need a wallet to view your activity. Please choose:', walletKeyboard());
  }
  const history = users[userId]?.history || [];
  const text = history.length ? history.map((h: string) => `• ${h}`).join('\n') : 'No activity yet.';
  await ctx.reply(`📊 *Your Activity:*\n${text}`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'back_to_menu')]])
  });
});

bot.command('exportkey', async (ctx) => {
  const userId = String(ctx.from?.id);
  const user = users[userId];
  if (!user || !user.secret) {
    return await ctx.reply('You need a wallet to export the private key. Please choose:', walletKeyboard());
  }
  await ctx.reply('⚠️ *Warning: Your private key gives full control over your funds. Never share it with anyone!*\n\nYour private key (base64):\n' + user.secret, { parse_mode: 'Markdown' });
});

// ========== Buy & Sell ========== //
bot.command('buy', async (ctx) => {
  const userId = String(ctx.from?.id);
  if (!hasWallet(users[userId])) {
    return await ctx.reply('You need a wallet to buy tokens. Please choose:', walletKeyboard());
  }
  awaitingUsers[userId + '_buy'] = true;
  ctx.reply('🔍 Send the token mint address to buy:');
});

bot.command('sell', async (ctx) => {
  const userId = String(ctx.from?.id);
  if (!hasWallet(users[userId])) {
    return await ctx.reply('You need a wallet to sell tokens. Please choose:', walletKeyboard());
  }
  awaitingUsers[userId + '_sell'] = true;
  ctx.reply('💰 Send the token mint address to sell:');
});

// ========== Tokens List ========== //
bot.command(['tokens', 'pumpfun', 'list'], async (ctx) => {
  const userId = String(ctx.from?.id);
  await ctx.reply('Fetching the latest trending tokens ...');
  try {
    let tokens;
    try {
      // جرب birdeye أولاً
      tokens = await fetchBirdeyeTokens();
    } catch (err) {
      // إذا فشل birdeye جرب pump.fun fallback
      try {
        tokens = await fetchPumpFunTokens();
      } catch {}
    }
    console.log('DEBUG: fetchTokens() result for /tokens:', tokens);
    if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
      await ctx.reply('No tokens found at the moment. (Debug: ' + JSON.stringify(tokens) + ')');
      return;
    }
    const top = tokens.slice(0, 10);
    let msg = '<b>Trending Solana tokens:</b>\n';
    msg += top.map((t, i) => {
      let vol = '-';
      if ('volume24h' in t && typeof t.volume24h === 'number') vol = t.volume24h.toLocaleString();
      else if ('volume' in t && typeof t.volume === 'number') vol = t.volume.toLocaleString();
      return `\n${i+1}. ${t.symbol} | MC: $${t.marketCap?.toLocaleString?.() ?? '-'} | Vol: ${vol} | <code>${t.address}</code>`;
    }).join('\n');
    await ctx.reply(msg, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('Refresh', 'refresh_tokens')]])
    });
    users[userId] = users[userId] || { trades: 0, activeTrades: 1, history: [] };
    users[userId].history.push('Viewed trending tokens list');
    saveUsers();
  } catch (e: any) {
    await ctx.reply('Error fetching tokens: ' + getErrorMessage(e));
  }
});

bot.action('refresh_tokens', async (ctx) => {
  const userId = String(ctx.from?.id);
  await ctx.reply('Refreshing tokens...');
  try {
    let tokens;
    try {
      tokens = await fetchBirdeyeTokens();
    } catch (err) {
      try {
        tokens = await fetchPumpFunTokens();
      } catch {}
    }
    console.log('DEBUG: fetchTokens() result for refresh:', tokens);
    if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
      await ctx.reply('No tokens found at the moment. (Debug: ' + JSON.stringify(tokens) + ')');
      return;
    }
    const top = tokens.slice(0, 10);
    let msg = '<b>Trending Solana tokens:</b>\n';
    msg += top.map((t, i) => {
      let vol = '-';
      if ('volume24h' in t && typeof t.volume24h === 'number') vol = t.volume24h.toLocaleString();
      else if ('volume' in t && typeof t.volume === 'number') vol = t.volume.toLocaleString();
      return `\n${i+1}. ${t.symbol || '-'} | MC: $${t.marketCap?.toLocaleString?.() ?? '-'} | Vol: ${vol} | <code>${t.address}</code>`;
    }).join('\n');
    await ctx.reply(msg, { parse_mode: 'HTML' });
  } catch (e: any) {
    await ctx.reply('Error fetching tokens: ' + getErrorMessage(e));
  }
});

// ========== Text Handler (Wallet Restore, Strategy, Buy/Sell) ========== //
bot.on('text', async (ctx) => {
  const userId = String(ctx.from?.id);
  const text = ctx.message.text.trim();
  const user = users[userId] = users[userId] || { trades: 0, activeTrades: 1, history: [] };
  user.lastMessageAt = Date.now();
  limitHistory(user);

  // Restore wallet
  if (awaitingUsers[userId] === 'await_restore_secret') {
    if (!text || text.length < 80) {
      await ctx.reply('❌ Private key is too short or invalid. Please send a base64-encoded private key (usually more than 80 characters).');
      return;
    }
    try {
      const secret = Buffer.from(text, 'base64');
      if (secret.length !== 64) {
        await ctx.reply('❌ Invalid private key length. It must be 64 bytes (base64).');
        return;
      }
      const keypair = Keypair.fromSecretKey(secret);
      const publicKey = keypair.publicKey.toBase58();
      user.wallet = publicKey;
      user.secret = text;
      user.history.push('Wallet restored');
      saveUsers();
      delete awaitingUsers[userId];
      await ctx.reply('✅ Wallet restored successfully!\nAddress: ' + publicKey, { parse_mode: 'Markdown' });
      await sendMainMenu(ctx);
    } catch (err) {
      await ctx.reply('❌ Invalid private key or not a base64-encoded Solana wallet.');
    }
    return;
  }

  // Strategy setup (all at once)
  if (awaitingUsers[userId] === 'await_strategy_all') {
    const parts = text.split(',').map(s => s.trim());
    if (parts.length !== 3) return ctx.reply('❌ Please enter the values like: 0.5,50,10');
    const [v, h, a] = parts;
    const minVolume = parseFloat(v); // in SOL
    const minHolders = parseInt(h);
    const minAge = parseInt(a); // in minutes
    if (isNaN(minVolume) || minVolume < 0.01) return ctx.reply('❌ Volume must be a number greater than or equal to 0.01 SOL.');
    if (isNaN(minHolders) || minHolders < 10) return ctx.reply('❌ Holders must be a number greater than or equal to 10.');
    if (isNaN(minAge) || minAge < 1) return ctx.reply('❌ Age must be a number greater than or equal to 1 minute.');
    user.strategy = { minVolume, minHolders, minAge, enabled: true };
    user.history.push(`Saved strategy: Volume ≥ ${minVolume} SOL, Holders ≥ ${minHolders}, Age ≥ ${minAge} min`);
    saveUsers();
    delete awaitingUsers[userId];
    // Fetch matching tokens
    try {
      await ctx.reply('🔎 Fetching tokens matching your strategy...');
      const tokens = await fetchPumpFunTokens();
      console.log('DEBUG: fetchPumpFunTokens() result:', tokens);
      if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
        await ctx.reply('No tokens fetched from API. (Debug: ' + JSON.stringify(tokens) + ')');
      } else {
        const alreadyBought = boughtTokens[userId] || new Set();
        const matches = tokens.filter(token => {
          let ok = true;
          if (typeof token.holders === 'number') ok = ok && token.holders >= minHolders;
          if (typeof token.ageMinutes === 'number') ok = ok && token.ageMinutes >= minAge;
          // Assume token.volume is in SOL
          if (typeof token.volume === 'number') ok = ok && token.volume >= minVolume;
          if (alreadyBought.has(token.address)) ok = false;
          return ok;
        });
        let msg = '<b>Tokens matching your strategy:</b>\n';
        if (!matches.length) {
          msg += '\nNo tokens currently match your strategy.';
        } else {
          msg += matches.slice(0, 10).map((t, i) =>
            `\n${i+1}. ${t.symbol || '-'} | MC: $${t.marketCap ? t.marketCap.toLocaleString() : '-'} | Vol: ${t.volume ? t.volume.toLocaleString() + ' SOL' : '-'} | Holders: ${t.holders ?? '-'} | Age: ${t.ageMinutes ?? '-'}m\n<code>${t.address}</code>`
          ).join('\n');
        }
        await ctx.reply(msg, { parse_mode: 'HTML' });
      }
    } catch (e: any) {
      await ctx.reply('Error fetching tokens: ' + getErrorMessage(e));
    }
    return ctx.reply('✅ Strategy saved and enabled!');
  }
// Show current strategy
bot.command('strategy_show', async (ctx) => {
  const userId = String(ctx.from?.id);
  const strat = users[userId]?.strategy;
  if (!strat) {
    return ctx.reply('No strategy set. Use /strategy to set one.');
  }
  let msg = 'Your current strategy:\n';
  msg += `• Min Volume: ${strat.minVolume ?? '-'} SOL\n`;
  msg += `• Min Holders: ${strat.minHolders ?? '-'}\n`;
  msg += `• Min Age: ${strat.minAge ?? '-'} minutes\n`;
  msg += `• Enabled: ${strat.enabled ? 'Yes' : 'No'}`;
  await ctx.reply(msg);
});


  // Manual buy
  if (awaitingUsers[userId + '_buy']) {
    delete awaitingUsers[userId + '_buy'];
    if (!user?.secret) {
      return ctx.reply('❌ You must create or restore your wallet first.');
    }
    const tokenMint = text.trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(tokenMint)) {
      return ctx.reply('❌ Invalid token address. It must be a valid Solana mint address (32-44 chars).');
    }
    try {
      const amount = 0.01; // Default buy amount in SOL
      const tx = await autoBuy(tokenMint, amount, user.secret);
      user.history.push(`Buy: ${tokenMint} | Amount: ${amount} SOL | Tx: ${tx}`);
      saveUsers();
      await ctx.reply(
        `✅ <b>Buy order sent successfully!</b>\n\n` +
        `<b>Token:</b> <code>${tokenMint}</code>\n` +
        `<b>Amount:</b> ${amount} SOL\n` +
        `<b>Transaction:</b> <a href=\"https://solscan.io/tx/${tx}\">${tx}</a>\n\n` +
        `You can track it on Solscan or any Solana explorer.`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('Reserve Profit', `set_profit_${tokenMint}`), Markup.button.callback('Stop Loss', `set_stop_${tokenMint}`)]
          ])
        }
      );
      // Show summary
      await ctx.reply(
        `📈 <b>Trade Summary</b>\n` +
        `• <b>Wallet:</b> <code>${user.wallet}</code>\n` +
        `• <b>Token:</b> <code>${tokenMint}</code>\n` +
        `• <b>Amount:</b> ${amount} SOL\n` +
        `• <b>Tx:</b> <a href=\"https://solscan.io/tx/${tx}\">${tx}</a>`,
        { parse_mode: 'HTML' }
      );
      await sendFeeAndReferral(amount, userId, 'trade');
      return;
    } catch (e: any) {
      return ctx.reply('❌ Buy failed: ' + getErrorMessage(e));
    }
  }

  // Manual sell (activated)
  if (awaitingUsers[userId + '_sell']) {
    delete awaitingUsers[userId + '_sell'];
    if (!user?.secret) {
      return ctx.reply('❌ You must create or restore your wallet first.');
    }
    const tokenMint = text.trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(tokenMint)) {
      return ctx.reply('❌ Invalid token address. It must be a valid Solana mint address (32-44 chars).');
    }
    try {
      const amount = 0.01; // Default sell amount in SOL (can be improved to fetch actual balance)
      const tx = await sellWithOrca(tokenMint, amount);
      user.history.push(`Sell: ${tokenMint} | Amount: ${amount} SOL | Tx: ${tx}`);
      saveUsers();
      await ctx.reply(
        `✅ <b>Sell order sent successfully!</b>\n\n` +
        `<b>Token:</b> <code>${tokenMint}</code>\n` +
        `<b>Amount:</b> ${amount} SOL\n` +
        `<b>Transaction:</b> <a href=\"https://solscan.io/tx/${tx}\">${tx}</a>\n\n` +
        `You can track it on Solscan or any Solana explorer.`,
        { parse_mode: 'HTML' }
      );
      // Show summary
      await ctx.reply(
        `📉 <b>Trade Summary</b>\n` +
        `• <b>Wallet:</b> <code>${user.wallet}</code>\n` +
        `• <b>Token:</b> <code>${tokenMint}</code>\n` +
        `• <b>Amount:</b> ${amount} SOL\n` +
        `• <b>Tx:</b> <a href=\"https://solscan.io/tx/${tx}\">${tx}</a>`,
        { parse_mode: 'HTML' }
      );
      await sendFeeAndReferral(amount, userId, 'trade');
      return;
    } catch (e: any) {
      return ctx.reply('❌ Sell failed: ' + getErrorMessage(e));
    }
  }

  // Fallback
  await ctx.reply(
    'Unknown command or input. Type /help to see available commands.',
    Markup.inlineKeyboard([
      [Markup.button.callback('Main Menu', 'back_to_menu')]
    ])
  );
});


bot.launch()
  .then(() => {
    console.log('========================================');
    console.log('✅ Telegram trading bot is running!');
    console.log('Start time:', new Date().toLocaleString());
    console.log('========================================');
  })
  .catch((err) => console.error('❌ Bot launch failed:', err));
