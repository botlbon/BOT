


import { fetchDexScreenerTokens, notifyUsers } from './utils/tokenUtils';

// تحديث الحقول الديناميكية عند بدء التشغيل


// نقطة الدخول لمراقبة السوق وإرسال الإشعارات
function registerWsNotifications(bot: any, users: Record<string, any>) {
  async function pollAndNotify() {
    try {
      const tokens = await fetchDexScreenerTokens();

      // فلترة العملات: استبعاد العملات ذات السيولة المغلقة أو غير القابلة للبيع
      const filteredTokens = tokens.filter((token: any) => {
        // السيولة يجب أن تكون أكبر من حد معين (مثلاً 1000$)
        const liquidityOk = token.liquidity && token.liquidity.usd && token.liquidity.usd > 1000;
        // العملات غير القابلة للبيع (مثلاً لا يوجد حجم بيع أو عليها قيود)
        const canSell = !(token.baseToken?.symbol?.toLowerCase().includes('scam') || token.baseToken?.name?.toLowerCase().includes('scam'));
        // يمكن إضافة شروط أخرى لاحقاً
        return liquidityOk && canSell;
      });

      // تجهيز رسالة احترافية دقيقة لكل عملة
      const formatTokenMsg = (token: any) => {
        const buyVol = token.txns?.h24?.buys ?? 0;
        const sellVol = token.txns?.h24?.sells ?? 0;
        const createdAt = token.pairCreatedAt ? new Date(token.pairCreatedAt).toLocaleString('en-GB') : 'N/A';
        const links = [
          token.url ? `[رابط DexScreener](${token.url})` : '',
          token.info?.websites?.[0] ? `[موقع العملة](${token.info.websites[0]})` : '',
        ].filter(Boolean).join(' | ');
        const shareLink = token.url ? `https://t.me/share/url?url=${encodeURIComponent(token.url)}&text=تابع العملة على البوت` : '';
        return `\n<b>${token.baseToken?.name || ''} (${token.baseToken?.symbol || ''})</b>\n` +
          `السعر: <b>${token.priceUsd || 'N/A'}$</b>\n` +
          `السيولة: <b>${token.liquidity?.usd?.toLocaleString() || 'N/A'}$</b>\n` +
          `ماركت كاب: <b>${token.marketCap?.toLocaleString() || 'N/A'}$</b>\n` +
          `فوليوم 24h: <b>${token.volume?.h24?.toLocaleString() || 'N/A'}$</b>\n` +
          `توقيت الإنشاء: <b>${createdAt}</b>\n` +
          `أحجام الشراء (24h): <b>${buyVol}</b> | أحجام البيع (24h): <b>${sellVol}</b>\n` +
          `التغير السعري 24h: <b>${token.priceChange?.h24 ?? 'N/A'}%</b>\n` +
          (links ? `روابط: ${links}\n` : '') +
          (shareLink ? `<a href='${shareLink}'>مشاركة العملة</a>\n` : '');
      };

      // إرسال رسالة مخصصة لكل مستخدم حسب الفلترة
      for (const userId of Object.keys(users)) {
        // يمكن تخصيص الفلترة لكل مستخدم لاحقاً حسب إعداداته
        const userTokens = filteredTokens; // حالياً نفس الفلترة للجميع
        const msg = userTokens.map(formatTokenMsg).join('\n---------------------\n');
        if (msg) {
          await bot.telegram.sendMessage(userId, msg, { parse_mode: 'HTML', disable_web_page_preview: false });
        }
      }
    } catch {
      // يمكن إضافة لوج عند الحاجة
    }
  }
  setInterval(pollAndNotify, 60 * 1000);
  pollAndNotify();
}

export { registerWsNotifications };