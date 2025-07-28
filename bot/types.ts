// User type definition
export interface User {
  wallet?: string;
  secret?: string;
  trades?: number;
  activeTrades?: number;
  history?: string[];
  referrer?: string;
  referrals?: string[];
  strategy?: Strategy;
  lastTokenList?: any[];
  honeyTemp?: any;
  _pendingSellAll?: any[];
  copiedWallets?: string[];
  lastMessageAt?: number;
}

export interface Strategy {
  minVolume?: number;
  minHolders?: number;
  minAge?: number;
  enabled?: boolean;
  onlyVerified?: boolean;
  minMarketCap?: number;
  maxAge?: number;
  fastListing?: boolean;
  buyAmount?: number;
  profitTargets?: number[];
  sellPercents?: number[];
  stopLossPercent?: number;
}

// User and types definitions
export interface User {
  wallet?: string;
  secret?: string;
  trades?: number;
  activeTrades?: number;
  history?: string[];
  referrer?: string;
  referrals?: string[];
  strategy?: Strategy;
  lastTokenList?: any[];
  honeyTemp?: any;
  _pendingSellAll?: any[];
  copiedWallets?: string[];
  lastMessageAt?: number;
}
