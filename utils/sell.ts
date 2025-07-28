import { getConnection, loadKeypair } from './wallet';
import { Network, getOrca, OrcaPoolConfig } from '@orca-so/sdk';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { getAssociatedTokenAddress, getTokenAccount } from './utils/tokenUtils';
import Decimal from 'decimal.js';
import { PublicKey } from '@solana/web3.js';

export async function sellWithOrca(tokenMint: string, amountIn: number) {
  const connection = getConnection();
  if (!process.env.PRIVATE_KEY) throw new Error('PRIVATE_KEY غير معرف في ملف البيئة');
  const wallet = loadKeypair(JSON.parse(process.env.PRIVATE_KEY));
  const network = process.env.NETWORK === 'devnet' ? Network.DEVNET : Network.MAINNET;
  const orca = getOrca(connection, network);
  const userPublicKey = wallet.publicKey;
  // اكتشاف الـ pool المناسب تلقائياً (SOL/tokenMint)
  let pool = null;
  let foundConfig = null;
  for (const [key, value] of Object.entries(OrcaPoolConfig)) {
    try {
      const p = orca.getPool(value);
      const tokenAMint = p.getTokenA().mint.toBase58();
      const tokenBMint = p.getTokenB().mint.toBase58();
      if (
        (tokenAMint === tokenMint || tokenBMint === tokenMint) &&
        (tokenAMint === 'So11111111111111111111111111111111111111112' || tokenBMint === 'So11111111111111111111111111111111111111112')
      ) {
        pool = p;
        foundConfig = value;
        break;
      }
    } catch (e) { continue; }
  }
  if (!pool) {
    const orcaUiUrl = `https://www.orca.so/create-pool?baseMint=${tokenMint}&quoteMint=So11111111111111111111111111111111111111112`;
    console.error('🚫 لم يتم العثور على زوج تداول لهذا التوكن على Orca.');
    console.error('🔗 يمكنك إنشاء pool يدوياً عبر الرابط التالي:');
    console.error(orcaUiUrl);
    throw new Error('يجب إنشاء pool لهذا التوكن على Orca قبل التداول.');
  }
  const tokenAccountAddress = await getAssociatedTokenAddress(
    pool.getTokenA().mint,
    userPublicKey
  );
  const tokenAmount = await getTokenAccount(
    connection,
    tokenAccountAddress
  );
  if (Number(tokenAmount.amount) < amountIn) {
    throw new Error(`🚫 الرصيد غير كافٍ للبيع. الرصيد الحالي: ${Number(tokenAmount.amount)}`);
  }
  const amount = new Decimal(amountIn.toString());
  const slippage = new Decimal(process.env.SLIPPAGE || '0.1');
  try {
    const swapPayload = await pool.swap(wallet, pool.getTokenA(), amount, slippage);
    const tx = await swapPayload.execute();
    console.log(`✅ بيع التوكن! المعاملة: https://solscan.io/tx/${tx}`);
  } catch (err) {
    console.error('❌ فشل تنفيذ swap:', err);
    throw err;
  }
}
