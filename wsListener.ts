

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


            // جلب اسم البوت دائماً من كائن البوت إذا توفر (الأولوية)
            let botUsername = (bot && bot.botInfo && bot.botInfo.username) ? bot.botInfo.username : (process.env.BOT_USERNAME || 'YourBotUsername');
            // رابط مشاركة العملة مع البوت
            const inviteUrl = `https://t.me/${botUsername}?start=${address}`;


            // تنسيق الأرقام مع وحدة العملة
            function fmt(val: number | string | undefined | null, digits = 2, unit?: string): string {
              if (val === undefined || val === null) return '-';
              let num = typeof val === 'number' ? val : Number(val);
              if (isNaN(num)) return String(val);
              let str = num.toLocaleString(undefined, { maximumFractionDigits: digits });
              if (unit) str += ' ' + unit;
              return str;
            }

            // التأكد من أن marketCap وvolume بالدولار فقط
            const marketCapUsd = (marketCap && (!token.marketCapUnit || token.marketCapUnit === 'USD')) ? marketCap : undefined;
            const volumeUsd = (volume && (!token.volumeUnit || token.volumeUnit === 'USD')) ? volume : undefined;



            let msg = `🚀 <b>${name} (${symbol})</b> ${verified === true || verified === 'true' ? '✅' : '❌'}\n`;
            if (logo) msg += `<a href='${dexUrl}'><img src='${logo}' width='64' height='64'/></a>\n`;
            if (priceUsd || priceSol) {
              msg += `<b>Price:</b> `;
              if (priceUsd) msg += `$${fmt(priceUsd, 6, 'USD')}`;
              if (priceSol) msg += ` | <b>SOL:</b> ${fmt(priceSol, 6, 'SOL')}`;
              msg += `\n`;
            }
            if (marketCapUsd) msg += `<b>MarketCap:</b> $${fmt(marketCapUsd, 2, 'USD')}\n`;
            if (volumeUsd) msg += `<b>Volume (24h):</b> $${fmt(volumeUsd, 2, 'USD')}\n`;
            if (holders) msg += `<b>Holders:</b> ${fmt(holders, 0)}\n`;
            if (age) msg += `<b>Age:</b> ${fmt(age, 0)} min\n`;
            msg += `<b>Address:</b> <code>${address}</code>\n`;
            msg += `\n<a href='${dexUrl}'>View on DexScreener</a> | <a href='${inviteUrl}'>Share via Bot</a>`;

            // أزرار تفاعل مستقبلية (Buy/Watch/Ignore)
            const inlineKeyboard = [
              [
                { text: '🟢 Buy', url: dexUrl },
                { text: '👁️ Watch', url: dexUrl },
                { text: '📈 View Chart', url: dexUrl }
              ]
            ];

            bot.telegram.sendMessage(uid, msg, {
              parse_mode: 'HTML',
              disable_web_page_preview: false,
              reply_markup: { inline_keyboard: inlineKeyboard }
            });
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