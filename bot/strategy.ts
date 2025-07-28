// Strategy logic and filtering
import { User } from './types';

/**
 * Filter tokens by user strategy
 * @param tokens Array of tokens
 * @param strategy User strategy object
 */
export interface Strategy {
  minVolume?: number;
  minHolders?: number;
  minAge?: number;
  enabled?: boolean;
  onlyVerified?: boolean;
  minMarketCap?: number;
  maxAge?: number;
  fastListing?: boolean;
}

export function filterTokensByStrategy(tokens: any[], strategy?: Strategy): any[] {
  if (!strategy || !strategy.enabled) return tokens;
  return tokens.filter((t: any) => {
    let ok = true;
    // minVolume: إذا لم تتوفر خاصية volume أو price أو marketCap، تجاهل الشرط
    if (typeof strategy.minVolume === 'number') {
      if (typeof t.volume === 'number') {
        ok = ok && t.volume >= strategy.minVolume;
      } else if (typeof t.price === 'number' && typeof t.marketCap === 'number') {
        ok = ok && (t.price * t.marketCap) >= strategy.minVolume;
      } // إذا لم تتوفر أي من القيم، تجاهل الشرط
    }
    // minHolders
    if (typeof strategy.minHolders === 'number') {
      if (typeof t.holders === 'number') {
        ok = ok && t.holders >= strategy.minHolders;
      } // إذا لم تتوفر holders، تجاهل الشرط
    }
    // minAge
    if (typeof strategy.minAge === 'number') {
      if (typeof t.age === 'number') {
        ok = ok && t.age >= strategy.minAge;
      } // إذا لم تتوفر age، تجاهل الشرط
    }
    // maxAge
    if (typeof strategy.maxAge === 'number') {
      if (typeof t.age === 'number') {
        ok = ok && t.age <= strategy.maxAge;
      } // إذا لم تتوفر age، تجاهل الشرط
    }
    // minMarketCap
    if (typeof strategy.minMarketCap === 'number') {
      if (typeof t.marketCap === 'number') {
        ok = ok && t.marketCap >= strategy.minMarketCap;
      } // إذا لم تتوفر marketCap، تجاهل الشرط
    }
    // onlyVerified
    if (strategy.onlyVerified) {
      if ('verified' in t) {
        ok = ok && t.verified === true;
      } // إذا لم تتوفر verified، تجاهل الشرط
    }
    // fastListing
    if (strategy.fastListing) {
      if (typeof t.age === 'number') {
        ok = ok && t.age < 30;
      } // إذا لم تتوفر age، تجاهل الشرط
    }
    return ok;
  });
}
