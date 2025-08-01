// Smart field-specific formatting for token stats
function fmtField(val: number | string | undefined | null, field: string): string {
  if (val === undefined || val === null) return '-';
  let num = typeof val === 'number' ? val : Number(val);
  if (isNaN(num)) return String(val);
  switch (field) {
    case 'price':
      if (Math.abs(num) >= 1) return num.toLocaleString(undefined, { maximumFractionDigits: 4 });
      if (Math.abs(num) >= 0.01) return num.toLocaleString(undefined, { maximumFractionDigits: 6 });
      return num.toLocaleString(undefined, { maximumFractionDigits: 8 });
    case 'marketCap':
    case 'liquidity':
    case 'volume':
      return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
    case 'holders':
    case 'age':
      return Math.round(num).toLocaleString();
    default:
      return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
}
import axios from 'axios';
import { Strategy } from '../bot/types';

// ========== General Constants ==========
const EMPTY_VALUES = [undefined, null, '-', '', 'N/A', 'null', 'undefined'];

// Unified field map (easily extendable)
const FIELD_MAP: Record<string, string[]> = {
  marketCap: [
    'marketCap', 'fdv', 'totalAmount', 'baseToken.marketCap', 'baseToken.fdv', 'baseToken.totalAmount',
    'market_cap', 'market_cap_usd', 'market_capitalization', 'baseToken.market_cap', 'baseToken.market_cap_usd',
    'marketCapUsd', 'baseToken.marketCapUsd', 'market_capitalization_usd', 'baseToken.market_capitalization_usd'
  ],
  liquidity: [
    'liquidity', 'liquidityUsd', 'baseToken.liquidity', 'liquidity.usd', 'baseToken.liquidity.usd',
    'liquidityUSD', 'baseToken.liquidityUSD', 'liquidity_usd', 'baseToken.liquidity_usd',
    'reserve', 'baseToken.reserve', 'reserve_usd', 'baseToken.reserve_usd'
  ],
  volume: [
    'volume', 'volume24h', 'amount', 'baseToken.volume', 'baseToken.volume24h',
    'volume.h24', 'baseToken.volume.h24', 'volumeUSD', 'baseToken.volumeUSD',
    'volume_usd', 'baseToken.volume_usd', 'totalVolume', 'baseToken.totalVolume',
    'total_volume', 'baseToken.total_volume', 'total_volume_usd', 'baseToken.total_volume_usd'
  ],
  holders: [
    'holders', 'baseToken.holders', 'numHolders', 'baseToken.numHolders',
    'holdersCount', 'baseToken.holdersCount', 'holders_count', 'baseToken.holders_count'
  ],
  age: [
    'age', 'genesis_date', 'pairCreatedAt', 'createdAt', 'baseToken.createdAt',
    'created_at', 'baseToken.created_at', 'launchDate', 'baseToken.launchDate',
    'launch_date', 'baseToken.launch_date', 'timestamp', 'baseToken.timestamp'
  ]
};

const missingFieldsLog: Set<string> = new Set();



// Extract field value (supports nested paths)
export function getField(token: any, ...fields: string[]): any {
  for (let f of fields) {
    const mapped = FIELD_MAP[f] || [f];
    for (const mf of mapped) {
      const path = mf.split('.');
      let val = token;
      for (const key of path) {
        if (val == null) break;
        val = val[key];
      }
      if (!EMPTY_VALUES.includes(val)) return val;
      if (mf in token && !EMPTY_VALUES.includes(token[mf])) return token[mf];
    }
  }
  // If the field is an object, extract the first numeric value
  for (let f of fields) {
    const mapped = FIELD_MAP[f] || [f];
    for (const mf of mapped) {
      let val = token[mf];
      if (typeof val === 'object' && val !== null) {
        if (Array.isArray(val)) {
          const num = val.find(v => typeof v === 'number' && !isNaN(v));
          if (num !== undefined) return num;
        } else {
          for (const k in val) {
            if (typeof val[k] === 'number' && !isNaN(val[k])) return val[k];
          }
        }
      }
    }
  }
  if (fields.length > 0) missingFieldsLog.add(fields[0]);
  return undefined;
}

// Extract a number from any value (helper)
function extractNumeric(val: any, fallback?: number): number | undefined {
  if (typeof val === 'number' && !isNaN(val)) return val;
  if (typeof val === 'string' && !isNaN(Number(val))) return Number(val);
  if (val && typeof val === 'object') {
    for (const k of ['usd','h24','amount','value','total','native','sol']) {
      if (typeof val[k] === 'number' && !isNaN(val[k])) return val[k];
    }
    for (const k in val) if (typeof val[k] === 'number' && !isNaN(val[k])) return val[k];
  }
  return fallback;
}


export async function retryAsync<T>(fn: () => Promise<T>, retries = 3, delayMs = 2000): Promise<T> {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const retryAfter = err?.response?.headers?.['retry-after'];
      const wait = retryAfter ? Number(retryAfter) * 1000 : delayMs;
      if (i < retries - 1) await new Promise(res => setTimeout(res, wait));
    }
  }
  throw lastErr;
}


