/**
 * Extract a field value from multiple sources, supports nested paths like 'baseToken.name'.
 * @param token Token object
 * @param fields List of fields to search for (supports paths like 'baseToken.name')
 * @returns First valid value found
 */
export function getField(token: any, ...fields: string[]): any {
  for (const f of fields) {
// Supports nested paths like 'baseToken.name'
    const path = f.split('.');
    let val = token;
    for (const key of path) {
      if (val == null) break;
      val = val[key];
    }
    if (val !== undefined && val !== null && val !== '-') return val;
  }
  return undefined;
}
import axios from 'axios';

/**
 * Fetch Solana token details from CoinGecko
 * @returns {Promise<any>} Solana token object with all main fields
 */
export async function fetchSolanaFromCoinGecko(): Promise<any> {
  const url = 'https://api.coingecko.com/api/v3/coins/solana';
  try {
    const response = await axios.get(url);
    const data = response.data;
    return {
      name: data.name,
      symbol: data.symbol,
      priceUsd: data.market_data?.current_price?.usd,
      marketCap: data.market_data?.market_cap?.usd,
      volume: data.market_data?.total_volume?.usd,
      // CoinGecko does not provide real holders count, only facebook_likes (for clarity)
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
  } catch (err) {
    console.error('CoinGecko fetch error:', err);
    return null;
  }
}
import { filterTokensByStrategy } from '../bot/strategy';
export { filterTokensByStrategy };
import { Strategy } from '../bot/types';

/**
 * STRATEGY_FIELDS: All available fields from market data
 */
export type StrategyField = { key: string; label: string; type: string; optional: boolean; tokenField?: string };
export let STRATEGY_FIELDS: StrategyField[] = [
  { key: 'minLiquidity', label: 'Minimum Liquidity (USD)', type: 'number', optional: false, tokenField: 'liquidity' },
  { key: 'minMarketCap', label: 'Minimum Market Cap (USD)', type: 'number', optional: false, tokenField: 'marketCap' },
  { key: 'minVolume', label: 'Minimum Volume (24h USD)', type: 'number', optional: false, tokenField: 'volume' },
  { key: 'minAge', label: 'Minimum Age (minutes)', type: 'number', optional: false, tokenField: 'age' },
  { key: 'minPrice', label: 'Minimum Price (USD)', type: 'number', optional: true, tokenField: 'priceUsd' },
  { key: 'maxPrice', label: 'Maximum Price (USD)', type: 'number', optional: true, tokenField: 'priceUsd' },
  { key: 'minHolders', label: 'Minimum Holders', type: 'number', optional: true, tokenField: 'holders' },
  { key: 'onlyVerified', label: 'Show only verified tokens', type: 'boolean', optional: true, tokenField: 'verified' },
  { key: 'minBoostAmount', label: 'Minimum Boost Amount', type: 'number', optional: true, tokenField: 'amount' },
  { key: 'minBoostTotal', label: 'Minimum Boost Total Amount', type: 'number', optional: true, tokenField: 'totalAmount' },
  { key: 'enabled', label: 'Strategy enabled', type: 'boolean', optional: true },
  { key: 'buyAmount', label: 'Buy Amount (SOL)', type: 'number', optional: false },
  { key: 'profitTargets', label: 'Profit Targets (%)', type: 'string', optional: true },
  { key: 'sellPercents', label: 'Sell Percentages (%)', type: 'string', optional: true },
  { key: 'stopLossPercent', label: 'Stop Loss (%)', type: 'number', optional: true },
];

/**
 * Fetch tokens from DexScreener API, filtered for Solana chain only
 * @returns {Promise<any[]>} Array of token objects
 */

// ========== DexScreener API Integration ========== //
/**
 * Fetch Solana tokens from DexScreener token-profiles API
 */
export async function fetchDexScreenerProfiles(): Promise<any[]> {
  const url = 'https://api.dexscreener.com/token-profiles/latest/v1';
  try {
    const response = await axios.get(url);
    // Filter for Solana chain only
    return response.data.filter((t: any) => t.chainId && t.chainId.toLowerCase().includes('sol'));
  } catch (err) {
    console.error('DexScreener token-profiles fetch error:', err);
    return [];
  }
}

/**
 * Fetch Solana tokens from DexScreener token-boosts API
 */
export async function fetchDexScreenerBoosts(): Promise<any[]> {
  const url = 'https://api.dexscreener.com/token-boosts/latest/v1';
  try {
    const response = await axios.get(url);
    // Filter for Solana chain only
    return response.data.filter((t: any) => t.chainId && t.chainId.toLowerCase().includes('sol'));
  } catch (err) {
    console.error('DexScreener token-boosts fetch error:', err);
    return [];
  }
}

/**
 * Merge all public sources (CoinGecko and DexScreener) into one unified list
 * @returns {Promise<any[]>} Array of merged Solana tokens
 */
export async function fetchDexScreenerTokens(): Promise<any[]> {


    // Fetch main Solana token from CoinGecko
    let cgTokens: any[] = [];
    let coinGeckoFailed = false;
    try {
        // Add main Solana token first
        const solanaToken = await fetchSolanaFromCoinGecko();
        if (solanaToken) cgTokens.push(solanaToken);
        // Then fetch other Solana tokens from CoinGecko
        const listUrl = 'https://api.coingecko.com/api/v3/coins/list?include_platform=true';
        const listResponse = await axios.get(listUrl);
        const allTokens = listResponse.data;
        const solanaTokens = allTokens.filter((t: any) => t.platforms && t.platforms.solana);
        const limited = solanaTokens.slice(0, 10);
        const details = await Promise.all(limited.map(async (t: any) => {
            try {
                const url = `https://api.coingecko.com/api/v3/coins/${t.id}`;
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
    // إذا فشل CoinGecko أو كانت القائمة فارغة، اعتمد فقط على DexScreener
    if (coinGeckoFailed || cgTokens.length === 0) {
        console.warn('CoinGecko unavailable, using DexScreener only.');
        cgTokens = [];
    }

    // Fetch DexScreener Profiles and Boosts
    let dsProfiles: any[] = [];
    let dsBoosts: any[] = [];
    try {
        dsProfiles = await fetchDexScreenerProfiles();
    } catch (err) {
        console.error('DexScreener Profiles fetch error:', err);
    }
    try {
        dsBoosts = await fetchDexScreenerBoosts();
    } catch (err) {
        console.error('DexScreener Boosts fetch error:', err);
    }

    // Smart merge: for each address, use getField to extract fields accurately from all sources
    const allTokens: Record<string, any> = {};
    // Collect all tokens from the three sources
    const allRaw = [...cgTokens, ...dsProfiles, ...dsBoosts];
    for (const t of allRaw) {
        const addr = getField(t, 'address', 'tokenAddress', 'mint', 'pairAddress');
        if (!addr) continue;
        if (!allTokens[addr]) allTokens[addr] = {};
        const base = allTokens[addr];
        // Extract main fields accurately
        base.address = addr;
        base.name = getField(base, 'name') ?? getField(t, 'name', 'baseToken.name');
        base.symbol = getField(base, 'symbol') ?? getField(t, 'symbol', 'baseToken.symbol');
        base.priceUsd = getField(base, 'priceUsd') ?? getField(t, 'priceUsd', 'price', 'priceNative', 'amount', 'baseToken.priceUsd', 'baseToken.price');
        base.marketCap = getField(base, 'marketCap') ?? getField(t, 'marketCap', 'fdv', 'totalAmount', 'baseToken.marketCap');
        base.volume = getField(base, 'volume') ?? getField(t, 'volume', 'volume24h', 'amount', 'baseToken.volume', 'baseToken.volume24h');
        // Liquidity
        base.liquidity = getField(base, 'liquidity') ?? getField(t, 'liquidity', 'liquidityUsd', 'baseToken.liquidity');
        base.holders = getField(base, 'holders') ?? getField(t, 'holders', 'baseToken.holders');
        base.age = getField(base, 'age') ?? getField(t, 'age', 'genesis_date');
        base.verified = getField(base, 'verified') ?? getField(t, 'verified', 'baseToken.verified');
        base.description = getField(base, 'description') ?? getField(t, 'description', 'baseToken.description');
        base.imageUrl = getField(base, 'imageUrl') ?? getField(t, 'imageUrl', 'icon', 'info.imageUrl');
        base.links = getField(base, 'links') ?? getField(t, 'links');
        base.pairAddress = getField(base, 'pairAddress') ?? getField(t, 'pairAddress', 'address', 'tokenAddress', 'mint');
        base.amount = getField(base, 'amount');
        base.totalAmount = getField(base, 'totalAmount');
        base.url = getField(base, 'url');
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
 * Build a formatted token message for Telegram
 * @param token Token object
 * @param botUsername Telegram bot username
 * @param pairAddress Token pair address
 * @returns {string} Formatted message
 */
export function buildTokenMessage(token: any, botUsername: string, pairAddress: string): string {
  // Extract name and symbol from fields, description, or links
  let name = token.name || token.baseToken?.name || '';
  let symbol = token.symbol || token.baseToken?.symbol || '';
  // If name or symbol not found, try extracting from description
  if ((!name || name === '') && typeof token.description === 'string') {
    const desc = token.description.trim();
    const match = desc.match(/([A-Z0-9]{3,})|\$([A-Z0-9]{2,})|\(([A-Z0-9]{2,})\)/);
    if (match) {
      name = match[1] || match[2] || match[3] || desc.split(' ')[0];
    } else {
      name = desc.split(' ')[0];
    }
  }
  if ((!symbol || symbol === '') && typeof token.description === 'string') {
    const desc = token.description.trim();
    const match = desc.match(/\$([A-Z0-9]{2,})|\(([A-Z0-9]{2,})\)/);
    if (match) {
      symbol = match[1] || match[2] || '';
    }
  }
  // If name or symbol still not found, try extracting from links
  if ((!name || name === '') && Array.isArray(token.links)) {
    for (const l of token.links) {
      if (l.label && l.label.length > 2) {
        name = l.label;
        break;
      }
      if (l.url && typeof l.url === 'string') {
        const urlMatch = l.url.match(/twitter\.com\/([A-Za-z0-9_]+)/);
        if (urlMatch) {
          name = urlMatch[1];
          break;
        }
        const siteMatch = l.url.match(/https?:\/\/(?:www\.)?([A-Za-z0-9_-]+)\./);
        if (siteMatch) {
          name = siteMatch[1];
          break;
        }
      }
    }
  }
  if ((!symbol || symbol === '') && Array.isArray(token.links)) {
    for (const l of token.links) {
      if (l.label && l.label.length <= 6 && l.label.match(/^[A-Z0-9]+$/)) {
        symbol = l.label;
        break;
      }
      if (l.url && typeof l.url === 'string') {
        const match = l.url.match(/twitter\.com\/([A-Z0-9]{2,6})/i);
        if (match) {
          symbol = match[1];
          break;
        }
      }
    }
  }
  // If name or symbol still empty, use token address
  if (!name || name === '') name = token.tokenAddress || token.pairAddress || token.address || '';
  if (!symbol) symbol = '';
  const address = token.tokenAddress || token.address || token.mint || token.pairAddress || token.url?.split('/').pop() || '';
  const priceRaw = token.priceUsd ?? token.price ?? token.priceNative ?? token.price ?? token.amount ?? (token.baseToken && (token.baseToken.priceUsd ?? token.baseToken.price));
  const priceUsd = fmt(priceRaw, 6);
  const marketCapRaw = token.marketCap ?? token.fdv ?? token.totalAmount ?? (token.baseToken && token.baseToken.marketCap);
  const marketCap = fmt(marketCapRaw);
  // Extract liquidity more accurately
  let liquidityRaw = undefined;
  if (token.liquidity && typeof token.liquidity === 'object') {
    if (typeof token.liquidity.usd === 'number') liquidityRaw = token.liquidity.usd;
    else if (typeof token.liquidity.base === 'number') liquidityRaw = token.liquidity.base;
    else if (typeof token.liquidity.quote === 'number') liquidityRaw = token.liquidity.quote;
  } else if (typeof token.liquidity === 'number') {
    liquidityRaw = token.liquidity;
  } else if (token.liquidityUsd && typeof token.liquidityUsd === 'number') {
    liquidityRaw = token.liquidityUsd;
  } else if (token.baseToken && typeof token.baseToken.liquidity === 'number') {
    liquidityRaw = token.baseToken.liquidity;
  }
  const liquidity = fmt(liquidityRaw);
  const holdersRaw = token.holders ?? (token.baseToken && token.baseToken.holders);
  const holders = fmt(holdersRaw);
  // Extract age more accurately
  let ageRaw = token.age;
  if (!ageRaw && token.pairCreatedAt) {
    const now = Date.now();
    const created = Number(token.pairCreatedAt);
    if (!isNaN(created) && created > 0) {
      ageRaw = Math.floor((now - created) / 60000); // بالدقائق
    }
  }
  if (!ageRaw && typeof token.description === 'string') {
    const desc = token.description;
    const match = desc.match(/launched\s*(\d+)\s*min|since\s*(\d+)\s*min/i);
    if (match) {
      ageRaw = Number(match[1] || match[2]);
    }
  }
  const age = fmt(ageRaw);
  const verified = (token.verified === true || token.verified === 'true' || (token.baseToken && (token.baseToken.verified === true || token.baseToken.verified === 'true')));
  const volumeRaw = token.volume ?? token.volume24h ?? token.amount ?? (token.baseToken && (token.baseToken.volume ?? token.baseToken.volume24h));
  const volume = fmt(volumeRaw);
  const boostAmount = token.amount !== undefined ? fmt(token.amount) : undefined;
  const boostTotal = token.totalAmount !== undefined ? fmt(token.totalAmount) : undefined;
  const dexUrl = token.url || (pairAddress ? `https://dexscreener.com/solana/${pairAddress}` : '');
  const inviteUrl = `https://t.me/${botUsername}?start=${address}`;

  // Project image (if available)
  let imageUrl = '';
  if (token.info?.imageUrl) imageUrl = token.info.imageUrl;
  else if (token.icon && typeof token.icon === 'string' && token.icon.startsWith('http')) imageUrl = token.icon;
  else if (token.imageUrl) imageUrl = token.imageUrl;

  // Accept token only if address, name/symbol, and price are present
  if (!address || !priceRaw || (!name && !symbol)) {
    return '<i>Token data is missing or incomplete.</i>';
  }

  // Build message (English, professional)
  let msg = '';
  msg += `<b>Token Information</b>\n`;
  msg += `<b>Name:</b> ${name}${symbol ? ` (${symbol})` : ''}\n`;
  msg += `<b>Address:</b> <code>${address}</code>\n`;
  msg += `<b>Price:</b> $${priceUsd}\n`;
  msg += `<b>Market Cap:</b> $${marketCap}\n`;
  if (liquidity !== '-') msg += `<b>Liquidity:</b> $${liquidity}\n`;
  if (volume !== '-') msg += `<b>Volume (24h):</b> $${volume}\n`;
  if (holders !== '-') msg += `<b>Holders:</b> ${holders}\n`;
  if (age !== '-') msg += `<b>Age (minutes):</b> ${age}\n`;
  if (boostAmount !== undefined) msg += `<b>Boost Amount:</b> ${boostAmount}\n`;
  if (boostTotal !== undefined) msg += `<b>Boost Total:</b> ${boostTotal}\n`;
  msg += `<b>Verified:</b> ${verified ? '✅' : '❌'}\n`;
  if (token.description) {
    msg += `\n<em>${token.description.substring(0, 180)}</em>\n`;
  }
  // Build links
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
  links = links.filter(l => l && !l.includes('undefined') && !l.includes('null'));
  msg += links.length ? links.join(' | ') + '\n' : '';
  return msg;
}

/**
 * Notify users with filtered tokens and interactive keyboard
 * @param bot Telegram bot instance
 * @param users Users object
 * @param tokens Array of tokens
 */
export async function notifyUsers(bot: any, users: Record<string, any>, tokens: any[]) {
  for (const uid of Object.keys(users)) {
    // Get strategy from user object directly
    const strategy: Strategy = users[uid]?.strategy || {};
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


// === Direct test commands for each part ===
/**
 * Auto-filter tokens based on strategy settings and STRATEGY_FIELDS
 * @param tokens List of tokens
 * @param strategy Filtering settings
 * @returns Filtered list of tokens
 */
export function autoFilterTokens(tokens: any[], strategy: Record<string, any>): any[] {
  return tokens.filter(token => {
    let hasAnyFilter = false;
    for (const field of STRATEGY_FIELDS) {
      if (!field.tokenField || !(field.key in strategy)) continue;
      if (["buyAmount", "minPrice", "maxPrice"].includes(field.key)) continue;
      const value = strategy[field.key];
      // إذا كانت قيمة الشرط 0، تجاهل الفلترة لهذا الحقل
      if (field.type === "number" && Number(value) === 0) continue;
      const tokenValue = token[field.tokenField];
      if (tokenValue === undefined || tokenValue === null || tokenValue === "-") continue;
      hasAnyFilter = true;
      if (field.type === "number") {
        if (field.key.startsWith("min") && typeof value === "number") {
          if (Number(tokenValue) < value) return false;
        }
        if (field.key.startsWith("max") && typeof value === "number") {
          if (Number(tokenValue) > value) return false;
        }
      }
      if (field.type === "boolean" && typeof value === "boolean") {
        if (value === true && !tokenValue) return false;
        if (value === false && tokenValue) return false;
      }
    }
    // إذا لم يوجد أي شرط فلترة قابل للتطبيق على العملة، اعتبرها ناجحة
    return true;
  });
}
if (require.main === module) {
  (async () => {
    // Test: Print strategy fields
    console.log('STRATEGY_FIELDS:', STRATEGY_FIELDS);

    // Test: Format number
    console.log('fmt(12345.6789, 2, "USD"):', fmt(12345.6789, 2, 'USD'));

    // Test: Build token message (CoinGecko Solana)
    try {
      const solanaToken = await fetchSolanaFromCoinGecko();
      if (solanaToken) {
        const msg = buildTokenMessage(solanaToken, 'TestBot', 'N/A');
        console.log('CoinGecko Solana buildTokenMessage:', msg);
      } else {
        console.log('No Solana token data from CoinGecko');
      }
    } catch (err) {
      console.error('Error building Solana token message:', err);
    }

    // Test: Fetch tokens (will print result or error)
    try {
      const tokens = await fetchDexScreenerTokens();
      console.log('Fetched tokens:', Array.isArray(tokens) ? tokens.length : tokens);
    } catch (err) {
      console.error('Error fetching tokens:', err);
    }
  })();
}
