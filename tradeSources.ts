// tradeSources.ts
// Unified trading source manager for Solana bot
// Language: English only


// --- Multi-Source Trading Logic (Promise.race, first-success-wins) ---
// Add your real source modules here. For now, placeholders are used.
// Example: import * as Jupiter from './sources/jupiter';
// Example: import * as Raydium from './sources/raydium';

type TradeSource = 'jupiter' | 'raydium' | 'dexscreener';


// --- Real Jupiter REST API integration ---
const { Connection, Keypair } = require('@solana/web3.js');
const { createJupiterApiClient } = require('@jup-ag/api');

const Jupiter = {
  async buy(tokenMint: string, amount: number, secret: string, ctrl?: any) {
    if (ctrl?.cancelled) throw new Error('Cancelled');
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
    let secretKey: Buffer;
    try {
      secretKey = Buffer.from(secret, 'base64');
    } catch (e) {
      throw new Error('Invalid base64 secret');
    }
    const keypair = Keypair.fromSecretKey(secretKey);
    const userPublicKey = keypair.publicKey.toBase58();
    // 1. Get Jupiter API client
    const jupiter = createJupiterApiClient();
    // 2. Get quote
    const quote = await jupiter.quoteGet({
      inputMint: SOL_MINT,
      outputMint: tokenMint,
      amount: Math.floor(amount * 1e9),
      slippageBps: 100
    });
    if (!quote || !quote.routePlan || !quote.outAmount) {
      throw new Error('No route found for this token');
    }
    // 3. Get swap transaction
    const swapRequest = {
      userPublicKey,
      wrapAndUnwrapSol: true,
      asLegacyTransaction: false,
      quoteResponse: quote
    };
    console.log('[Jupiter.swapPost] swapRequest:', swapRequest);
    const swapResp = await jupiter.swapPost({ swapRequest });
    if (!swapResp || !swapResp.swapTransaction) {
      throw new Error('Failed to get swap transaction from Jupiter');
    }
    // 3. Sign and send transaction
    const swapTxBuf = Buffer.from(swapResp.swapTransaction, 'base64');
    let txid = '';
    try {
      const tx = await connection.sendRawTransaction(swapTxBuf, { skipPreflight: false });
      await connection.confirmTransaction(tx, 'confirmed');
      txid = tx;
    } catch (e) {
        if (e && typeof e === 'object' && (e as any).name === 'SendTransactionError' && typeof (e as any).getLogs === 'function') {
            try {
                const logs = await (e as any).getLogs();
                console.error('Transaction logs:', logs);
            } catch (logErr) {
                console.error('Failed to get transaction logs:', logErr);
            }
        }
        throw new Error('Swap failed: ' + (e && typeof e === 'object' && 'message' in e ? (e as any).message : String(e)));
    }
    return { tx: txid, source: 'jupiter' };
  },
  async sell(tokenMint: string, amount: number, secret: string, ctrl?: any) {
    if (ctrl?.cancelled) throw new Error('Cancelled');
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
    let secretKey: Buffer;
    try {
      secretKey = Buffer.from(secret, 'base64');
    } catch (e) {
      throw new Error('Invalid base64 secret');
    }
    const keypair = Keypair.fromSecretKey(secretKey);
    const userPublicKey = keypair.publicKey.toBase58();
    // 1. Get Jupiter API client
    const jupiter = createJupiterApiClient();
    // 2. Get quote (token -> SOL)
    const quote = await jupiter.quoteGet({
      inputMint: tokenMint,
      outputMint: SOL_MINT,
      amount: Math.floor(amount * 1e9),
      slippageBps: 100
    });
    if (!quote || !quote.routePlan || !quote.outAmount) {
      throw new Error('No route found for this token');
    }
    // 3. Get swap transaction
    const swapRequest = {
      userPublicKey,
      wrapAndUnwrapSol: true,
      asLegacyTransaction: false,
      quoteResponse: quote
    };
    console.log('[Jupiter.swapPost] swapRequest:', swapRequest);
    const swapResp = await jupiter.swapPost({ swapRequest });
    if (!swapResp || !swapResp.swapTransaction) {
      throw new Error('Failed to get swap transaction from Jupiter');
    }
    // 3. Sign and send transaction
    const swapTxBuf = Buffer.from(swapResp.swapTransaction, 'base64');
    let txid = '';
    try {
      const tx = await connection.sendRawTransaction(swapTxBuf, { skipPreflight: false });
      await connection.confirmTransaction(tx, 'confirmed');
      txid = tx;
    } catch (e) {
      throw new Error('Swap failed: ' + (e && typeof e === 'object' && 'message' in e ? (e as any).message : String(e)));
    }
    return { tx: txid, source: 'jupiter' };
  }
};

const BUY_SOURCES = [Jupiter];
const SELL_SOURCES = [Jupiter];

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
/**
 * @param {string} tokenMint
 * @param {number} amount
 * @param {string} secret
 * @returns {Promise<{tx: string, source: TradeSource}>}
 */
async function unifiedBuy(tokenMint: string, amount: number, secret: string): Promise<{tx: string, source: TradeSource}> {
  return raceSources(BUY_SOURCES, 'buy', tokenMint, amount, secret);
}

/**
 * @param {string} tokenMint
 * @param {number} amount
 * @param {string} secret
 * @returns {Promise<{tx: string, source: TradeSource}>}
 */
async function unifiedSell(tokenMint: string, amount: number, secret: string): Promise<{tx: string, source: TradeSource}> {
  return raceSources(SELL_SOURCES, 'sell', tokenMint, amount, secret);
}

module.exports.unifiedBuy = unifiedBuy;
module.exports.unifiedSell = unifiedSell;
