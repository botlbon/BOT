// Simple filterTokensByStrategy implementation
import type { Strategy } from './types';

/**
 * Filters a list of tokens based on the user's strategy settings.
 * This is a basic example and should be customized for your real token structure.
 */
export function filterTokensByStrategy(tokens: any[], strategy: Strategy): any[] {
  if (!strategy || !Array.isArray(tokens)) return [];
  return tokens.filter(token => {
    // استخدم volume أو amount
    const volume = Number(token.volume ?? token.amount ?? 0);
    if (strategy.minVolume && volume < strategy.minVolume) return false;

    // استخدم holders أو totalAmount
    const holders = Number(token.holders ?? token.totalAmount ?? 0);
    if (strategy.minHolders && holders < strategy.minHolders) return false;

    // العمر بالدقائق
    const age = Number(token.age ?? 0);
    if (strategy.minAge && age < strategy.minAge) return false;
    if (strategy.maxAge && age > strategy.maxAge) return false;

    // ماركت كاب
    const marketCap = Number(token.marketCap ?? 0);
    if (strategy.minMarketCap && marketCap < strategy.minMarketCap) return false;

    // التحقق
    const verified = token.verified === true || token.verified === 'true';
    if (strategy.onlyVerified && !verified) return false;

    // يمكن إضافة شروط أخرى هنا حسب الحاجة
    return true;
  });
}
