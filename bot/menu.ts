// Main menu and keyboards
import { Markup } from 'telegraf';

export function walletKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔑 Restore Wallet', 'restore_wallet'), Markup.button.callback('🆕 Create Wallet', 'create_wallet')]
  ]);
}

export function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🟢 Buy', 'buy'), Markup.button.callback('🔴 Sell', 'sell')],
    [Markup.button.callback('⚙️ Strategy', 'set_strategy'), Markup.button.callback('🍯 Honey Points', 'honey_points')],
    [Markup.button.callback('📊 Activity', 'show_activity'), Markup.button.callback('👛 Wallet', 'my_wallet')],
    [Markup.button.callback('💰 Sell All', 'sell_all_wallet'), Markup.button.callback('📋 Copy Trade', 'copy_trade')],
    [Markup.button.callback('🔗 Invite Friends', 'invite_friends')]
  ]);
}
