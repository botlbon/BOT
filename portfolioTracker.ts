// portfolioTracker.ts
// Copy trading logic for Telegram bot
import fs from 'fs';
import { autoBuy } from './utils/autoBuy';
import { sellWithOrca } from './sell';

export type CopyTradeEvent = {
  wallet: string;
  type: 'buy' | 'sell';
  token: string;
  amount: number;
  tx: string;
  timestamp: number;
};

export type PortfolioTrackerUser = {
  userId: string;
  copiedWallets: string[];
  secret: string;
  wallet: string;
};

// Simulated trade history DB (replace with real DB or API)
const TRADE_HISTORY_FILE = 'copied_trades.json';

export function loadTradeHistory(): CopyTradeEvent[] {
  try {
    if (fs.existsSync(TRADE_HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(TRADE_HISTORY_FILE, 'utf8'));
    }
  } catch {}
  return [];
}

export function saveTradeHistory(history: CopyTradeEvent[]) {
  fs.writeFileSync(TRADE_HISTORY_FILE, JSON.stringify(history, null, 2));
}

// Monitor copied wallets and replicate trades for users
export async function monitorCopiedWallets(users: Record<string, PortfolioTrackerUser>) {
  // Load previous trades
  const history = loadTradeHistory();
  // For each user, check copied wallets
  for (const userId in users) {
    const user = users[userId];
    for (const wallet of user.copiedWallets) {
      // Simulate fetching recent trades for wallet (replace with real API)
      const recentTrades: CopyTradeEvent[] = history.filter(e => e.wallet === wallet && e.timestamp > Date.now() - 60000);
      for (const trade of recentTrades) {
        // Check if user already copied this trade
        const alreadyCopied = history.some(e => e.wallet === user.wallet && e.tx === trade.tx);
        if (alreadyCopied) continue;
        // Replicate trade
        try {
          let tx = '';
          if (trade.type === 'buy') {
            tx = await autoBuy(trade.token, trade.amount, user.secret);
          } else {
            const sellTx = await sellWithOrca(trade.token, trade.amount);
            tx = typeof sellTx === 'string' ? sellTx : '';
          }
          // Save copied trade
          history.push({
            wallet: user.wallet,
            type: trade.type,
            token: trade.token,
            amount: trade.amount,
            tx,
            timestamp: Date.now()
          });
          saveTradeHistory(history);
        } catch {}
      }
    }
  }
}

// You can call monitorCopiedWallets(users) in a setInterval from the main bot file.
