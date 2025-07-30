
import axios from 'axios';
import { filterTokensByStrategy } from '../bot/strategy';
import { Strategy } from '../bot/types';

// STRATEGY_FIELDS: كل الحقول المتوفرة من بيانات السوق
export type StrategyField = { key: string; label: string; type: string; optional: boolean };
// الحقول الثابتة التي يجب أن تظهر دائمًا للمستخدم
export let STRATEGY_FIELDS: StrategyField[] = [
  { key: 'minPrice', label: 'أقل سعر (USD)', type: 'number', optional: true },
  { key: 'maxPrice', label: 'أعلى سعر (USD)', type: 'number', optional: true },
  { key: 'minMarketCap', label: 'أقل ماركت كاب', type: 'number', optional: true },
  { key: 'minHolders', label: 'أقل عدد هولدرز', type: 'number', optional: true },
  { key: 'minAge', label: 'أقل عمر (دقائق)', type: 'number', optional: true },
  { key: 'onlyVerified', label: 'عملات موثقة فقط', type: 'boolean', optional: true },
  { key: 'enabled', label: 'تفعيل الاستراتيجية', type: 'boolean', optional: true },
  { key: 'buyAmount', label: 'مبلغ الشراء (SOL)', type: 'number', optional: false },
  { key: 'profitTargets', label: 'أهداف الربح (%)', type: 'string', optional: true },
  { key: 'sellPercents', label: 'نسب البيع (%)', type: 'string', optional: true },
  { key: 'stopLossPercent', label: 'وقف الخسارة (%)', type: 'number', optional: true },
];

// جلب الحقول الرقمية الهامة من كل المستويات (حتى داخل الكائنات الفرعية)



export async function fetchDexScreenerTokens(): Promise<any[]> {
  // منطق الجلب القديم: يجرب عدة endpointات ويفلتر chainId=solana فقط
  const endpoints = [
    process.env.DEXSCREENER_API_ENDPOINT_BOOSTS,
    process.env.DEXSCREENER_API_ENDPOINT,
    process.env.DEXSCREENER_API_URL,
    process.env.DEXSCREENER_API,
    'https://api.dexscreener.com/latest/dex/search',
  ].filter(Boolean);
  const searchQueries = ['sol'];
  for (const endpointRaw of endpoints) {
    const endpoint = String(endpointRaw);
    if (/\/search|\/pairs/.test(endpoint)) {
      for (const q of searchQueries) {
        try {
          const url = endpoint.includes('?') ? `${endpoint}&q=${q}` : `${endpoint}?q=${q}`;
          const response = await axios.get(url);
          console.log('DexScreener response.data:', JSON.stringify(response.data).slice(0, 2000));
          let tokens = response.data?.pairs || response.data?.tokens || response.data || [];
          if (typeof tokens === 'object' && !Array.isArray(tokens) && tokens !== null) {
            const arr = Object.values(tokens).find(v => Array.isArray(v) && v.length > 0);
            if (Array.isArray(arr)) tokens = arr;
          }
          // فلترة سولانا فقط
          if (Array.isArray(tokens) && tokens.length > 0) {
            tokens = tokens.filter(t => {
              const chain = (t.chainId || t.chain || t.network || '').toString().toLowerCase();
              return chain === 'solana';
            });
            return tokens;
          }
        } catch (err) {
          console.error('DexScreener fetch error:', err);
        }
      }
    } else {
      try {
        const response = await axios.get(endpoint);
        console.log('DexScreener response.data:', JSON.stringify(response.data).slice(0, 2000));
        let tokens = response.data?.pairs || response.data?.tokens || response.data || [];
        if (typeof tokens === 'object' && !Array.isArray(tokens) && tokens !== null) {
          const arr = Object.values(tokens).find(v => Array.isArray(v) && v.length > 0);
          if (Array.isArray(arr)) tokens = arr;
        }
        // فلترة سولانا فقط
        if (Array.isArray(tokens) && tokens.length > 0) {
          tokens = tokens.filter(t => {
            const chain = (t.chainId || t.chain || t.network || '').toString().toLowerCase();
            return chain === 'solana';
          });
          return tokens;
        }
      } catch (err) {
        console.error('DexScreener fetch error:', err);
      }
    }
  }
  return [];
}

export function fmt(val: number | string | undefined | null, digits = 2, unit?: string): string {
  if (val === undefined || val === null) return '-';
  let num = typeof val === 'number' ? val : Number(val);
  if (isNaN(num)) return String(val);
  let str = num.toLocaleString(undefined, { maximumFractionDigits: digits });
  if (unit) str += ' ' + unit;
  return str;
}

