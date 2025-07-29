import WebSocket from 'ws';
import dotenv from 'dotenv';
dotenv.config();


// WebSocket sources from environment variables

// Only DexScreener source allowed
const sources: Record<string, string | undefined> = {
  dexscreener: process.env.DEXSCREENER_WS_URL,
};

const selectedSource = process.env.WS_SOURCE;
if (!selectedSource || !sources[selectedSource]) {
  console.error(`WebSocket source '${selectedSource}' not found or not set in .env`);
  process.exit(1);
}
const wsUrl = sources[selectedSource];

import axios from 'axios';
import { filterTokensByStrategy } from './bot/strategy';
import { Strategy } from './bot/types';
import { Telegraf } from 'telegraf';
import fs from 'fs';
const USERS_FILE = 'users.json';
let users: Record<string, any> = {};
try {
  if (fs.existsSync(USERS_FILE)) {
    users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  }
} catch (err) {
  console.error('Error loading users.json:', err);
}

// Function to get strategy settings for a user from users.json, fallback to .env
function getUserStrategy(userId?: string): Strategy {
  if (userId && users[userId] && users[userId].strategy) {
    return users[userId].strategy;
  }
  return {
    minVolume: process.env.STRAT_MIN_VOLUME ? Number(process.env.STRAT_MIN_VOLUME) : undefined,
    minHolders: process.env.STRAT_MIN_HOLDERS ? Number(process.env.STRAT_MIN_HOLDERS) : undefined,
    minAge: process.env.STRAT_MIN_AGE ? Number(process.env.STRAT_MIN_AGE) : undefined,
    minMarketCap: process.env.STRAT_MIN_MARKETCAP ? Number(process.env.STRAT_MIN_MARKETCAP) : undefined,
    maxAge: process.env.STRAT_MAX_AGE ? Number(process.env.STRAT_MAX_AGE) : undefined,
    onlyVerified: process.env.STRAT_ONLY_VERIFIED === 'true',
    fastListing: process.env.STRAT_FAST_LISTING === 'true',
    enabled: process.env.STRAT_ENABLED === 'true',
  };
}

