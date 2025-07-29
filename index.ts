
import { mintToken } from './mint';
import { watchForBuy } from './monitor';
import { sellWithOrca } from './sell';
import dotenv from 'dotenv';
dotenv.config();

// وظائف جاهزة للاستدعاء من البوت أو منطق خارجي
export async function launchToken() {
  // ...يمكنك هنا استدعاء mintToken أو أي منطق آخر عند الحاجة...
  return await mintToken();
}

export async function autoBuyToken(mint: string, amount: number) {
  const { autoBuy } = await import('./utils/autoBuy');
  return await autoBuy(mint, amount);
}

export async function sellToken(mint: string, amount: number) {
  return await sellWithOrca(mint, amount);
}

export async function monitorFirstBuy(mint: string, tokenAccount: string, callback: (buyerAddress: string) => Promise<void>) {
  return await watchForBuy(mint, tokenAccount, callback);
}
