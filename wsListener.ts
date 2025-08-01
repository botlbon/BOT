



import { fetchDexScreenerTokens } from './utils/tokenUtils';

/**
 * Entry point for market monitoring and user notifications
 */
function registerWsNotifications(bot: any, users: Record<string, any>) {
  async function pollAndNotify() {
    try {
      const tokens = await fetchDexScreenerTokens();
      // Filter tokens: exclude tokens with low liquidity or marked as scam
      const filteredTokens = tokens.filter((token: any) => {
        const liquidityOk = token.liquidity && token.liquidity.usd && token.liquidity.usd > 1000;
        const notScam = !(token.baseToken?.symbol?.toLowerCase().includes('scam') || token.baseToken?.name?.toLowerCase().includes('scam'));
        return liquidityOk && notScam;
      });

      // Import required functions
      const { buildTokenMessage } = await import('./utils/tokenUtils');
      const { filterTokensByStrategy } = await import('./bot/strategy');

      // Import hash and sent-tokens helpers from telegramBot.ts
      const { hashTokenAddress, readSentHashes, appendSentHash } = await import('./telegramBot');

      for (const userId of Object.keys(users)) {
        const user = users[userId];
        // Filter tokens for each user based on استراتيجيته
        let userTokens = filteredTokens;
        if (user && user.strategy) {
          userTokens = filterTokensByStrategy(filteredTokens, user.strategy);
        }
        // استبعاد التوكنات المرسلة سابقًا لهذا المستخدم
        const sentHashes = readSentHashes(userId);
        userTokens = userTokens.filter(token => {
          const addr = token.pairAddress || token.address || token.tokenAddress || '';
          const hash = hashTokenAddress(addr);
          return !sentHashes.has(hash);
        });
        if (!userTokens || userTokens.length === 0 || (user.strategy && !user.strategy.enabled)) continue;
        // Limit number of tokens sent (e.g. first 10)
        const limitedTokens = userTokens.slice(0, 10);
        const botUsername = bot.botInfo?.username || process.env.BOT_USERNAME || 'YourBotUsername';
        for (const token of limitedTokens) {
          const addr = token.pairAddress || token.address || token.tokenAddress || '';
          const hash = hashTokenAddress(addr);
          const { msg, inlineKeyboard } = buildTokenMessage(token, botUsername, addr);
          if (msg && typeof msg === 'string') {
            try {
              await bot.telegram.sendMessage(userId, msg, {
                parse_mode: 'HTML',
                disable_web_page_preview: false,
                reply_markup: { inline_keyboard: inlineKeyboard }
              });
              // بعد الإرسال، أضف الـ hash إلى ملفات sent_tokens لهذا المستخدم
              appendSentHash(userId, hash);
            } catch (err) {
              console.error(`Failed to send message to user ${userId}:`, err);
            }
          }
        }
      }
    } catch (err) {
      console.error('Error in pollAndNotify:', err);
    }
  }
  setInterval(pollAndNotify, 60 * 1000);
  pollAndNotify();
}

export { registerWsNotifications };