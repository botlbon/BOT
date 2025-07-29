

import dotenv from 'dotenv';
import axios from 'axios';
import { filterTokensByStrategy } from './bot/strategy';
import { Strategy } from './bot/types';
dotenv.config();

function getUserStrategy(users: Record<string, any>, userId?: string): Strategy {
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

let awaitingUsers: Record<string, any> = {};
(globalThis as any).awaitingUsers = awaitingUsers;

// Poll DexScreener REST API and notify users
function registerWsNotifications(bot: any, users: Record<string, any>) {
  async function fetchDexScreenerTokens() {
    try {
      const endpoint = process.env.DEXSCREENER_API_ENDPOINT_BOOSTS || 'https://api.dexscreener.com/token-boosts/latest/v1';
      const response = await axios.get(endpoint);
      const tokens: any[] = response.data?.pairs || response.data?.tokens || response.data || [];
      let notified = false;
      Object.keys(users).forEach(uid => {
        const strategy = getUserStrategy(users, uid);
        const filtered = filterTokensByStrategy(tokens, strategy);
        if (filtered.length > 0 && bot) {
          notified = true;
          filtered.forEach((token, idx) => {
            // فقط عملات سولانا
            const chain = (token.chainId || token.chain || token.chainName || '').toString().toLowerCase();
            if (chain && !chain.includes('sol')) return;

            // استخراج البيانات
            const address = token.tokenAddress || token.address || token.mint || token.pairAddress || 'N/A';
            const symbol = token.symbol || token.baseToken?.symbol || '-';
            const name = token.name || token.baseToken?.name || '-';
            const priceUsd = token.priceUsd ?? token.price ?? token.priceNative ?? undefined;
            const priceSol = token.priceSol ?? (priceUsd && token.baseToken?.priceUsd ? (Number(priceUsd) / Number(token.baseToken.priceUsd)).toFixed(4) : undefined);
            const marketCap = token.marketCap ?? token.fdv;
            const holders = token.holders ?? token.totalAmount;
            const age = token.age;
            const verified = token.verified !== undefined ? token.verified : (token.baseToken?.verified !== undefined ? token.baseToken.verified : '-');
            const volume = token.volume ?? token.volume24h ?? token.amount;
            const logo = token.logoURI || token.logo || token.baseToken?.logoURI || undefined;
            const pairAddress = token.pairAddress || address;
            // روابط DexScreener
            const dexBase = process.env.DEXSCREENER_BASE_URL || 'https://dexscreener.com/solana';
            const dexUrl = `${dexBase}/${pairAddress}`;
            // رابط دعوة البوت
            const botUsername = process.env.BOT_USERNAME || 'YourBotUsername';
            const inviteUrl = `https://t.me/${botUsername}?start=${address}`;

            // تنسيق الأرقام
            function fmt(val: number | string | undefined | null, digits = 2): string {
              if (val === undefined || val === null) return '-';
              if (typeof val === 'number') return val.toLocaleString(undefined, { maximumFractionDigits: digits });
              if (!isNaN(Number(val))) return Number(val).toLocaleString(undefined, { maximumFractionDigits: digits });
              return String(val);
            }

            let msg = `🚀 <b>Token Alert!</b>\n`;
            if (logo) msg += `<a href='${dexUrl}'><img src='${logo}' width='32' height='32'/></a>\n`;
            msg += `<b>Name:</b> ${name} (${symbol})\n`;
            msg += `<b>Address:</b> <code>${address}</code>\n`;
            if (priceUsd) msg += `<b>Price (USD):</b> $${fmt(priceUsd, 6)}\n`;
            if (priceSol) msg += `<b>Price (SOL):</b> ${fmt(priceSol, 6)}\n`;
            if (marketCap) msg += `<b>MarketCap:</b> $${fmt(marketCap)}\n`;
            if (volume) msg += `<b>Volume (24h):</b> $${fmt(volume)}\n`;
            if (holders) msg += `<b>Holders:</b> ${fmt(holders, 0)}\n`;
            if (age) msg += `<b>Age:</b> ${fmt(age, 0)} min\n`;
            msg += `<b>Verified:</b> ${verified === true || verified === 'true' ? '✅' : '❌'}\n`;
            msg += `\n<a href='${dexUrl}'>View on DexScreener</a> | <a href='${inviteUrl}'>Share via Bot</a>`;

            bot.telegram.sendMessage(uid, msg, { parse_mode: 'HTML', disable_web_page_preview: false });
          });
        }
      });
    } catch (err) {
      // يمكن إضافة لوج هنا عند الحاجة
    }
  }
  setInterval(fetchDexScreenerTokens, 60 * 1000);
  fetchDexScreenerTokens();
}

export { registerWsNotifications };