// ========== Fetch token data from CoinGecko and DexScreener ==========
export async function fetchSolanaFromCoinGecko(): Promise<any> {
  const url = 'https://api.coingecko.com/api/v3/coins/solana';
  try {
    return await retryAsync(async () => {
      const response = await axios.get(url);
      const data = response.data;
      return {
        name: data.name,
        symbol: data.symbol,
        priceUsd: data.market_data?.current_price?.usd,
        marketCap: data.market_data?.market_cap?.usd,
        volume: data.market_data?.total_volume?.usd,
        holders: data.community_data?.facebook_likes || '-',
        age: data.genesis_date,
        verified: true,
        description: data.description?.en,
        imageUrl: data.image?.large,
        links: [
          ...(data.links?.homepage?.[0] ? [{ label: 'Website', url: data.links.homepage[0], type: 'website' }] : []),
          ...(data.links?.twitter_screen_name ? [{ label: 'Twitter', url: `https://twitter.com/${data.links.twitter_screen_name}`, type: 'twitter' }] : []),
          ...(data.links?.subreddit ? [{ label: 'Reddit', url: `https://reddit.com${data.links.subreddit}`, type: 'reddit' }] : []),
        ],
        address: 'N/A',
        pairAddress: 'N/A',
        url: data.links?.blockchain_site?.[0] || '',
      };
    }, 3, 3000);
  } catch (err) {
    console.error('CoinGecko fetch error:', err);
    return null;
  }
}


// ========== User-editable fields (for strategies) ==========



/**
 * STRATEGY_FIELDS: Only user-editable filter fields (used for filtering tokens)
 * Users can only set these fields in their strategy.
 */
export type StrategyField = { key: string; label: string; type: string; optional: boolean; tokenField?: string };
export let STRATEGY_FIELDS: StrategyField[] = [
  { key: 'minMarketCap', label: 'Minimum Market Cap (USD)', type: 'number', optional: false, tokenField: 'marketCap' },
  { key: 'minLiquidity', label: 'Minimum Liquidity (USD)', type: 'number', optional: false, tokenField: 'liquidity' },
  { key: 'minVolume', label: 'Minimum Volume (24h USD)', type: 'number', optional: false, tokenField: 'volume' },
  { key: 'minHolders', label: 'Minimum Holders', type: 'number', optional: true, tokenField: 'holders' },
  { key: 'minAge', label: 'Minimum Age (minutes)', type: 'number', optional: false, tokenField: 'age' }
];


// ========== DexScreener API Integration ==========
export async function fetchDexScreenerProfiles(): Promise<any[]> {
  const url = 'https://api.dexscreener.com/token-profiles/latest/v1';
  try {
    const response = await axios.get(url);
    return Array.isArray(response.data) ? response.data : [];
  } catch (err) {
    console.error('DexScreener token-profiles fetch error:', err);
    return [];
  }
}

