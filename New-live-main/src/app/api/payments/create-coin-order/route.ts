import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getBuyProvider } from '@/server/payments';
import { requireUser, isNextResponse } from '@/lib/session';

const COIN_PACKS: Record<string, { coins: number; price: number }> = {
  starter: { coins: 100, price: 0.99 },
  plus: { coins: 500, price: 4.99 },
  pro: { coins: 1200, price: 9.99 },
};

export async function POST(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (isNextResponse(auth)) return auth;
    const userId = auth.userId;

    const body = await request.json();
    const { packId } = body;

    if (!packId) {
      return NextResponse.json(
        { error: 'packId is required' },
        { status: 400 },
      );
    }

    const pack = COIN_PACKS[packId];
    if (!pack) {
      return NextResponse.json(
        { error: 'Invalid packId. Must be one of: starter, plus, pro' },
        { status: 400 },
      );
    }

    // Verify user exists
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 },
      );
    }

    const currency = process.env.PAYPAL_CURRENCY ?? 'USD';

    // Create pending order in DB
    const order = await db.coinOrder.create({
      data: {
        userId,
        packId,
        coins: pack.coins,
        amount: pack.price,
        currency,
        status: 'pending',
      },
    });

    // Call payment provider
    const provider = getBuyProvider();
    const result = await provider.createCoinPurchase({
      userId,
      packId,
      amount: pack.price,
      currency,
      coins: pack.coins,
    });

    // Update DB with provider reference
    await db.coinOrder.update({
      where: { id: order.id },
      data: {
        providerRef: result.providerRef,
        provider: provider.name,
      },
    });

    return NextResponse.json({
      orderId: order.id,
      approvalUrl: result.approvalUrl,
      providerRef: result.providerRef,
    });
  } catch (error) {
    console.error('Create coin order error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
