import axios from 'axios';
import { filterTokensByStrategy } from '../bot/strategy';
import { Strategy } from '../bot/types';
/**
 * Extract a field value from multiple sources, supports nested paths like 'baseToken.name'.
 * @param token Token object
 * @param fields List of fields to search for (supports paths like 'baseToken.name')
 * @returns First valid value found
 */


// List of values considered empty or invalid
const EMPTY_VALUES = [undefined, null, '-', '', 'N/A', 'null', 'undefined'];

// Map of essential fields for filtering (user-editable fields only)
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

// Log of missing fields (for debugging)
const missingFieldsLog: Set<string> = new Set();

/**
 * Extract a field value from an object with fallback and field mapping
 * Tries all possible paths, including nested, for robust extraction.
 * @param token Token object
 * @param fields List of fields (or unified name)
 * @returns First valid value or undefined
 */
export function getField(token: any, ...fields: string[]): any {
  for (let f of fields) {
    const mapped = FIELD_MAP[f] || [f];
    for (const mf of mapped) {
      // Try dot-path (nested)
      const path = mf.split('.');
      let val = token;
      for (const key of path) {
        if (val == null) break;
        val = val[key];
      }
      if (!EMPTY_VALUES.includes(val)) return val;
      // Try as direct property (for cases like 'liquidity.usd' as a flat key)
      if (mf in token && !EMPTY_VALUES.includes(token[mf])) return token[mf];
    }
  }
  // Fallback: if any field is an object, extract first numeric value inside
  for (let f of fields) {
    const mapped = FIELD_MAP[f] || [f];
    for (const mf of mapped) {
      let val = token[mf];
      if (typeof val === 'object' && val !== null) {
        // If array, find first number
        if (Array.isArray(val)) {
          const num = val.find(v => typeof v === 'number' && !isNaN(v));
          if (num !== undefined) return num;
        } else {
          // If object, find first number value
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

/**
 * General retry function for any async function
 * @param fn Function to execute
 * @param retries Number of attempts
 * @param delayMs Delay between attempts (ms)
 * @returns Result of the function or throws last error
 */
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


/**
 * Fetch Solana token details from CoinGecko
 * @returns {Promise<any>} Solana token object with all main fields
 */
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

export { filterTokensByStrategy };


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


// ========== DexScreener API Integration (NEW: /pairs endpoint) ========== //
/**
 * Fetch Solana tokens from DexScreener /pairs API (returns richer data)
 */
// Fetch token profiles (general info, links, images)
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

// Fetch pairs (market data) from token-pairs for each Solana token
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

/**
 * Merge all public sources (CoinGecko and DexScreener) into a unified list
 * @returns {Promise<any[]>} Array of merged Solana tokens
 */
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

/**
 * Format a number or string value for display
 * @param val Value to format
 * @param digits Number of decimal digits
 * @param unit Optional unit string
 * @returns {string} Formatted value
 */
export function fmt(val: number | string | undefined | null, digits = 2, unit?: string): string {
  if (val === undefined || val === null) return '-';
  let num = typeof val === 'number' ? val : Number(val);
  if (isNaN(num)) return String(val);
  let str = num.toLocaleString(undefined, { maximumFractionDigits: digits });
  if (unit) str += ' ' + unit;
  return str;
}


/**
 * Build a visually appealing, dynamic, and shareable token message for Telegram
 * @param token Token object
 * @param botUsername Telegram bot username
 * @param pairAddress Token pair address
 * @returns {string} Formatted message
 */
/**
 * Build a visually appealing, dynamic, and shareable token message for Telegram
 * Returns: { msg: string, inlineKeyboard: any[][] }
 */
export function buildTokenMessage(token: any, botUsername: string, pairAddress: string, userId?: string): { msg: string, inlineKeyboard: any[][] } {
  // --- Visually appealing, interactive, and community-friendly Solana/memecoin message ---
  // 1. Core fields
  const name = token.name || token.baseToken?.name || '';
  const symbol = token.symbol || token.baseToken?.symbol || '';
  const address = token.tokenAddress || token.address || token.mint || token.pairAddress || token.url?.split('/').pop() || '';
  const dexUrl = token.url || (pairAddress ? `https://dexscreener.com/solana/${pairAddress}` : '');
  const logo = token.imageUrl || token.logoURI || token.logo || token.baseToken?.logoURI || '';
  // --- Robust extraction for numeric fields (liquidity, volume, etc.) ---
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
  const price = extractNumeric(getField(token, 'priceUsd', 'price', 'baseToken.priceUsd', 'baseToken.price'), 0);
  const marketCap = extractNumeric(getField(token, 'marketCap'));
  const liquidity = extractNumeric(getField(token, 'liquidity'));
  const volume = extractNumeric(getField(token, 'volume'));
  const holders = extractNumeric(getField(token, 'holders'));
  let age = getField(token, 'age', 'genesis_date', 'pairCreatedAt');
  // Buy/Sell Volumes if available
  const buyVol = extractNumeric(token.buyVolume || token.buy_volume || token.volumeBuy || token.volume_buy);
  const sellVol = extractNumeric(token.sellVolume || token.sell_volume || token.volumeSell || token.volume_sell);
  // Age formatting
  let ageMinutes: number | string = '-';
  if (typeof age === 'string') age = Number(age);
  if (typeof age === 'number' && !isNaN(age)) {
    if (age > 1e12) ageMinutes = Math.floor((Date.now() - age) / 60000);
    else if (age > 1e9) ageMinutes = Math.floor((Date.now() - age * 1000) / 60000);
    else if (age < 1e7 && age > 0) ageMinutes = age;
  }

  // 2. Visual/emoji enhancements (improved)
  const solEmoji = '🟣';
  const memecoinEmoji = '🚀';
  const chartEmoji = '📈';
  const capEmoji = '💰';
  const liqEmoji = '💧';
  const volEmoji = '🔊';
  const holdersEmoji = '👥';
  const ageEmoji = '⏱️';
  const linkEmoji = '🔗';
  const copyEmoji = '📋';
  const buyEmoji = '🟢';
  const twitterEmoji = '🐦';
  const webEmoji = '🌐';
  const tgEmoji = '💬';
  const chartBtnEmoji = '📊';
  const dexEmoji = '🧪';

  // 3. Message header
  let msg = '';
  if (logo) {
    msg += `<a href='${dexUrl}'><img src='${logo}' width='80' height='80'/></a>\n`;
  }
  msg += `<b>${solEmoji} ${name}${symbol ? ' <code>' + symbol + '</code>' : ''}</b>\n`;
  msg += `<b>${linkEmoji} Address:</b> <code>${address}</code>\n`;

  // 4. Main stats (row, improved formatting)
  msg += `${capEmoji} <b>Market Cap:</b> ${fmt(marketCap, 2)} USD\n`;
  // Liquidity Progress Bar
  msg += `${liqEmoji} <b>Liquidity:</b> ${fmt(liquidity, 2)} USD  `;
  if (liquidity !== undefined && marketCap && marketCap > 0) {
    const liqPct = Math.min(100, Math.round((liquidity / marketCap) * 100));
    msg += progressBar(liqPct, 10, '🟦', '⬜') + ` ${liqPct}%\n`;
  } else {
    msg += '\n';
  }
  // Volume Progress Bar
  msg += `${volEmoji} <b>Volume 24h:</b> ${fmt(volume, 2)} USD  `;
  if (volume !== undefined && marketCap && marketCap > 0) {
    const volPct = Math.min(100, Math.round((volume / marketCap) * 100));
    msg += progressBar(volPct, 10, '🟩', '⬜') + ` ${volPct}%\n`;
  } else {
    msg += '\n';
  }
  msg += `${holdersEmoji} <b>Holders:</b> ${fmt(holders, 0)}\n`;
  msg += `${ageEmoji} <b>Age:</b> ${fmt(ageMinutes, 0, 'min')}\n`;
  msg += `${chartEmoji} <b>Price:</b> ${fmt(price, 6)} USD\n`;

  // Buy/Sell Volumes Progress
  if (buyVol !== undefined || sellVol !== undefined) {
    const totalVol = (buyVol || 0) + (sellVol || 0);
    if (totalVol > 0) {
      const buyPct = Math.round((buyVol || 0) / totalVol * 100);
      const sellPct = 100 - buyPct;
      msg += `🟢 Buy:  ${progressBar(buyPct, 10, '🟩', '⬜')} ${buyPct}%\n`;
      msg += `🔴 Sell: ${progressBar(sellPct, 10, '🟥', '⬜')} ${sellPct}%\n`;
    }
  }

  // 5. Show all other fields (auto, skip known/redundant, fix object/number display)
  const skipFields = new Set(['name','baseToken','tokenAddress','address','mint','pairAddress','url','imageUrl','logoURI','logo','links','description','symbol','priceUsd','price','marketCap','liquidity','volume','holders','age','genesis_date','pairCreatedAt']);
  for (const key of Object.keys(token)) {
    if (skipFields.has(key)) continue;
    let value = token[key];
    if (value === undefined || value === null || value === '' || value === '-' || value === 'N/A' || value === 'null' || value === 'undefined') continue;
    if (typeof value === 'number') {
      msg += `<b>${key}:</b> ${fmt(value, 6)}\n`;
    } else if (typeof value === 'string') {
      // If looks like a URL to an image, show as image
      if (/^https?:\/\/.*\.(png|jpg|jpeg|gif|webp)$/i.test(value)) {
        msg += `<a href='${value}'><img src='${value}' width='60' height='60'/></a>\n`;
      } else {
        msg += `<b>${key}:</b> ${value}\n`;
      }
    } else if (typeof value === 'boolean') {
      msg += `<b>${key}:</b> ${value ? '✅' : '❌'}\n`;
    } else if (typeof value === 'object') {
      // Try to extract a number for display
      const numVal = extractNumeric(value);
      if (numVal !== undefined) {
        msg += `<b>${key}:</b> ${fmt(numVal, 6)}\n`;
      } else if (Array.isArray(value) && value.every(v => typeof v === 'string')) {
        msg += `<b>${key}:</b> ${value.join(', ')}\n`;
      }
    }
  }

  // 6. Description (if available)
  if (token.description) msg += `\n<em>${token.description}</em>\n`;


  // 7. Inline Keyboard Buttons (links)
  const inlineKeyboard: any[][] = [];
  // Row 1: DexScreener, Website, Twitter, Telegram
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
  // Row 2: Chart, Share
  const row2: any[] = [];
  if (dexUrl) row2.push({ text: `${chartBtnEmoji} Chart`, url: dexUrl });
  // Share link: use userId if provided, else address
  let shareId = userId || token._userId || address;
  const shareUrl = `https://t.me/${botUsername}?start=${shareId}`;
  row2.push({ text: `${copyEmoji} Share`, url: shareUrl });
  if (row2.length) inlineKeyboard.push(row2);

  // 8. Copy/share link (referral style, in message for clarity)
  msg += `${copyEmoji} <b>Share Link:</b> <code>${shareUrl}</code>\n`;

  // 9. Community/visual footer
  msg += `\n${memecoinEmoji} <b>Solana Memecoin Community</b> | ${solEmoji} <b>Powered by DexScreener</b>\n`;
  return { msg, inlineKeyboard };
}

// Helper: Progress bar as text
function progressBar(percent: number, size = 10, fill = '█', empty = '░') {
  const filled = Math.round((percent / 100) * size);
  return fill.repeat(filled) + empty.repeat(size - filled);
}
}

/**
 * Notify users with filtered tokens and interactive keyboard
 * @param bot Telegram bot instance
 * @param users Users object
 * @param tokens Array of tokens
 */
export async function notifyUsers(bot: any, users: Record<string, any>, tokens: any[]) {
  for (const uid of Object.keys(users)) {
    // Always use the user's real strategy
    const strategy: Strategy = users[uid]?.strategy || {};
    // Use robust autoFilterTokens for filtering
    const filtered = autoFilterTokens(tokens, strategy);
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
    } else if (bot) {
      await bot.telegram.sendMessage(
        uid,
        'لا توجد عملات مطابقة لاستراتيجيتك حالياً.\n\nقد تكون شروط الاستراتيجية صارمة جداً بالنسبة للبيانات المتاحة من DexScreener.\n\nجرب تقليل القيم المطلوبة مثل السيولة أو القيمة السوقية أو الحجم أو العمر أو عدد الحاملين، ثم أعد المحاولة.',
        {
          parse_mode: 'HTML',
          disable_web_page_preview: true
        }
      );
    }
  }
}


/**
 * Auto-filter tokens based on strategy settings and STRATEGY_FIELDS
 * Uses robust getField for all field extraction
 * @param tokens List of tokens
 * @param strategy Filtering settings
 * @returns Filtered list of tokens
 */
export function autoFilterTokens(tokens: any[], strategy: Record<string, any>): any[] {
  return tokens.filter(token => {
    for (const field of STRATEGY_FIELDS) {
      if (!field.tokenField || !(field.key in strategy)) continue;
      if (["buyAmount", "minPrice", "maxPrice"].includes(field.key)) continue;
      const value = strategy[field.key];
      if (field.type === "number" && (value === undefined || value === null || Number(value) === 0)) continue;
      let tokenValue = getField(token, field.tokenField);
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
