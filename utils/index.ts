import { mintToken } from './mint';
import { watchForBuy } from './monitor';
import { sellWithOrca } from './sell';
import dotenv from 'dotenv';
dotenv.config();

const TOKEN_NAME = process.env.TOKEN_NAME || 'PAZUZU';
const TOKEN_SYMBOL = process.env.TOKEN_SYMBOL || 'PAZUZU';
const TWITTER_HANDLE = process.env.TWITTER_HANDLE || 'pazuzuMEM';
const TWITTER_URL = `https://x.com/${TWITTER_HANDLE}`;

async function main() {
  // طباعة مواصفات التوكن من ملف البيئة
  console.log('------------------------------');
  console.log(`🚀 بدء إطلاق العملة الجديدة:`);
  console.log(`الاسم: ${TOKEN_NAME}`);
  console.log(`الرمز: ${TOKEN_SYMBOL}`);
  console.log(`الكمية: ${process.env.MINT_AMOUNT || '1000000000000'}`);
  console.log(`عدد المنازل العشرية: ${process.env.DECIMALS || '6'}`);
  console.log('------------------------------');

  // سك العملة
  let mint, tokenAccount, mintedAmount;
  try {
    const mintResult = await mintToken();
    mint = mintResult.mint;
    tokenAccount = mintResult.tokenAccount;
    mintedAmount = mintResult.mintedAmount;
    console.log(`✅ تم إطلاق التوكن: ${mint}`);
    console.log(`� Token Account: ${tokenAccount}`);
    console.log(`�📢 تابعنا على تويتر: ${TWITTER_URL}`);
  } catch (err) {
    console.error('❌ فشل سك العملة:', err);
    return;
  }

  // انتظار وجود pool على Orca قبل الشراء التلقائي
  const { autoBuy, getBoughtAmount } = await import('./utils/autoBuy');
  let poolReady = false;
  let tryCount = 0;
  while (!poolReady && tryCount < 30) { // انتظر حتى 5 دقائق كحد أقصى
    try {
      await autoBuy(mint, 0); // محاولة شراء 0 (فقط لاكتشاف وجود pool)
      poolReady = true;
    } catch (e) {
      const err = e as any;
      if (err.message && err.message.includes('يجب إنشاء pool')) {
        if (tryCount === 0) {
          console.log('⏳ في انتظار إنشاء pool على Orca لهذا التوكن...');
        }
        await new Promise(res => setTimeout(res, 10000)); // انتظر 10 ثواني
        tryCount++;
        continue;
      } else {
        console.error('❌ خطأ أثناء التحقق من وجود pool:', err);
        return;
      }
    }
  }
  if (!poolReady) {
    console.error('❌ لم يتم إنشاء pool على Orca خلال الوقت المحدد. أعد المحاولة لاحقاً.');
    return;
  }

  // شراء تلقائي بقيمة 0.1 SOL (أول شراء)
  try {
    console.log(`🤖 شراء تلقائي بقيمة 0.1 SOL لأول توكن ${TOKEN_SYMBOL} ...`);
    const myBuyTx = await autoBuy(mint, 0.1);
    console.log(`✅ تم الشراء التلقائي: https://solscan.io/tx/${myBuyTx}`);
  } catch (err) {
    console.error('❌ فشل الشراء التلقائي:', err);
    return;
  }

  // مراقبة أول عملية شراء خارجية
  console.log(`👀 جارٍ مراقبة أول عملية شراء من عنوان آخر لـ ${TOKEN_NAME} ($${TOKEN_SYMBOL}) ...`);
  let firstBuyDetected = false;
  await watchForBuy(mint, tokenAccount, async (buyerAddress) => {
    if (firstBuyDetected) return;
    if (buyerAddress === process.env.PUBLIC_KEY) return;
    firstBuyDetected = true;
    console.log(`💰 تم الكشف عن أول عملية شراء خارجية لـ ${TOKEN_NAME} ($${TOKEN_SYMBOL})!`);
    if (!process.env.PUBLIC_KEY) {
      console.error('❌ PUBLIC_KEY غير معرف في ملف البيئة.');
      return;
    }
    const boughtAmount = await getBoughtAmount(mint, process.env.PUBLIC_KEY);
    const amountToSell = Math.floor((boughtAmount || 0) * 0.8);
    if (!amountToSell || amountToSell <= 0) {
      console.error('❌ الكمية المراد بيعها غير صحيحة. تحقق من الإعدادات.');
      return;
    }
    try {
      await sellWithOrca(mint, amountToSell);
      console.log(`🎉 تم بيع 80% من ${TOKEN_SYMBOL} بنجاح! تابعنا للمزيد: ${TWITTER_URL}`);
    } catch (err) {
      console.error('❌ فشل البيع:', err);
    }
  });
}

main().catch(console.error);
