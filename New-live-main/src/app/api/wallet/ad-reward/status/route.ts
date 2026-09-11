import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser, isNextResponse } from '@/lib/session';

const AD_REWARD_COOLDOWN_MINUTES = parseInt(process.env.AD_REWARD_COOLDOWN_MINUTES ?? '2', 10);
const AD_REWARD_DAILY_CAP = parseInt(process.env.AD_REWARD_DAILY_CAP ?? '12', 10);
const AD_REWARD_COINS = parseInt(process.env.AD_REWARD_COINS ?? '5', 10);

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (isNextResponse(auth)) return auth;
    const userId = auth.userId;

    const wallet = await db.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      return NextResponse.json({ error: 'Wallet not found' }, { status: 404 });
    }

    const claimedToday = wallet.adRewardsDate === todayStr() ? wallet.adRewardsToday : 0;

    let cooldownUntil: string | null = null;
    if (wallet.lastAdRewardAt) {
      const cooldownMs = AD_REWARD_COOLDOWN_MINUTES * 60 * 1000;
      const readyAt = wallet.lastAdRewardAt.getTime() + cooldownMs;
      if (readyAt > Date.now()) cooldownUntil = new Date(readyAt).toISOString();
    }

    return NextResponse.json({
      claimedToday,
      dailyCap: AD_REWARD_DAILY_CAP,
      coinsPerAd: AD_REWARD_COINS,
      cooldownUntil,
    });
  } catch (error) {
    console.error('Ad reward status error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
