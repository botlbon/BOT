// tradeSources.ts
// Unified trading source manager for Solana bot
// Language: English only


// --- Multi-Source Trading Logic (Promise.race, first-success-wins) ---
// Add your real source modules here. For now, placeholders are used.
// Example: import * as Jupiter from './sources/jupiter';
// Example: import * as Raydium from './sources/raydium';

type TradeSource = 'jupiter' | 'raydium' | 'dexscreener';

// Placeholder source modules (replace with real implementations)
const Jupiter = {
  async buy(tokenMint: string, amount: number, secret: string, ctrl?: any) {
    // Simulate random delay and possible failure
    await new Promise(res => setTimeout(res, Math.random() * 400 + 100));
    if (ctrl?.cancelled) throw new Error('Cancelled');
    if (Math.random() < 0.5) throw new Error('Jupiter buy failed');
    return { tx: 'jupiter_tx_' + Math.random().toString(36).slice(2), source: 'jupiter' };
  },
  async sell(tokenMint: string, amount: number, secret: string, ctrl?: any) {
    await new Promise(res => setTimeout(res, Math.random() * 400 + 100));
    if (ctrl?.cancelled) throw new Error('Cancelled');
    if (Math.random() < 0.5) throw new Error('Jupiter sell failed');
    return { tx: 'jupiter_tx_' + Math.random().toString(36).slice(2), source: 'jupiter' };
  }
};
const Raydium = {
  async buy(tokenMint: string, amount: number, secret: string, ctrl?: any) {
    await new Promise(res => setTimeout(res, Math.random() * 400 + 100));
    if (ctrl?.cancelled) throw new Error('Cancelled');
    if (Math.random() < 0.5) throw new Error('Raydium buy failed');
    return { tx: 'raydium_tx_' + Math.random().toString(36).slice(2), source: 'raydium' };
  },
  async sell(tokenMint: string, amount: number, secret: string, ctrl?: any) {
    await new Promise(res => setTimeout(res, Math.random() * 400 + 100));
    if (ctrl?.cancelled) throw new Error('Cancelled');
    if (Math.random() < 0.5) throw new Error('Raydium sell failed');
    return { tx: 'raydium_tx_' + Math.random().toString(36).slice(2), source: 'raydium' };
  }
};
const DexScreener = {
  async buy(tokenMint: string, amount: number, secret: string, ctrl?: any) {
    await new Promise(res => setTimeout(res, Math.random() * 400 + 100));
    if (ctrl?.cancelled) throw new Error('Cancelled');
    // Always succeed for placeholder
    return { tx: 'dexscreener_tx_' + Math.random().toString(36).slice(2), source: 'dexscreener' };
  },
  async sell(tokenMint: string, amount: number, secret: string, ctrl?: any) {
    await new Promise(res => setTimeout(res, Math.random() * 400 + 100));
    if (ctrl?.cancelled) throw new Error('Cancelled');
    return { tx: 'dexscreener_tx_' + Math.random().toString(36).slice(2), source: 'dexscreener' };
  }
};

const BUY_SOURCES = [Jupiter, Raydium, DexScreener];
const SELL_SOURCES = [Jupiter, Raydium, DexScreener];

// Helper: run all sources in parallel, return first success, cancel others
async function raceSources(sources: any[], fnName: 'buy'|'sell', ...args: any[]): Promise<{tx: string, source: TradeSource}> {
  let resolved = false;
  let errors: string[] = [];
  const controllers = sources.map(() => ({ cancelled: false }));
  const tasks = sources.map((src, i) => (async () => {
    try {
      if (typeof src[fnName] !== 'function') throw new Error(`${fnName} not implemented in source`);
      const res = await src[fnName](...args, controllers[i]);
      if (!resolved) {
        resolved = true;
        // Cancel others
        controllers.forEach((c, j) => { if (j !== i) c.cancelled = true; });
        return res;
      }
    } catch (e: any) {
      errors[i] = e?.message || String(e);
      throw e;
    }
  })());
  try {
    return await Promise.any(tasks);
  } catch (e) {
    // All failed
    throw new Error('All sources failed: ' + errors.filter(Boolean).join(' | '));
  }
}

// Unified buy: tries all sources in parallel, returns first success
export async function unifiedBuy(tokenMint: string, amount: number, secret: string): Promise<{tx: string, source: TradeSource}> {
  return raceSources(BUY_SOURCES, 'buy', tokenMint, amount, secret);
}

// Unified sell: tries all sources in parallel, returns first success
export async function unifiedSell(tokenMint: string, amount: number, secret: string): Promise<{tx: string, source: TradeSource}> {
  return raceSources(SELL_SOURCES, 'sell', tokenMint, amount, secret);
}
