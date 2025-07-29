export interface Strategy {
  minVolume?: number;
  minHolders?: number;
  minAge?: number;
  minMarketCap?: number;
  maxAge?: number;
  onlyVerified?: boolean;
  fastListing?: boolean;
  enabled?: boolean;
  // Add more fields as needed
}
