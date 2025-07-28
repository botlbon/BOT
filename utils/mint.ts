import { getConnection, loadKeypair } from './wallet';
import { TOKEN_PROGRAM_ID, Token } from '@solana/spl-token';
import { createTokenMetadata } from './utils/createMetadata';
import { PublicKey } from '@solana/web3.js';

export async function mintToken() {
  const connection = getConnection();
  if (!process.env.PRIVATE_KEY) throw new Error('PRIVATE_KEY غير معرف في ملف البيئة');
  const payer = loadKeypair(JSON.parse(process.env.PRIVATE_KEY));

  const decimals = parseInt(process.env.DECIMALS || '6');
  const mintAmount = parseInt(process.env.MINT_AMOUNT || '1000000000000');


  // 1. إنشاء Mint جديد باستخدام Token.createMint
  const mintAccount = await Token.createMint(
    connection,
    payer,
    payer.publicKey,
    null,
    decimals,
    TOKEN_PROGRAM_ID
  );


  // 2. إنشاء أو جلب حساب التوكن المرتبط (ATA) باستخدام SPL-Token الرسمي
  const tokenAccountInfo = await mintAccount.getOrCreateAssociatedAccountInfo(payer.publicKey);


  // 3. سك التوكنات لمحفظتك
  await mintAccount.mintTo(
    tokenAccountInfo.address,
    payer,
    [],
    mintAmount
  );

  console.log(`✅ Mint created: ${mintAccount.publicKey.toBase58()}`);
  console.log(`📦 Token Account: ${tokenAccountInfo.address.toBase58()}`);

  // إضافة metadata تلقائيًا
  const name = process.env.TOKEN_NAME || 'TOKEN';
  const symbol = process.env.TOKEN_SYMBOL || 'TOKEN';
  const uri = process.env.TOKEN_URI || 'https://arweave.net/placeholder.json';
  try {
    await createTokenMetadata({
      connection,
      mint: mintAccount.publicKey,
      payer,
      name,
      symbol,
      uri
    });
    console.log('✅ تم إضافة metadata (اسم/رمز/رابط صورة) للتوكن بنجاح!');
  } catch (err) {
    console.error('⚠️ فشل إضافة metadata للتوكن:', err);
  }
  return {
    mint: mintAccount.publicKey.toBase58(),
    tokenAccount: tokenAccountInfo.address.toBase58(),
    mintedAmount: mintAmount
  };
}
