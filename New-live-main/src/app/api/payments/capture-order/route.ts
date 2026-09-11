import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser, isNextResponse } from '@/lib/session';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (isNextResponse(auth)) return auth;

    const body = await request.json();
    const { orderId, providerRef } = body;

    if (!orderId || !providerRef) {
      return NextResponse.json(
        { error: 'orderId and providerRef are required' },
        { status: 400 },
      );
    }

    // Look up our internal order
    const order = await db.coinOrder.findUnique({ where: { id: orderId } });
    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 },
      );
    }

    // An order can only be captured by the user who created it
    if (order.userId !== auth.userId) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 },
      );
    }

    // providerRef in the request must match what we actually stored for
    // this order — prevents swapping in an unrelated PayPal order id
    if (order.providerRef && order.providerRef !== providerRef) {
      return NextResponse.json(
        { error: 'providerRef does not match this order' },
        { status: 400 },
      );
    }

    if (order.status === 'paid') {
      return NextResponse.json({ ok: true, coins: order.coins });
    }

    // Verify with PayPal: GET /v2/checkout/orders/{id}
    const mode = process.env.PAYPAL_MODE ?? 'sandbox';
    const baseUrl = mode === 'live'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com';

    const clientId = process.env.PAYPAL_CLIENT_ID;
    const secret = process.env.PAYPAL_CLIENT_SECRET;
    if (!clientId || !secret) {
      return NextResponse.json(
        { error: 'PayPal credentials not configured' },
        { status: 500 },
      );
    }

    const base64 = Buffer.from(`${clientId}:${secret}`).toString('base64');
    const tokenRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${base64}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const tokenData = await tokenRes.json() as { access_token: string };
    const accessToken = tokenData.access_token;

    const orderRes = await fetch(`${baseUrl}/v2/checkout/orders/${providerRef}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const paypalOrder = await orderRes.json() as { status: string };

    if (!['COMPLETED', 'APPROVED'].includes(paypalOrder.status)) {
      return NextResponse.json(
        { error: `Order not yet approved (status: ${paypalOrder.status})` },
        { status: 400 },
      );
    }

    // If APPROVED but not COMPLETED, attempt to capture
    let finalStatus = paypalOrder.status;
    if (paypalOrder.status === 'APPROVED') {
      const captureRes = await fetch(`${baseUrl}/v2/checkout/orders/${providerRef}/capture`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });
      const captureData = await captureRes.json() as { status: string };
      finalStatus = captureData.status;
    }

    if (finalStatus === 'COMPLETED') {
      // Update order and credit wallet in a transaction
      const result = await db.$transaction(async (tx) => {
        const updated = await tx.coinOrder.update({
          where: { id: orderId },
          data: {
            status: 'paid',
            paidAt: new Date(),
          },
        });

        await tx.wallet.update({
          where: { userId: order.userId },
          data: { coins: { increment: order.coins } },
        });

        return updated;
      });

      return NextResponse.json({ ok: true, coins: result.coins });
    }

    return NextResponse.json(
      { error: 'Could not capture order' },
      { status: 400 },
    );
  } catch (error) {
    console.error('Capture order error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