if (selectedSource === 'dexscreener') {
  // DexScreener uses HTTP API, not WebSocket
  async function fetchDexScreenerTokens() {
    try {
      // تحديد نوع الإجراء من .env أو الافتراضي
      const actionType = process.env.DEXSCREENER_API_TYPE || 'boosts';
      let endpoint: string | undefined;
      switch (actionType) {
        case 'boosts':
          endpoint = process.env.DEXSCREENER_API_ENDPOINT_BOOSTS;
          break;
        case 'profiles':
          endpoint = process.env.DEXSCREENER_API_ENDPOINT_PROFILES;
          break;
        case 'search':
          endpoint = process.env.DEXSCREENER_API_ENDPOINT_SEARCH;
          break;
        default:
          endpoint = process.env.DEXSCREENER_API_ENDPOINT;
      }
      if (!endpoint) {
        throw new Error('DexScreener endpoint not set in .env');
      }
      const response = await axios.get(endpoint);

      let tokens: any[] = [];
      let dataType = '';
      if (endpoint.includes('token-boosts')) {
        tokens = response.data?.pairs || response.data?.tokens || response.data || [];
        dataType = 'boosts';
      } else if (endpoint.includes('token-profiles')) {
        tokens = response.data?.profiles || response.data?.tokens || response.data || [];
        dataType = 'profiles';
      } else if (endpoint.includes('dex/search')) {
        tokens = response.data?.pairs || response.data?.tokens || response.data || [];
        dataType = 'search';
      } else {
        tokens = response.data?.pairs || response.data?.tokens || response.data || [];
        dataType = 'unknown';
      }
      console.log(`[DexScreener] Data type: ${dataType}, Tokens received:`, Array.isArray(tokens) ? tokens.length : typeof tokens);
      // Print raw tokens for inspection
      if (Array.isArray(tokens)) {
        console.log('--- Raw tokens sample (first 3) ---');
        tokens.slice(0, 3).forEach((t, i) => {
          console.log(`Token #${i+1}:`, JSON.stringify(t, null, 2));
        });
      } else {
        console.log('Raw tokens:', JSON.stringify(tokens, null, 2));
      }
      // Use per-user strategy for each user
      let notified = false;
      Object.keys(users).forEach(uid => {
        const strategy = getUserStrategy(uid);
        const filtered = filterTokensByStrategy(tokens, strategy);
        if (filtered.length > 0 && bot && users[uid].telegramId) {
          notified = true;
          console.log(`Filtered tokens (strategy matched for user ${uid}):`);
          filtered.forEach((token, idx) => {
            console.log(`#${idx+1}:`, JSON.stringify(token, null, 2));
            const msg = `🚀 New token matched your strategy (DexScreener):\n` +
              `<b>Address:</b> <code>${token.address || token.mint || token.tokenAddress || 'N/A'}</code>\n` +
              `<b>MarketCap:</b> ${token.marketCap || 'N/A'}\n` +
              `<b>Volume:</b> ${token.volume || token.amount || 'N/A'}\n` +
              `<b>Age:</b> ${token.age || 'N/A'} min\n`;
            bot.telegram.sendMessage(users[uid].telegramId, msg, { parse_mode: 'HTML' });
          });
        }
      });
      if (!notified) {
        console.log('No tokens matched any user strategy.');
      }
    } catch (err) {
      console.error('DexScreener API error:', err);
    }
  }
  // جلب البيانات كل دقيقة تلقائياً
  setInterval(fetchDexScreenerTokens, 60 * 1000);
  // جلب أولي عند التشغيل
  fetchDexScreenerTokens();
} else {
  if (!wsUrl) {
    console.error(`WebSocket URL for source '${selectedSource}' not found in .env`);
    process.exit(1);
  }
  const ws = new WebSocket(wsUrl);
  ws.on('open', () => {
    console.log(`WebSocket connection opened: [${selectedSource}]`, wsUrl);
    // You can send a subscription message here if required by the source documentation
  });
  ws.on('message', (data: WebSocket.Data) => {
    try {
      const json = JSON.parse(data.toString());
      // Assume incoming data is a single token or an array of tokens
      const tokens = Array.isArray(json) ? json : [json];
      // Print raw tokens for inspection
      if (Array.isArray(tokens)) {
        console.log('--- Raw tokens sample (first 3) ---');
        tokens.slice(0, 3).forEach((t, i) => {
          console.log(`Token #${i+1}:`, JSON.stringify(t, null, 2));
        });
      } else {
        console.log('Raw tokens:', JSON.stringify(tokens, null, 2));
      }
      // Use per-user strategy for each user
      let notified = false;
      Object.keys(users).forEach(uid => {
        const strategy = getUserStrategy(uid);
        const filtered = filterTokensByStrategy(tokens, strategy);
        if (filtered.length > 0 && bot && users[uid].telegramId) {
          notified = true;
          console.log(`Filtered tokens (strategy matched for user ${uid}):`);
          filtered.forEach((token, idx) => {
            console.log(`#${idx+1}:`, JSON.stringify(token, null, 2));
            const msg = `🚀 New token matched your strategy:\n` +
              `<b>Address:</b> <code>${token.address || token.mint || token.tokenAddress || 'N/A'}</code>\n` +
              `<b>MarketCap:</b> ${token.marketCap || 'N/A'}\n` +
              `<b>Volume:</b> ${token.volume || token.amount || 'N/A'}\n` +
              `<b>Age:</b> ${token.age || 'N/A'} min\n`;
            bot.telegram.sendMessage(users[uid].telegramId, msg, { parse_mode: 'HTML' });
          });
        }
      });
      if (!notified) {
        console.log('No tokens matched any user strategy.');
      }
    } catch (e) {
      console.log('Raw message:', data);
    }
  });
  ws.on('error', (err: Error) => {
    console.error('WebSocket error:', err);
  });
  ws.on('close', () => {
    console.log('WebSocket connection closed');
  });
}

// Initialize Telegram bot
const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const telegramUserId = process.env.TELEGRAM_USER_ID;
if (!telegramToken || !telegramUserId) {
  console.warn('Telegram bot token or user ID not set in .env, notifications will be disabled.');
}
const bot = telegramToken ? new Telegraf(telegramToken) : undefined;
