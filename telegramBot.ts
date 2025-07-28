"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const telegraf_1 = require("telegraf");
const solanaWeb3 = __importStar(require("@solana/web3.js"));
const bs58_1 = __importDefault(require("bs58"));
const crypto_1 = __importDefault(require("crypto"));
const autoBuy_1 = require("./utils/autoBuy");
const pumpFunApi_1 = require("./utils/pumpFunApi");
dotenv_1.default.config();
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = 7948630771;
const WELCOME_STICKER = 'CAACAgUAAxkBAAEBQY1kZ...'; // Replace with a valid sticker ID
if (!BOT_TOKEN)
    throw new Error('❌ TELEGRAM_BOT_TOKEN is missing from .env');
const bot = new telegraf_1.Telegraf(BOT_TOKEN);
const users = Object.create(null);
const awaitingUsers = Object.create(null);
const pendingWalletVerifications = Object.create(null);
const boughtTokens = {};
setInterval(async () => {
    try {
        const tokens = await (0, pumpFunApi_1.fetchPumpFunTokens)();
        for (const userId in users) {
            const user = users[userId];
            const strategy = user.strategy;
            if (!strategy || !user.wallet)
                continue;
            if (!boughtTokens[userId])
                boughtTokens[userId] = new Set();
            // مطابقة الشروط
            const matches = tokens.filter(token => token.volume >= (strategy.minVolume || 0) &&
                token.holders >= (strategy.minHolders || 0) &&
                token.ageMinutes >= (strategy.minAge || 0) &&
                !boughtTokens[userId].has(token.address));
            for (const token of matches) {
                try {
                    await (0, autoBuy_1.autoBuy)(token.address, 0.01);
                    boughtTokens[userId].add(token.address);
                    user.history.push(`🚀 شراء تلقائي: ${token.symbol} (${token.address.slice(0, 6)}...)`);
                    await bot.telegram.sendMessage(userId, `🚀 تم شراء ${token.symbol} تلقائياً حسب استراتيجيتك!`);
                }
                catch (e) {
                    await bot.telegram.sendMessage(userId, `❌ فشل شراء ${token.symbol}: ${typeof e === 'object' && e && 'message' in e ? e.message : e}`);
                }
            }
        }
    }
    catch (e) {
        // تجاهل الأخطاء المؤقتة
    }
}, 60 * 1000); // كل دقيقة
// إعداد استراتيجية pump.fun
bot.command('strategy', async (ctx) => {
    const userId = String(ctx.from?.id);
    awaitingUsers[userId] = 'set_strategy_minVolume';
    await ctx.reply('🔢 أدخل الحد الأدنى للفوليوم (مثال: 1000):');
});
async function sendToAdmin(message, ctx) {
    if (ADMIN_ID && Number(ADMIN_ID) > 0) {
        try {
            await ctx.telegram.sendMessage(ADMIN_ID, message);
        }
        catch (err) {
            if (err?.response?.error_code === 400) {
                console.error('⚠️ Admin has not started the bot yet.');
            }
            else {
                console.error('Failed to send message to admin:', err);
            }
        }
    }
}
bot.start(async (ctx) => {
    const userId = String(ctx.from?.id);
    if (!users[userId])
        users[userId] = { trades: 0, activeTrades: 1, history: [] };
    try {
        await ctx.replyWithSticker(WELCOME_STICKER);
    }
    catch (e) { }
    await ctx.reply('👋 Welcome to the trading bot!', telegraf_1.Markup.inlineKeyboard([
        [telegraf_1.Markup.button.callback('🔗 Connect Wallet', 'connect_wallet')],
        [telegraf_1.Markup.button.callback('📊 My Activity', 'show_activity')],
        [telegraf_1.Markup.button.callback('⚙️ Set Trades', 'set_trades')],
        [telegraf_1.Markup.button.callback('❓ Help', 'help')]
    ]));
});
bot.action('back_to_menu', async (ctx) => {
    await ctx.replyWithChatAction('typing');
    await ctx.reply('⬅️ *Main Menu:*', {
        parse_mode: 'Markdown',
        ...telegraf_1.Markup.inlineKeyboard([
            [telegraf_1.Markup.button.callback('🔗 Connect Wallet', 'connect_wallet')],
            [telegraf_1.Markup.button.callback('📊 My Activity', 'show_activity')],
            [telegraf_1.Markup.button.callback('⚙️ Set Trades', 'set_trades')],
            [telegraf_1.Markup.button.callback('❓ Help', 'help')]
        ])
    });
});
bot.action('connect_wallet', async (ctx) => {
    const userId = String(ctx.from?.id);
    const nonce = crypto_1.default.randomBytes(16).toString('hex');
    const message = 'Authorize connection to bot: ' + nonce;
    pendingWalletVerifications[userId] = { address: '', message };
    await ctx.reply(`🚀 *To connect your wallet:*
1️⃣ Send your public wallet address here.
2️⃣ You'll receive a message to sign.
3️⃣ Open your wallet (Phantom, Solflare...) > Sign Message.
4️⃣ Send back the signature.`, { parse_mode: 'Markdown' });
});
bot.action('show_activity', async (ctx) => {
    const userId = String(ctx.from?.id);
    const history = users[userId]?.history || [];
    const text = history.length ? history.map((h) => `• ${h}`).join('\n') : 'No activity yet.';
    await ctx.reply(`📊 *Your Activity:*\n${text}`, {
        parse_mode: 'Markdown',
        ...telegraf_1.Markup.inlineKeyboard([[telegraf_1.Markup.button.callback('⬅️ Back', 'back_to_menu')]])
    });
});
bot.action('set_trades', async (ctx) => {
    const userId = String(ctx.from?.id);
    awaitingUsers[userId] = 'set_trades';
    await ctx.reply('🔢 *Enter number of trades (1 to 10):*', {
        parse_mode: 'Markdown',
        ...telegraf_1.Markup.inlineKeyboard([[telegraf_1.Markup.button.callback('❌ Cancel', 'cancel_input')]])
    });
});
bot.action('cancel_input', async (ctx) => {
    const userId = String(ctx.from?.id);
    delete awaitingUsers[userId];
    await ctx.reply('❌ Input cancelled.');
});
bot.on('text', async (ctx) => {
    const userId = String(ctx.from?.id);
    const text = ctx.message.text.trim();
    const name = ctx.from?.first_name || '';
    await sendToAdmin(`Message from ${name}:\n${text}`, ctx);
    // إعداد استراتيجية pump.fun
    if (awaitingUsers[userId]?.startsWith('set_strategy')) {
        users[userId] = users[userId] || { trades: 0, activeTrades: 1, history: [] };
        users[userId].strategy = users[userId].strategy || {};
        if (awaitingUsers[userId] === 'set_strategy_minVolume') {
            const v = parseFloat(text);
            if (isNaN(v) || v < 0)
                return ctx.reply('❌ أدخل رقم صحيح للفوليوم.');
            users[userId].strategy.minVolume = v;
            awaitingUsers[userId] = 'set_strategy_minHolders';
            return ctx.reply('👥 أدخل الحد الأدنى لعدد الحاملين (مثال: 50):');
        }
        if (awaitingUsers[userId] === 'set_strategy_minHolders') {
            const h = parseInt(text);
            if (isNaN(h) || h < 0)
                return ctx.reply('❌ أدخل رقم صحيح للهولدرز.');
            users[userId].strategy.minHolders = h;
            awaitingUsers[userId] = 'set_strategy_minAge';
            return ctx.reply('⏳ أدخل الحد الأدنى لعمر العملة بالدقائق (مثال: 10):');
        }
        if (awaitingUsers[userId] === 'set_strategy_minAge') {
            const a = parseInt(text);
            if (isNaN(a) || a < 0)
                return ctx.reply('❌ أدخل رقم صحيح للعمر.');
            users[userId].strategy.minAge = a;
            delete awaitingUsers[userId];
            users[userId].history.push(`تم حفظ استراتيجية pump.fun: فوليوم ≥ ${users[userId].strategy.minVolume}, هولدرز ≥ ${users[userId].strategy.minHolders}, عمر ≥ ${users[userId].strategy.minAge} دقيقة`);
            return ctx.reply('✅ تم حفظ استراتيجيتك بنجاح!');
        }
        return;
    }
    // ...existing code...
    if (awaitingUsers[userId] === 'set_trades') {
        const num = parseInt(text);
        if (isNaN(num) || num < 1 || num > 10) {
            await ctx.reply('❌ Must be a number between 1 and 10.');
        }
        else {
            users[userId] = users[userId] || { trades: 0, activeTrades: 1, history: [] };
            users[userId].activeTrades = num;
            users[userId].history.push(`Set trades to: ${num}`);
            await ctx.reply(`✅ Trades set to ${num}.`);
        }
        delete awaitingUsers[userId];
        return;
    }
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text)) {
        const message = pendingWalletVerifications[userId]?.message;
        if (!pendingWalletVerifications[userId]) {
            pendingWalletVerifications[userId] = {};
        }
        pendingWalletVerifications[userId].address = text;
        await ctx.reply(`📝 Sign the following message:\n\n${message}`);
        return;
    }
    if (/^[1-9A-HJ-NP-Za-km-z]{80,120}$/.test(text) && pendingWalletVerifications[userId]) {
        const { address, message } = pendingWalletVerifications[userId];
        try {
            const pubkey = new solanaWeb3.PublicKey(address);
            const signature = bs58_1.default.decode(text);
            const nacl = await import('tweetnacl');
            const isValid = nacl.default.sign.detached.verify(Buffer.from(message), signature, pubkey.toBytes());
            if (isValid) {
                users[userId] = users[userId] || { trades: 0, activeTrades: 1, history: [] };
                users[userId].wallet = address;
                users[userId].history.push(`✅ Wallet linked: ${address}`);
                delete pendingWalletVerifications[userId];
                await ctx.reply('✅ *Wallet linked successfully!*', {
                    parse_mode: 'Markdown'
                });
                await sendToAdmin(`✅ Wallet linked by ${name}:\n${address}`, ctx);
            }
            else {
                await ctx.reply('❌ Invalid signature.');
            }
        }
        catch (err) {
            await ctx.reply('❌ Signature verification failed.');
        }
        return;
    }
});
bot.command('buy', async (ctx) => {
    const userId = String(ctx.from?.id);
    if (!users[userId]?.wallet)
        return ctx.reply('❌ Please connect your wallet first.');
    awaitingUsers[userId + '_buy'] = true;
    ctx.reply('🔍 Send the token mint address to buy:');
});
bot.command('sell', async (ctx) => {
    const userId = String(ctx.from?.id);
    if (!users[userId]?.wallet)
        return ctx.reply('❌ Please connect your wallet first.');
    awaitingUsers[userId + '_sell'] = true;
    ctx.reply('💰 Send the token mint address to sell:');
});
bot.launch()
    .then(() => console.log('✅ Bot is running'))
    .catch((err) => console.error('❌ Bot launch failed:', err));
