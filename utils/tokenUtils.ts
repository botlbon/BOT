import { PublicKey, Connection, Keypair, Transaction, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';

// دالة بديلة لإنشاء عنوان الحساب المرتبط (ATA)
export async function getAssociatedTokenAddress(
  mint: PublicKey,
  owner: PublicKey
): Promise<PublicKey> {
  return (
    await PublicKey.findProgramAddress(
      [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
  )[0];
}

// دالة بديلة لإنشاء حساب ATA إذا لم يكن موجوداً
export async function createAssociatedTokenAccount(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey
): Promise<PublicKey> {
  const ata = await getAssociatedTokenAddress(mint, owner);
  const accountInfo = await connection.getAccountInfo(ata);
  if (accountInfo) return ata;
  const tx = new Transaction().add({
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    data: Buffer.alloc(0),
  });
  await connection.sendTransaction(tx, [payer]);
  return ata;
}

// دالة بديلة لجلب بيانات الحساب المرتبط
export async function getTokenAccount(
  connection: Connection,
  ata: PublicKey
) {
  const info = await connection.getParsedAccountInfo(ata);
  if (!info.value) throw new Error('Token account not found');
  // @ts-ignore
  return info.value.data.parsed.info.tokenAmount;
}
