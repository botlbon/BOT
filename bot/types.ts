export interface Strategy {
  minPrice?: number;
  maxPrice?: number;
  minMarketCap?: number;
  minHolders?: number;
  minAge?: number;
  onlyVerified?: boolean;
  enabled?: boolean;
  buyAmount?: number;
  profitTargets?: string;
  sellPercents?: string;
  stopLossPercent?: number;
}