export async function fetchDexScreenerPairsForSolanaTokens(tokenAddresses: string[]): Promise<any[]> {
  const chainId = 'solana';
  const allPairs: any[] = [];
  for (const tokenAddress of tokenAddresses) {
    const url = `https://api.dexscreener.com/token-pairs/v1/${chainId}/${tokenAddress}`;
    try {
      const response = await axios.get(url);
      if (Array.isArray(response.data)) {
        allPairs.push(...response.data);
      }
    } catch (err) {
      // Ignore individual errors
    }
  }
  return allPairs;
}

export async function fetchDexScreenerTokens(): Promise<any[]> {
  // 1. Fetch all Solana tokens from token-profiles
  const profiles = await fetchDexScreenerProfiles();
  // Only Solana tokens
  const solanaProfiles = profiles.filter((t: any) => t.chainId === 'solana');
  // 2. Fetch pairs (market data) for each Solana token
  const tokenAddresses = solanaProfiles.map((t: any) => t.tokenAddress).filter(Boolean);
  const pairs = await fetchDexScreenerPairsForSolanaTokens(tokenAddresses);

  // 3. Merge data: for each token, merge profile with pairs (market data)
  const allTokens: Record<string, any> = {};
  for (const profile of solanaProfiles) {
    const addr = profile.tokenAddress;
    if (!addr) continue;
    allTokens[addr] = { ...profile };
  }
  // Add pairs (market data)
  for (const pair of pairs) {
    // Each pair has baseToken.address
    const addr = getField(pair, 'baseToken.address', 'tokenAddress', 'address', 'mint', 'pairAddress');
    if (!addr) continue;
    if (!allTokens[addr]) allTokens[addr] = {};
    // Merge pair data with token
    for (const key of Object.keys(FIELD_MAP)) {
      if (allTokens[addr][key] === undefined || EMPTY_VALUES.includes(allTokens[addr][key])) {
        const val = getField(pair, key);
        if (!EMPTY_VALUES.includes(val)) allTokens[addr][key] = val;
      }
    }
    // Get some fields from baseToken if missing
    if (pair.baseToken && typeof pair.baseToken === 'object') {
      for (const key of Object.keys(FIELD_MAP)) {
        if (allTokens[addr][key] === undefined || EMPTY_VALUES.includes(allTokens[addr][key])) {
          const val = getField(pair.baseToken, key);
          if (!EMPTY_VALUES.includes(val)) allTokens[addr][key] = val;
        }
      }
    }
    // liquidity: may be in pair.liquidity.usd or pair.liquidity
    if ((allTokens[addr].liquidity === undefined || EMPTY_VALUES.includes(allTokens[addr].liquidity)) && pair.liquidity) {
      if (typeof pair.liquidity === 'object' && typeof pair.liquidity.usd === 'number') allTokens[addr].liquidity = pair.liquidity.usd;
      else if (typeof pair.liquidity === 'number') allTokens[addr].liquidity = pair.liquidity;
    }
    // priceUsd
    if ((allTokens[addr].priceUsd === undefined || EMPTY_VALUES.includes(allTokens[addr].priceUsd)) && pair.priceUsd) {
      allTokens[addr].priceUsd = pair.priceUsd;
    }
    // marketCap
    if ((allTokens[addr].marketCap === undefined || EMPTY_VALUES.includes(allTokens[addr].marketCap)) && pair.fdv) {
      allTokens[addr].marketCap = pair.fdv;
    }
    if ((allTokens[addr].marketCap === undefined || EMPTY_VALUES.includes(allTokens[addr].marketCap)) && pair.marketCap) {
      allTokens[addr].marketCap = pair.marketCap;
    }
  }

  // 4. If not enough data, use CoinGecko fallback (same logic as before)
  let cgTokens: any[] = [];
  let coinGeckoFailed = false;
  if (Object.keys(allTokens).length === 0) {
    try {
      const solanaToken = await fetchSolanaFromCoinGecko();
      if (solanaToken) cgTokens.push(solanaToken);
      const listUrl = 'https://api.coingecko.com/api/v3/coins/list?include_platform=true';
      const listResponse = await retryAsync(() => axios.get(listUrl), 3, 3000);
      const allTokensList = listResponse.data;
      const solanaTokens = allTokensList.filter((t: any) => t.platforms && t.platforms.solana);
      const limited = solanaTokens.slice(0, 10);
      const details = await Promise.all(limited.map(async (t: any) => {
        try {
          const url = `https://api.coingecko.com/api/v3/coins/${t.id}`;
          const response = await retryAsync(() => axios.get(url), 3, 3000);
          const data = response.data;
          return {
            name: data.name,
            symbol: data.symbol,
            priceUsd: data.market_data?.current_price?.usd,
            marketCap: data.market_data?.market_cap?.usd,
            volume: data.market_data?.total_volume?.usd,
            holders: data.community_data?.facebook_likes || '-',
            age: data.genesis_date,
            verified: true,
            description: data.description?.en,
            imageUrl: data.image?.large,
            links: [
              ...(data.links?.homepage?.[0] ? [{ label: 'Website', url: data.links.homepage[0], type: 'website' }] : []),
              ...(data.links?.twitter_screen_name ? [{ label: 'Twitter', url: `https://twitter.com/${data.links.twitter_screen_name}`, type: 'twitter' }] : []),
              ...(data.links?.subreddit ? [{ label: 'Reddit', url: `https://reddit.com${data.links.subreddit}`, type: 'reddit' }] : []),
            ],
            address: t.platforms.solana,
            pairAddress: t.platforms.solana,
            url: data.links?.blockchain_site?.[0] || '',
          };
        } catch (err) {
          return null;
        }
      }));
      cgTokens = cgTokens.concat(details.filter(Boolean));
    } catch (err) {
      coinGeckoFailed = true;
      console.error('CoinGecko Solana tokens fetch error:', err);
    }
    if (coinGeckoFailed || cgTokens.length === 0) {
      console.warn('CoinGecko unavailable, no tokens fetched.');
      cgTokens = [];
    }
    // Add them to allTokens
    for (const t of cgTokens) {
      const addr = t.address || t.tokenAddress || t.mint || t.pairAddress;
      if (!addr) continue;
      allTokens[addr] = { ...t };
    }
  }
  return Object.values(allTokens);
}

