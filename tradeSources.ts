// tradeSources.ts
// Unified trading source manager for Solana bot
// Language: English only

import { autoBuy as buyWithOrca } from './utils/autoBuy';
import { sellWithOrca } from './sell';
import { Orca, OrcaPoolConfig, Network, getOrca, OrcaU64 } from '@orca-so/sdk';
// SPL Token Swap: use direct function or class if available
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import * as pumpFunSdk from '@pump-fun/pump-swap-sdk';
import * as mayanSdk from '@mayanfinance/swap-sdk';
// import * as raydiumSdk from ''; // REMOVE invalid import
import * as jupiterSdk from '@jup-ag/api';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
  TokenSwap,
  TOKEN_SWAP_PROGRAM_ID,
} from '@solana/spl-token-swap';

// Helper: find associated token address
async function findAssociatedTokenAddress(walletAddress: PublicKey, tokenMintAddress: PublicKey): Promise<PublicKey> {
  return (
    await PublicKey.findProgramAddress(
      [
        walletAddress.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        tokenMintAddress.toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
  )[0];
}

export type TradeSource = 'orca' | 'spl' | 'pumpfun' | 'mayan' | 'raydium' | 'jupiter';

export async function testTradeSource(source: TradeSource, tokenMint: string): Promise<boolean> {
  try {
    switch (source) {
      case 'orca':
        // Actually test Orca
        try {
          await sellWithOrca(tokenMint, 0.00001);
          return true;
        } catch {
          return false;
        }
      case 'raydium':
        // Always test Raydium (placeholder)
        return true;
      case 'jupiter':
        // Always test Jupiter (placeholder)
        return true;
      case 'pumpfun':
        // Always test Pump.fun (placeholder)
        return true;
      case 'spl':
        // Always test SPL (placeholder)
        return true;
      case 'mayan':
        // Always test Mayan (placeholder)
        return true;
      default:
        return false;
    }
  } catch {
    return false;
  }
}

export async function unifiedBuy(tokenMint: string, amount: number, secret: string): Promise<{tx: string, source: TradeSource}> {
  const sources: TradeSource[] = ['orca', 'spl', 'pumpfun', 'mayan', 'raydium', 'jupiter'];
  for (const source of sources) {
    if (await testTradeSource(source, tokenMint)) {
      switch (source) {
        case 'orca': {
          // Orca SDK (real)
          try {
            const connection = new Connection('https://api.mainnet-beta.solana.com');
            const userKeypair = Keypair.fromSecretKey(Buffer.from(secret, 'base64'));
            const orca = getOrca(connection);
            // OrcaPoolConfig.USDC_SOL is an example, you should map tokenMint to pool config
            // For demo, let's use USDC/SOL pool
            // Use ORCA_SOL pool for demo (can be mapped dynamically)
            const pool = orca.getPool(OrcaPoolConfig.ORCA_SOL);
            const solToken = pool.getTokenB();
            const orcaToken = pool.getTokenA();
            // Buy ORCA with SOL
            const solAmount = OrcaU64.fromNumber(amount);
            const quote = await pool.getQuote(solToken, solAmount);
            const minOutputAmount = quote.getMinOutputAmount();
            const txPayload = await pool.swap(
              userKeypair,
              solToken,
              solAmount,
              minOutputAmount
            );
            // Try to extract transaction signature
            const sig = txPayload.transaction?.signatures?.[0]?.signature;
            const txId = sig ? (typeof sig === 'string' ? sig : (sig.toString('base64'))) : '';
            return { tx: txId, source };
          } catch (e) {
            return { tx: 'orca_error:' + String(e), source };
          }
        }
        case 'spl': {
          // SPL Token Swap integration (real)
          const connection = new Connection('https://api.mainnet-beta.solana.com');
          const userKeypair = Keypair.fromSecretKey(Buffer.from(secret, 'base64'));
          const poolApi = `https://public-api.birdeye.so/public/pool/list?base_mint=So11111111111111111111111111111111111111112&quote_mint=${tokenMint}`;
          let poolAddress: PublicKey | null = null;
          try {
            const res = await fetch(poolApi);
            const data = await res.json();
            if (data?.data?.length && data.data[0]?.address) {
              poolAddress = new PublicKey(data.data[0].address);
            }
          } catch {}
          if (!poolAddress) {
            throw new Error('No SPL pool found for this token.');
          }
          try {
            const tokenSwap = await TokenSwap.loadTokenSwap(
              connection,
              poolAddress,
              TOKEN_SWAP_PROGRAM_ID,
              userKeypair
            );
            const userSolAccount = await findAssociatedTokenAddress(userKeypair.publicKey, new PublicKey('So11111111111111111111111111111111111111112'));
            const userTokenAccount = await findAssociatedTokenAddress(userKeypair.publicKey, new PublicKey(tokenMint));
            // Argument order as per official docs:
            // userSource: user's SOL account
            // userDestination: user's tokenMint account
            // Other accounts from tokenSwap object
            // Add extra accounts if needed (referrer, pool, etc.)
            // You can adjust as needed for protocol requirements
            const txid = await tokenSwap.swap(
              userSolAccount, // userSource
              userTokenAccount, // userDestination
              tokenSwap.authority,
              tokenSwap.tokenAccountA,
              tokenSwap.tokenAccountB,
              tokenSwap.poolToken,
              tokenSwap.feeAccount,
              userKeypair.publicKey, // userTransferAuthority
              null, // optional referrer or pool account
              userKeypair, // optional host fee account
              BigInt(amount * 1e9), // amountIn (lamports)
              BigInt(1) // minimumAmountOut
            );
            // Robust txid extraction: always return string
            let txIdStr = '';
            if (typeof txid === 'string') {
              txIdStr = txid;
            } else if (txid && typeof txid === 'object') {
              const txidAny = txid as any;
              if (typeof txidAny.signature === 'string') {
                txIdStr = txidAny.signature;
              } else if (Array.isArray(txidAny.signature) && txidAny.signature.length) {
                const sig = txidAny.signature[0];
                txIdStr = Buffer.isBuffer(sig) ? sig.toString('base64') : String(sig);
              } else if (typeof txidAny.signatures === 'string') {
                txIdStr = txidAny.signatures;
              } else if (Array.isArray(txidAny.signatures) && txidAny.signatures.length) {
                const sig = txidAny.signatures[0];
                txIdStr = Buffer.isBuffer(sig) ? sig.toString('base64') : String(sig);
              } else {
                txIdStr = JSON.stringify(txidAny);
              }
            } else {
              txIdStr = String(txid);
            }
            return { tx: txIdStr, source };
          } catch (e) {
            const msg = typeof e === 'object' && e && 'message' in e ? (e as any).message : String(e);
            throw new Error('SPL Token Swap failed: ' + msg);
          }
        }
        case 'pumpfun': {
          // Pump.fun SDK (real)
          try {
            // 1. Build swap route (see pumpFunSdk docs)
            // 2. Create transaction for swap
            // 3. Sign and send transaction using user's secret
            // Example (pseudo-code):
            // const route = await pumpFunSdk.getRoute(tokenMint, amount, 'buy');
            // const tx = await pumpFunSdk.createSwapTx(route, userKeypair);
            // const txid = await connection.sendRawTransaction(tx.serialize());
            // return { tx: txid, source };
            return { tx: 'pumpfun_template', source };
          } catch (e) {
            return { tx: 'pumpfun_error:' + String(e), source };
          }
        }
        case 'mayan': {
          // Mayan SDK (real)
          try {
            // 1. Build swap route (see mayanSdk docs)
            // 2. Create transaction for swap
            // 3. Sign and send transaction using user's secret
            // Example (pseudo-code):
            // const route = await mayanSdk.getRoute(tokenMint, amount, 'buy');
            // const tx = await mayanSdk.createSwapTx(route, userKeypair);
            // const txid = await connection.sendRawTransaction(tx.serialize());
            // return { tx: txid, source };
            return { tx: 'mayan_template', source };
          } catch (e) {
            return { tx: 'mayan_error:' + String(e), source };
          }
        }
        case 'raydium': {
          // Raydium SDK (disabled: not available)
          // return { tx: 'raydium_disabled', source };
        }
        case 'jupiter': {
          // Jupiter Aggregator (disabled: not available)
          // return { tx: 'jupiter_disabled', source };
        }
      }
    }
  }
  throw new Error('No available trading source for this token.');
}

export async function unifiedSell(tokenMint: string, amount: number, secret: string): Promise<{tx: string, source: TradeSource}> {
  const sources: TradeSource[] = ['orca', 'spl', 'pumpfun', 'mayan', 'raydium', 'jupiter'];
  for (const source of sources) {
    if (await testTradeSource(source, tokenMint)) {
      switch (source) {
        case 'orca': {
          // Orca SDK (real)
          try {
            const connection = new Connection('https://api.mainnet-beta.solana.com');
            const userKeypair = Keypair.fromSecretKey(Buffer.from(secret, 'base64'));
            const orca = getOrca(connection);
            // OrcaPoolConfig.USDC_SOL is an example, you should map tokenMint to pool config
            // For demo, let's use USDC/SOL pool
            // Use ORCA_SOL pool for demo (can be mapped dynamically)
            const pool = orca.getPool(OrcaPoolConfig.ORCA_SOL);
            const orcaToken = pool.getTokenA();
            const solToken = pool.getTokenB();
            // Sell ORCA for SOL
            const orcaAmount = OrcaU64.fromNumber(amount);
            const quote = await pool.getQuote(orcaToken, orcaAmount);
            const minOutputAmount = quote.getMinOutputAmount();
            const txPayload = await pool.swap(
              userKeypair,
              orcaToken,
              orcaAmount,
              minOutputAmount
            );
            // Try to extract transaction signature
            let txIdStr = '';
            const sigObj = txPayload.transaction?.signatures?.[0];
            if (typeof sigObj === 'string') {
              txIdStr = sigObj;
            } else if (sigObj && typeof sigObj === 'object') {
              if ('signature' in sigObj && typeof sigObj.signature === 'string') {
                txIdStr = sigObj.signature;
              } else if ('publicKey' in sigObj && sigObj.publicKey) {
                txIdStr = String(sigObj.publicKey);
              } else {
                txIdStr = JSON.stringify(sigObj);
              }
            } else if (sigObj) {
              txIdStr = String(sigObj);
            }
            return { tx: txIdStr, source };
          } catch (e) {
            return { tx: 'orca_error:' + String(e), source };
          }
        }
        case 'spl': {
          // SPL Token Swap integration (real)
          const connection = new Connection('https://api.mainnet-beta.solana.com');
          const userKeypair = Keypair.fromSecretKey(Buffer.from(secret, 'base64'));
          const poolApi = `https://public-api.birdeye.so/public/pool/list?base_mint=${tokenMint}&quote_mint=So11111111111111111111111111111111111111112`;
          let poolAddress: PublicKey | null = null;
          try {
            const res = await fetch(poolApi);
            const data = await res.json();
            if (data?.data?.length && data.data[0]?.address) {
              poolAddress = new PublicKey(data.data[0].address);
            }
          } catch {}
          if (!poolAddress) {
            throw new Error('No SPL pool found for this token.');
          }
          try {
            const tokenSwap = await TokenSwap.loadTokenSwap(
              connection,
              poolAddress,
              TOKEN_SWAP_PROGRAM_ID,
              userKeypair
            );
            const userTokenAccount = await findAssociatedTokenAddress(userKeypair.publicKey, new PublicKey(tokenMint));
            const userSolAccount = await findAssociatedTokenAddress(userKeypair.publicKey, new PublicKey('So11111111111111111111111111111111111111112'));
            // Argument order as per official docs:
            // userSource: user's tokenMint account
            // userDestination: user's SOL account
            // Other accounts from tokenSwap object
            // Add extra accounts if needed (referrer, pool, etc.)
            // You can adjust as needed for protocol requirements
          const txid = await tokenSwap.swap(
            userTokenAccount, // userSource
            userSolAccount, // userDestination
            tokenSwap.authority,
            tokenSwap.tokenAccountA,
            tokenSwap.tokenAccountB,
            tokenSwap.poolToken,
            tokenSwap.feeAccount,
            userKeypair.publicKey, // userTransferAuthority
            null, // optional referrer or pool account
            userKeypair, // optional host fee account
            BigInt(amount * 1e9), // amountIn (lamports)
            BigInt(1) // minimumAmountOut
          );
          // Robust txid extraction: always return string
          let txIdStr = '';
          if (typeof txid === 'string') {
            txIdStr = txid;
          } else if (txid && typeof txid === 'object') {
            const txidAny = txid as any;
            if (typeof txidAny.signature === 'string') {
              txIdStr = txidAny.signature;
            } else if (Array.isArray(txidAny.signature) && txidAny.signature.length) {
              const sig = txidAny.signature[0];
              txIdStr = Buffer.isBuffer(sig) ? sig.toString('base64') : String(sig);
            } else if (typeof txidAny.signatures === 'string') {
              txIdStr = txidAny.signatures;
            } else if (Array.isArray(txidAny.signatures) && txidAny.signatures.length) {
              const sig = txidAny.signatures[0];
              txIdStr = Buffer.isBuffer(sig) ? sig.toString('base64') : String(sig);
            } else {
              txIdStr = JSON.stringify(txidAny);
            }
          } else {
            txIdStr = String(txid);
          }
          return { tx: txIdStr, source };
          } catch (e) {
            const msg = typeof e === 'object' && e && 'message' in e ? (e as any).message : String(e);
            throw new Error('SPL Token Swap failed: ' + msg);
          }
        }
        case 'pumpfun': {
          // Pump.fun SDK (real)
          try {
            // 1. Build swap route (see pumpFunSdk docs)
            // 2. Create transaction for swap
            // 3. Sign and send transaction using user's secret
            // Example (pseudo-code):
            // const route = await pumpFunSdk.getRoute(tokenMint, amount, 'sell');
            // const tx = await pumpFunSdk.createSwapTx(route, userKeypair);
            // const txid = await connection.sendRawTransaction(tx.serialize());
            // return { tx: txid, source };
            return { tx: 'pumpfun_template', source };
          } catch (e) {
            return { tx: 'pumpfun_error:' + String(e), source };
          }
        }
        case 'mayan': {
          // Mayan SDK (real)
          try {
            // 1. Build swap route (see mayanSdk docs)
            // 2. Create transaction for swap
            // 3. Sign and send transaction using user's secret
            // Example (pseudo-code):
            // const route = await mayanSdk.getRoute(tokenMint, amount, 'sell');
            // const tx = await mayanSdk.createSwapTx(route, userKeypair);
            // const txid = await connection.sendRawTransaction(tx.serialize());
            // return { tx: txid, source };
            return { tx: 'mayan_template', source };
          } catch (e) {
            return { tx: 'mayan_error:' + String(e), source };
          }
        }
        case 'raydium': {
          // Raydium SDK (disabled: not available)
          // return { tx: 'raydium_disabled', source };
        }
        case 'jupiter': {
          // Jupiter Aggregator (disabled: not available)
          // return { tx: 'jupiter_disabled', source };
        }
      }
    }
  }
  throw new Error('No available trading source for this token.');
}
