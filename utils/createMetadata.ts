import { Connection, Keypair, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

import { createMetadataAccountV3, findMetadataPda } from '@metaplex-foundation/mpl-token-metadata';
// لا حاجة لاستيراد Umi أو أدواتها


/**
 * إنشاء metadata لتوكن SPL باستخدام Metaplex
 * @param connection اتصال سولانا
 * @param mint عنوان mint
 * @param payer الكي بير الموقع
 * @param name اسم التوكن (<=32 حرف)
 * @param symbol رمز التوكن (<=10 أحرف)
 * @param uri رابط JSON metadata (يفضل رفعه على arweave أو ipfs)
 */
export async function createTokenMetadata({
  connection,
  mint,
  payer,
  name,
  symbol,
  uri
}: {
  connection: Connection,
  mint: PublicKey,
  payer: Keypair,
  name: string,
  symbol: string,
  uri: string
}) {
  // تحقق من صحة المدخلات
  if (!name || name.length > 32) throw new Error('اسم التوكن يجب أن يكون <= 32 حرف.');
  if (!symbol || symbol.length > 10) throw new Error('رمز التوكن يجب أن يكون <= 10 أحرف.');
  if (!uri || !uri.startsWith('http')) throw new Error('uri يجب أن يكون رابطاً صحيحاً (يفضل arweave أو ipfs).');

  // حساب metadata PDA (أسلوب v2)
  const getMetadataPDA = (mint: PublicKey) => {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from('metadata'),
        METADATA_PROGRAM_ID.toBuffer(),
        mint.toBuffer()
      ],
      METADATA_PROGRAM_ID
    )[0];
  };

  const metadataPDA = getMetadataPDA(mint);

  // تعليمات إنشاء metadata
  const instruction = createCreateMetadataAccountV3Instruction({
    metadata: metadataPDA,
    mint,
    mintAuthority: payer.publicKey,
    payer: payer.publicKey,
    updateAuthority: payer.publicKey,
  }, {
    createMetadataAccountArgsV3: {
      data: {
        name,
        symbol,
        uri,
        sellerFeeBasisPoints: 0,
        creators: null,
        collection: null,
        uses: null
      },
      isMutable: true,
      collectionDetails: null
    }
  });

  const tx = new Transaction().add(instruction);
  const txid = await connection.sendTransaction(tx, [payer], { skipPreflight: false });
  await connection.confirmTransaction(txid, 'confirmed');
  return txid;
}
