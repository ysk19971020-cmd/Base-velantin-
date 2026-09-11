import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getBuyProvider } from '@/server/payments';

export async function POST(request: NextRequest) {
  try {
    // PayPal sends JSON body
    const body = await request.json();

    // Collect headers for verification
    const headers: Record<string, string> = {};
    const headerKeys = [
      'paypal-auth-algo',
      'paypal-cert-url',
      'paypal-transmission-id',
      'paypal-transmission-sig',
      'paypal-transmission-time',
    ];
    for (const key of headerKeys) {
      const val = request.headers.get(key);
      if (val) headers[key] = val;
    }

    const provider = getBuyProvider();
    const result = await provider.handlePurchaseWebhook(body, headers);

    if (!result.ok) {
      // Not a completion event — acknowledge but don't process
      return NextResponse.json({ received: true });
    }

    // Find the internal order by providerRef
    const order = await db.coinOrder.findFirst({
      where: { providerRef: result.providerRef },
    });

    if (!order) {
      console.error(`Webhook: no order found for providerRef=${result.providerRef}`);
      return NextResponse.json({ received: true });
    }

    if (order.status === 'paid') {
      return NextResponse.json({ received: true });
    }

    // Credit coins in a transaction
    await db.$transaction(async (tx) => {
      await tx.coinOrder.update({
        where: { id: order.id },
        data: {
          status: 'paid',
          paidAt: new Date(),
        },
      });

      await tx.wallet.update({
        where: { userId: order.userId },
        data: { coins: { increment: result.coins } },
      });
    });

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Payment webhook error:', error);
    return NextResponse.json(
      { received: true, error: 'Webhook processing failed' },
      { status: 500 },
    );
  }
}