// ========== Formatting and display functions ==========
export function fmt(val: number | string | undefined | null, digits?: number, unit?: string): string {
  if (val === undefined || val === null) return '-';
  let num = typeof val === 'number' ? val : Number(val);
  if (isNaN(num)) return String(val);
  let usedDigits = digits !== undefined ? digits : (Math.abs(num) < 1 ? 6 : 2);
  let str = num.toLocaleString(undefined, { maximumFractionDigits: usedDigits });
  if (unit) str += ' ' + unit;
  return str;
}



// --- Helper functions for building the message ---
function getTokenCoreFields(token: any) {
  return {
    name: token.name || token.baseToken?.name || '',
    symbol: token.symbol || token.baseToken?.symbol || '',
    address: token.tokenAddress || token.address || token.mint || token.pairAddress || token.url?.split('/').pop() || '',
    dexUrl: token.url || (token.pairAddress ? `https://dexscreener.com/solana/${token.pairAddress}` : ''),
    logo: token.imageUrl || token.logoURI || token.logo || token.baseToken?.logoURI || ''
  };
}

function getTokenStats(token: any) {
  const price = extractNumeric(getField(token, 'priceUsd', 'price', 'baseToken.priceUsd', 'baseToken.price'), 0);
  const marketCap = extractNumeric(getField(token, 'marketCap'));
  const liquidity = extractNumeric(getField(token, 'liquidity'));
  const volume = extractNumeric(getField(token, 'volume'));
  const holders = extractNumeric(getField(token, 'holders'));
  let age = getField(token, 'age', 'genesis_date', 'pairCreatedAt');
  let ageMinutes: number | string = '-';
  if (typeof age === 'string') age = Number(age);
  if (typeof age === 'number' && !isNaN(age)) {
    if (age > 1e12) ageMinutes = Math.floor((Date.now() - age) / 60000);
    else if (age > 1e9) ageMinutes = Math.floor((Date.now() - age * 1000) / 60000);
    else if (age < 1e7 && age > 0) ageMinutes = age;
  }
  return { price, marketCap, liquidity, volume, holders, ageMinutes };
}

