// improvements.ts
// Suggested improvements for the Telegram trading bot environment
// This file contains practical ideas you can add or modify in the bot

import { Markup } from 'telegraf';

// 1. Loading indicators
export function loadingMessage(ctx: any, text: string = '⏳ Implementation in progress...') {
  return ctx.reply(text);
}

// 2. View wallet balance and currency list
export async function showWalletBalance(ctx: any, user: any) {
  if (!user?.wallet) return ctx.reply('No wallet found.');
  try {
    const res = await fetch(`https://public-api.birdeye.so/public/wallet/token_list?address=${user.wallet}`);
    const data = await res.json();
    const tokens = Array.isArray(data?.data)
      ? data.data.filter((t: any) => t.token_amount > 0.00001)
      : [];
    let msg = `<b>Your wallet balance:</b>\n`;
    msg += tokens.map((t: any, i: number) =>
      `\n${i+1}. <b>${t.token_symbol || '-'}:</b> <code>${t.token_address}</code> | Amount: <b>${t.token_amount}</b>`
    ).join('\n');
    if (!tokens.length) msg += '\nNo tokens found in your wallet.';
    await ctx.reply(msg, { parse_mode: 'HTML' });
  } catch {
    await ctx.reply('Failed to fetch wallet balance.');
  }
}

// 3. Confirm export of secret key
export async function confirmExportKey(ctx: any, user: any) {
  if (!user?.secret) return ctx.reply('No private key found.');
  await ctx.reply('⚠️ Are you sure you want to display your private key?',
    Markup.inlineKeyboard([
      [Markup.button.callback('Yes, show key', 'show_secret_key')],
      [Markup.button.callback('Cancel', 'back_to_menu')]
    ])
  );
}

// 4. Price Alerts
export async function setPriceAlert(ctx: any, user: any) {
  await ctx.reply('🔔 Enter the token address and the price you want to be alerted at (e.g. 1.5 SOL):');
  // Logic for saving and alerting can be added as needed
}

// 5. Graphical statistics (profit/loss chart)
export async function showProfitChart(ctx: any, user: any) {
  // Example: textual summary, can be extended to show images or charts
  await ctx.reply(`📈 Your profit/loss summary:
Total trades: 0
Total profit: 0 SOL
Total loss: 0 SOL
Net result: 0 SOL
More detailed charts coming soon!`);
}

// 6. Warning when sharing the secret key
export function secretKeyWarning(ctx: any) {
  return ctx.reply('⚠️ Important: Never share your private key with anyone. Losing your key means losing your funds.');
}

// 7. Tips for new users
export function onboardingTips(ctx: any) {
  return ctx.reply(`👋 Welcome to the trading bot!
Here are some tips to get started:
• Use the main menu to access wallet, trading, and copy trading features.
• Always keep your private key safe and never share it.
• You can set price alerts and monitor your portfolio easily.
• For help, use the /help command or the Help button.
Happy trading!`);
}
// 8. Operational assistance command
export function detailedHelp(ctx: any) {
  return ctx.reply(`🆘 Usage guide:
/start - Show main menu
/wallet - View wallet and balances
/buy - Buy tokens
/sell - Sell tokens
/exportkey - Export your private key
/invite - Invite friends
/help - Show this help message
For more details, use the buttons in the main menu or contact support.`);
}