export function buildTokenMessage(token: any, botUsername: string, pairAddress: string): string {
  // استخراج القيم الأساسية بدقة من جميع الحقول المحتملة
  const name = token.name || token.baseToken?.name || '';
  const symbol = token.symbol || token.baseToken?.symbol || '';
  const address = token.tokenAddress || token.address || token.mint || token.pairAddress || '';
  // السعر
  const priceRaw = token.priceUsd ?? token.price ?? token.priceNative ?? (token.baseToken && (token.baseToken.priceUsd ?? token.baseToken.price));
  const priceUsd = fmt(priceRaw, 6);
  // الماركت كاب
  const marketCapRaw = token.marketCap ?? token.fdv ?? (token.baseToken && token.baseToken.marketCap);
  const marketCap = fmt(marketCapRaw);
  // السيولة
  const liquidityRaw = (token.liquidity && (token.liquidity.usd ?? token.liquidity)) ?? (token.baseToken && token.baseToken.liquidity) ?? token.liquidityUsd;
  const liquidity = fmt(liquidityRaw);
  // الهولدرز
  const holdersRaw = token.holders ?? (token.baseToken && token.baseToken.holders);
  const holders = fmt(holdersRaw);
  // العمر: إذا لم يوجد age، احسبه من pairCreatedAt
  let ageRaw = token.age;
  if (!ageRaw && token.pairCreatedAt) {
    const now = Date.now();
    const created = Number(token.pairCreatedAt);
    if (!isNaN(created) && created > 0) {
      ageRaw = Math.floor((now - created) / 60000); // دقائق
    }
  }
  const age = fmt(ageRaw);
  // التوثيق
  const verified = (token.verified === true || token.verified === 'true' || (token.baseToken && (token.baseToken.verified === true || token.baseToken.verified === 'true')));
  // الحجم
  const volumeRaw = token.volume ?? token.volume24h ?? (token.baseToken && (token.baseToken.volume ?? token.baseToken.volume24h));
  const volume = fmt(volumeRaw);
  const dexUrl = token.url || (pairAddress ? `https://dexscreener.com/solana/${pairAddress}` : '');
  const inviteUrl = `https://t.me/${botUsername}?start=${address}`;

  // إخفاء العملة إذا لم تتوفر بيانات أساسية
  if (!name || !symbol || !address || !priceRaw || !marketCapRaw) {
    return '<i>بيانات العملة غير متوفرة أو غير مكتملة.</i>';
  }

  let msg = `<b>${name} (${symbol})</b>\n`;
  msg += `Address: <code>${address}</code>\n`;
  msg += `Price: $${priceUsd}\n`;
  msg += `MarketCap: $${marketCap}\n`;
  if (liquidity !== '-') msg += `Liquidity: $${liquidity}\n`;
  if (volume !== '-') msg += `Volume (24h): $${volume}\n`;
  if (holders !== '-') msg += `Holders: ${holders}\n`;
  if (age !== '-') msg += `Age (min): ${age}\n`;
  msg += `Verified: ${verified ? '✅' : '❌'}\n`;
  if (token.description) {
    msg += `\n<em>${token.description.substring(0, 180)}</em>\n`;
  }
  // روابط مهمة فقط
  let links: string[] = [];
  if (Array.isArray(token.links)) {
    for (const l of token.links) {
      if (l.type === 'twitter' && l.url) links.push(`<a href='${l.url}'>🐦 Twitter</a>`);
      if (l.type === 'telegram' && l.url) links.push(`<a href='${l.url}'>💬 Telegram</a>`);
      if (l.label && l.url && l.type !== 'twitter' && l.type !== 'telegram') links.push(`<a href='${l.url}'>${l.label}</a>`);
    }
  }
  if (dexUrl) links.unshift(`<a href='${dexUrl}'>View on DexScreener</a>`);
  links.push(`<a href='${inviteUrl}'>Share via Bot</a>`);
  // لا تعرض الروابط إذا كانت كلها فارغة
  links = links.filter(l => l && !l.includes('undefined') && !l.includes('null'));
  msg += links.length ? links.join(' | ') + '\n' : '';
  return msg;
}

export async function notifyUsers(bot: any, users: Record<string, any>, tokens: any[]) {
  for (const uid of Object.keys(users)) {
    const strategy: Strategy = getOrRegisterUser(ctx)?.strategy || {};
    const filtered = filterTokensByStrategy(tokens, strategy);
    if (filtered.length > 0 && bot) {
      for (const token of filtered) {
        const chain = (token.chainId || token.chain || token.chainName || '').toString().toLowerCase();
        if (chain && !chain.includes('sol')) continue;
        let botUsername = (bot && bot.botInfo && bot.botInfo.username) ? bot.botInfo.username : (process.env.BOT_USERNAME || 'YourBotUsername');
        const address = token.tokenAddress || token.address || token.mint || token.pairAddress || 'N/A';
        const pairAddress = token.pairAddress || address;
        const msg = buildTokenMessage(token, botUsername, pairAddress);
        const inlineKeyboard = [
          [
            { text: '🟢 Buy', url: `${process.env.DEXSCREENER_BASE_URL || 'https://dexscreener.com/solana'}/${pairAddress}` },
            { text: '👁️ Watch', url: `${process.env.DEXSCREENER_BASE_URL || 'https://dexscreener.com/solana'}/${pairAddress}` },
            { text: '📈 View Chart', url: `${process.env.DEXSCREENER_BASE_URL || 'https://dexscreener.com/solana'}/${pairAddress}` }
          ],
          [
            { text: '⚙️ Edit Settings', callback_data: `edit_settings_${uid}` },
            { text: '🆕 New Only', callback_data: `new_only_${uid}` },
            { text: '⏹️ Stop Strategy', callback_data: `stop_strategy_${uid}` },
            { text: '▶️ Start Strategy', callback_data: `start_strategy_${uid}` },
            { text: '🔙 Back', callback_data: `back_${uid}` }
          ]
        ];
        await bot.telegram.sendMessage(uid, msg, {
          parse_mode: 'HTML',
          disable_web_page_preview: false,
          reply_markup: { inline_keyboard: inlineKeyboard }
        });
      }
    }
  }
}

// ...يمكنك إعادة إضافة دوال Solana السابقة هنا إذا كانت لازالت مطلوبة في المشروع...