function getTokenBuySell(token: any) {
  const buyVol = extractNumeric(token.buyVolume || token.buy_volume || token.volumeBuy || token.volume_buy);
  const sellVol = extractNumeric(token.sellVolume || token.sell_volume || token.volumeSell || token.volume_sell);
  return { buyVol, sellVol };
}

function buildInlineKeyboard(token: any, botUsername: string, pairAddress: string, userId?: string) {
  const dexUrl = token.url || (pairAddress ? `https://dexscreener.com/solana/${pairAddress}` : '');
  const webEmoji = '🌐', twitterEmoji = '🐦', tgEmoji = '💬', chartBtnEmoji = '📊', dexEmoji = '🧪', copyEmoji = '📋';
  const inlineKeyboard: any[][] = [];
  const row1: any[] = [];
  if (dexUrl) row1.push({ text: `${dexEmoji} DexScreener`, url: dexUrl });
  if (Array.isArray(token.links)) {
    for (const l of token.links) {
      if (l.type === 'website' && l.url) row1.push({ text: `${webEmoji} Website`, url: l.url });
      if (l.type === 'twitter' && l.url) row1.push({ text: `${twitterEmoji} Twitter`, url: l.url });
      if (l.type === 'telegram' && l.url) row1.push({ text: `${tgEmoji} Telegram`, url: l.url });
    }
  }
  if (row1.length) inlineKeyboard.push(row1);
  const row2: any[] = [];
  if (dexUrl) row2.push({ text: `${chartBtnEmoji} Chart`, url: dexUrl });
  let shareId = userId || token._userId || (token.tokenAddress || token.address || token.mint || token.pairAddress || '');
  const shareUrl = `https://t.me/${botUsername}?start=${shareId}`;
  row2.push({ text: `${copyEmoji} Share`, url: shareUrl });
  if (row2.length) inlineKeyboard.push(row2);
  return { inlineKeyboard, shareUrl };
}

function buildExtraFields(token: any) {
  // إضافة الحقول غير المفيدة إلى قائمة التجاهل
  const skipFields = new Set([
    'name','baseToken','tokenAddress','address','mint','pairAddress','url','imageUrl','logoURI','logo','links','description','symbol','priceUsd','price','marketCap','liquidity','volume','holders','age','genesis_date','pairCreatedAt',
    'icon','header','openGraph' // الحقول غير المفيدة
  ]);
  let msg = '';
  for (const key of Object.keys(token)) {
    if (skipFields.has(key)) continue;
    let value = token[key];
    if (value === undefined || value === null || value === '' || value === '-' || value === 'N/A' || value === 'null' || value === 'undefined') continue;
    if (typeof value === 'number') {
      msg += `<b>${key}:</b> ${fmt(value, 6)}\n`;
    } else if (typeof value === 'string') {
      // لا تعرض أي روابط صور أو صور
      if (/^https?:\/\/.*\.(png|jpg|jpeg|gif|webp)$/i.test(value)) {
        continue;
      } else if (/^https?:\/.*/.test(value)) {
        // إذا كان رابط، اعرضه كرابط على رمز تعبيري فقط
        msg += `<b>${key}:</b> <a href='${value}'>🔗</a>\n`;
      } else {
        msg += `<b>${key}:</b> ${value}\n`;
      }
    } else if (typeof value === 'boolean') {
      msg += `<b>${key}:</b> ${value ? '✅' : '❌'}\n`;
    } else if (typeof value === 'object') {
      const numVal = extractNumeric(value);
      if (numVal !== undefined) {
        msg += `<b>${key}:</b> ${fmt(numVal, 6)}\n`;
      } else if (Array.isArray(value) && value.every(v => typeof v === 'string')) {
        msg += `<b>${key}:</b> ${value.join(', ')}\n`;
      }
    }
  }
  return msg;
}

