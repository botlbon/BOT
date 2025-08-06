

import { Connection, Keypair } from '@solana/web3.js';
import { QuoteApi, SwapApi } from '@jup-ag/api/dist/api';

// Usage: npx ts-node utils/jupiterBuyTest.ts <tokenAddress> <amountInSOL> <base64Secret>
async function main() {
  const [tokenAddress, amountInSOL, base64Secret] = process.argv.slice(2);
  if (!tokenAddress || !amountInSOL || !base64Secret) {
    console.error('Usage: npx ts-node utils/jupiterBuyTest.ts <tokenAddress> <amountInSOL> <base64Secret>');
    process.exit(1);
  }

  // Setup connection
  const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');

  // Load keypair from base64
  let secretKey: Buffer;
  try {
    secretKey = Buffer.from(base64Secret, 'base64');
  } catch (e) {
    console.error('Invalid base64 secret:', e);
    process.exit(1);
  }
  const keypair = Keypair.fromSecretKey(secretKey);
  const userPublicKey = keypair.publicKey.toBase58();

  // Jupiter REST API clients
  const quoteApi = new QuoteApi();
  const swapApi = new SwapApi();

  // Find SOL mint
  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  const inputMint = SOL_MINT;
  const outputMint = tokenAddress;
  const amount = Math.floor(Number(amountInSOL) * 1e9); // lamports

  // 1. Get quote
  console.log('Fetching quote...');
  const quote = await quoteApi.getQuote(
    inputMint,
    outputMint,
    amount,
    100, // slippageBps = 1%
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined
  );
  if (!quote || !quote.routePlan || !quote.outAmount) {
    console.error('No route found for this token.');
    process.exit(1);
  }
  console.log('Quote:', quote);

  // 2. Get swap transaction
  console.log('Requesting swap transaction...');
  const swapResp = await swapApi.postSwap({
    userPublicKey,
    wrapAndUnwrapSol: true,
    asLegacyTransaction: false,
    quoteResponse: quote
  });
  if (!swapResp || !swapResp.swapTransaction) {
    console.error('Failed to get swap transaction from Jupiter.');
    process.exit(1);
  }

  // 3. Sign and send transaction
  const swapTxBuf = Buffer.from(swapResp.swapTransaction, 'base64');
  let txid = '';
  try {
    const tx = await connection.sendRawTransaction(swapTxBuf, { skipPreflight: false });
    await connection.confirmTransaction(tx, 'confirmed');
    txid = tx;
  } catch (e) {
    console.error('Swap failed:', e);
    process.exit(1);
  }
  console.log('Swap success! Tx signature:', txid);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
