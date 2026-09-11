import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
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
        { error: `Cannot reject a cashout with status: ${cashout.status}` },
        { status: 400 },
      );
    }

    // Reject and refund diamonds in a transaction
    await db.$transaction(async (tx) => {
      await tx.cashoutRequest.update({
        where: { id },
        data: {
          status: 'rejected',
          processedAt: new Date(),
          processedBy: adminUserId,
        },
      });

      await tx.wallet.update({
        where: { userId: cashout.userId },
        data: { diamonds: { increment: cashout.diamonds } },
      });
    });

    return NextResponse.json({ ok: true, status: 'rejected' });
  } catch (error) {
    console.error('Reject cashout error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