export function buildTokenMessage(token: any, botUsername: string, pairAddress: string, userId?: string): { msg: string, inlineKeyboard: any[][] } {
  const { name, symbol, address, dexUrl, logo } = getTokenCoreFields(token);
  const { price, marketCap, liquidity, volume, holders, ageMinutes } = getTokenStats(token);
  const { buyVol, sellVol } = getTokenBuySell(token);
  // --- Emojis ---
  const solEmoji = '🟣', memecoinEmoji = '🚀', chartEmoji = '📈', capEmoji = '💰', liqEmoji = '💧', volEmoji = '🔊', holdersEmoji = '👥', ageEmoji = '⏱️', linkEmoji = '🔗';
  // --- Message header ---
  let msg = '';
  // فقط رمز تعبيري للعملة (بدون صورة أو رابط صورة)
  msg += `🪙`;
  msg += `<b>${solEmoji} ${name}${symbol ? ' <code>' + symbol + '</code>' : ''}</b>\n`;
  msg += `<b>${linkEmoji} Address:</b> <code>${address}</code>\n`;
  // --- الإحصائيات ---
  msg += `${capEmoji} <b>Market Cap:</b> ${fmtField(marketCap, 'marketCap')} USD\n`;
  msg += `${liqEmoji} <b>Liquidity:</b> ${fmtField(liquidity, 'liquidity')} USD  `;
  if (liquidity !== undefined && marketCap && marketCap > 0) {
    const liqPct = Math.min(100, Math.round((liquidity / marketCap) * 100));
    msg += progressBar(liqPct, 10, '🟦', '⬜') + ` ${liqPct}%\n`;
  } else {
    msg += '\n';
  }
  msg += `${volEmoji} <b>Volume 24h:</b> ${fmtField(volume, 'volume')} USD  `;
  if (volume !== undefined && marketCap && marketCap > 0) {
    const volPct = Math.min(100, Math.round((volume / marketCap) * 100));
    msg += progressBar(volPct, 10, '🟩', '⬜') + ` ${volPct}%\n`;
  } else {
    msg += '\n';
  }
  msg += `${holdersEmoji} <b>Holders:</b> ${fmtField(holders, 'holders')}\n`;
  msg += `${ageEmoji} <b>Age:</b> ${fmtField(ageMinutes, 'age')} min\n`;
  msg += `${chartEmoji} <b>Price:</b> ${fmtField(price, 'price')} USD\n`;
  // --- Buy/Sell progress bar ---
  if (buyVol !== undefined || sellVol !== undefined) {
    const totalVol = (buyVol || 0) + (sellVol || 0);
    if (totalVol > 0) {
      const buyPct = Math.round((buyVol || 0) / totalVol * 100);
      const sellPct = 100 - buyPct;
      msg += `🟢 Buy:  ${progressBar(buyPct, 10, '🟩', '⬜')} ${buyPct}%\n`;
      msg += `🔴 Sell: ${progressBar(sellPct, 10, '🟥', '⬜')} ${sellPct}%\n`;
    }
  }
  // --- Extra fields ---
  msg += buildExtraFields(token);
  // --- Description ---
  if (token.description) msg += `\n<em>${token.description}</em>\n`;

  // --- روابط العملة الفعلية بشكل احترافي في سطر منفصل أسفل الرسالة ---
  let linksBlock = '';

  if (Array.isArray(token.links)) {
    for (const l of token.links) {
      if (l.type === 'website' && l.url) linksBlock += `<a href='${l.url}'>🌐</a> `;
      if (l.type === 'twitter' && l.url) linksBlock += `<a href='${l.url}'>🐦</a> `;
      if (l.type === 'telegram' && l.url) linksBlock += `<a href='${l.url}'>💬</a> `;
      if (l.type === 'reddit' && l.url) linksBlock += `<a href='${l.url}'>👽</a> `;
    }
  }
  if (dexUrl) linksBlock += `<a href='${dexUrl}'>🧪</a> `;
  if (linksBlock) msg += `\n${linksBlock.trim()}\n`;

  // --- زر مشاركة احترافي في سطر منفصل أسفل الرسالة ---
  const { inlineKeyboard, shareUrl } = buildInlineKeyboard(token, botUsername, pairAddress, userId);
  msg += `\n<a href='${shareUrl}'>📋</a>\n`;

  msg += `\n${memecoinEmoji} <b>Solana Memecoin Community</b> | ${solEmoji} <b>Powered by DexScreener</b>\n`;
  return { msg, inlineKeyboard };
}


