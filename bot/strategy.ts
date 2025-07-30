// Simple filterTokensByStrategy implementation
import type { Strategy } from './types';

/**
 * Filters a list of tokens based on the user's strategy settings.
 * This is a basic example and should be customized for your real token structure.
 */
export function filterTokensByStrategy(tokens: any[], strategy: Strategy): any[] {
  if (!strategy || !Array.isArray(tokens)) return [];
  return tokens.filter(token => {
    // السعر بالدولار
    const price = Number(token.priceUsd ?? token.price ?? token.priceNative ?? 0);
    if (strategy.minPrice && price < strategy.minPrice) return false;
    if (strategy.maxPrice && price > strategy.maxPrice) return false;

    // ماركت كاب
    const marketCap = Number(token.marketCap ?? token.fdv ?? 0);
    if (strategy.minMarketCap && marketCap < strategy.minMarketCap) return false;

    // الهولدرز
    const holders = Number(token.holders ?? token.totalAmount ?? 0);
    if (strategy.minHolders && holders < strategy.minHolders) return false;

    // العمر بالدقائق
    const age = Number(token.age ?? 0);
    if (strategy.minAge && age < strategy.minAge) return false;

    // التوثيق
    const verified = token.verified === true || token.verified === 'true' || (token.baseToken && (token.baseToken.verified === true || token.baseToken.verified === 'true'));
    if (strategy.onlyVerified && !verified) return false;

    // تفعيل الاستراتيجية
    if (strategy.enabled === false) return false;

    return true;
  });
}
