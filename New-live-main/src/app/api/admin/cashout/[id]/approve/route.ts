import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getWithdrawProvider } from '@/server/payments';
import { requireAdmin, isNextResponse } from '@/lib/session';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAdmin(request);
    if (isNextResponse(auth)) return auth;
    const adminUserId = auth.userId;

    const { id } = await params;

    // Find cashout request
    const cashout = await db.cashoutRequest.findUnique({ where: { id } });
    if (!cashout) {
      return NextResponse.json(
        { error: 'Cashout request not found' },
        { status: 404 },
      );
    }

    if (cashout.status !== 'pending') {
      return NextResponse.json(
        { error: `Cannot approve a cashout with status: ${cashout.status}` },
        { status: 400 },
      );
    }

    const destination = cashout.paypalEmail ?? '';
    if (!destination) {
      return NextResponse.json(
        { error: 'No paypal email on cashout request' },
        { status: 400 },
      );
    }

    // Call withdraw provider
    const provider = getWithdrawProvider();
    let withdrawResult;
    try {
      withdrawResult = await provider.createWithdraw({
        userId: cashout.userId,
        amount: cashout.amount,
        destination,
        diamonds: cashout.diamonds,
      });
    } catch (withdrawError) {
      // Provider failed — refund diamonds
      await db.$transaction(async (tx) => {
        await tx.cashoutRequest.update({
          where: { id },
          data: {
            status: 'failed',
            processedAt: new Date(),
            processedBy: adminUserId,
          },
        });
        await tx.wallet.update({
          where: { userId: cashout.userId },
          data: { diamonds: { increment: cashout.diamonds } },
        });
      });

      console.error('Withdraw provider error:', withdrawError);
      return NextResponse.json(
        { ok: false, status: 'failed', error: 'Withdrawal provider failed, diamonds refunded' },
        { status: 500 },
      );
    }

    // If provider returned failed, refund diamonds
    if (withdrawResult.status === 'failed') {
      await db.$transaction(async (tx) => {
        await tx.cashoutRequest.update({
          where: { id },
          data: {
            status: 'failed',
            providerRef: withdrawResult.batchId,
            processedAt: new Date(),
            processedBy: adminUserId,
          },
        });
        await tx.wallet.update({
          where: { userId: cashout.userId },
          data: { diamonds: { increment: cashout.diamonds } },
        });
      });

      return NextResponse.json({ ok: true, status: 'failed' });
    }

    // Success — update cashout request
    await db.cashoutRequest.update({
      where: { id },
      data: {
        status: withdrawResult.status === 'paid' ? 'paid' : 'pending',
        providerRef: withdrawResult.batchId,
        processedAt: new Date(),
        processedBy: adminUserId,
      },
    });

    return NextResponse.json({ ok: true, status: withdrawResult.status });
  } catch (error) {
    console.error('Approve cashout error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