function progressBar(percent: number, size = 10, fill = '█', empty = '░') {
  const filled = Math.round((percent / 100) * size);
  return fill.repeat(filled) + empty.repeat(size - filled);
}


// Notify users with matching tokens (always uses autoFilterTokens)
export async function notifyUsers(bot: any, users: Record<string, any>, tokens: any[]) {
  for (const uid of Object.keys(users)) {
    const strategy: Strategy = users[uid]?.strategy || {};
    const filtered = autoFilterTokens(tokens, strategy);
    if (filtered.length > 0 && bot) {
      for (const token of filtered) {
        const chain = (token.chainId || token.chain || token.chainName || '').toString().toLowerCase();
        if (chain && !chain.includes('sol')) continue;
        let botUsername = (bot && bot.botInfo && bot.botInfo.username) ? bot.botInfo.username : (process.env.BOT_USERNAME || 'YourBotUsername');
        const address = token.tokenAddress || token.address || token.mint || token.pairAddress || 'N/A';
        const pairAddress = token.pairAddress || address;
        const { msg, inlineKeyboard } = buildTokenMessage(token, botUsername, pairAddress);
        // Extra protection: if msg is not a string, skip sending
        if (typeof msg !== 'string') {
          await bot.telegram.sendMessage(uid, '⚠️ We are still looking for the gems you want.');
          continue;
        }
        await bot.telegram.sendMessage(uid, msg, {
          parse_mode: 'HTML',
          disable_web_page_preview: false,
          reply_markup: { inline_keyboard: inlineKeyboard }
        });
      }
    } else if (bot) {
      await bot.telegram.sendMessage(
        uid,
        'No tokens currently match your strategy.\n\nYour strategy filters may be too strict for the available data from DexScreener.\n\nTry lowering requirements like liquidity, market cap, volume, age, or holders, then try again.',
        {
          parse_mode: 'HTML',
          disable_web_page_preview: true
        }
      );
    }
  }
}


// Unified token filtering by strategy
export function autoFilterTokens(tokens: any[], strategy: Record<string, any>): any[] {
  return tokens.filter(token => {
    for (const field of STRATEGY_FIELDS) {
      if (!field.tokenField || !(field.key in strategy)) continue;
      const value = strategy[field.key];
      if (field.type === "number" && (value === undefined || value === null || Number(value) === 0)) continue;
      let tokenValue = getField(token, field.tokenField);
      // Special cases support
      if (field.tokenField === 'liquidity' && tokenValue && typeof tokenValue === 'object' && typeof tokenValue.usd === 'number') {
        tokenValue = tokenValue.usd;
      }
      if (field.tokenField === 'volume' && tokenValue && typeof tokenValue === 'object' && typeof tokenValue.h24 === 'number') {
        tokenValue = tokenValue.h24;
      }
      if (field.tokenField === 'age') {
        let ageVal = tokenValue;
        if (typeof ageVal === 'string') ageVal = Number(ageVal);
        if (ageVal > 1e12) {
          tokenValue = Math.floor((Date.now() - ageVal) / 60000);
        } else if (ageVal > 1e9) {
          tokenValue = Math.floor((Date.now() - ageVal * 1000) / 60000);
        }
      }
      const numValue = Number(value);
      const numTokenValue = Number(tokenValue);
      if (isNaN(numTokenValue)) {
        if (field.tokenField === 'holders' && (!numValue || numValue === 0)) {
          continue;
        }
        if (!field.optional) {
          return false;
        } else {
          continue;
        }
      }
      if (field.type === "number") {
        if (field.key.startsWith("min") && !isNaN(numValue)) {
          if (numTokenValue < numValue) {
            return false;
          }
        }
        if (field.key.startsWith("max") && !isNaN(numValue)) {
          if (numTokenValue > numValue) {
            return false;
          }
        }
      }
      if (field.type === "boolean" && typeof value === "boolean") {
        if (value === true && !tokenValue) {
          return false;
        }
        if (value === false && tokenValue) {
          return false;
        }
      }
    }
    return true;
  });
}
