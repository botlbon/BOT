// API endpoint to receive wallet auth from web page and notify the bot
const express = require('express');
const bodyParser = require('body-parser');
const { Telegraf } = require('telegraf');
const bs58 = require('bs58');
const solanaWeb3 = require('@solana/web3.js');
const nacl = require('tweetnacl');
require('dotenv').config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const users = require('../telegramBot').users;
const pendingWalletVerifications = require('../telegramBot').pendingWalletVerifications;

const app = express();
app.use(bodyParser.json());

app.post('/api/wallet-auth', async (req, res) => {
  const { userId, address, message, signature } = req.body;
  if (!userId || !address || !message || !signature) return res.status(400).send('Missing fields');
  try {
    const pubkey = new solanaWeb3.PublicKey(address);
    const sigBuf = Uint8Array.from(signature);
    const isValid = nacl.sign.detached.verify(
      Buffer.from(message),
      sigBuf,
      pubkey.toBytes()
    );
    if (isValid) {
      users[userId] = users[userId] || { trades: 0, activeTrades: 1, history: [] };
      users[userId].wallet = address;
      users[userId].history.push(`تم ربط المحفظة تلقائياً عبر صفحة الويب: ${address}`);
      delete pendingWalletVerifications[userId];
      await bot.telegram.sendMessage(userId, '✅ تم ربط محفظتك تلقائياً عبر صفحة الويب!');
      return res.send('ok');
    } else {
      return res.status(400).send('Invalid signature');
    }
  } catch (e) {
    return res.status(500).send('Error verifying signature');
  }
});

app.listen(3001, () => console.log('Wallet connect API running on port 3001'));
