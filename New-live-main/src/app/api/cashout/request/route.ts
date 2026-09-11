import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser, isNextResponse } from '@/lib/session';

const CASHOUT_MIN_DIAMONDS = parseInt(process.env.CASHOUT_MIN_DIAMONDS ?? '3000', 10);
const PLATFORM_FEE_RATE = parseFloat(process.env.PLATFORM_FEE_RATE ?? '0.30');
const DIAMONDS_PER_USD = parseInt(process.env.DIAMONDS_PER_USD ?? '200', 10);

export async function POST(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (isNextResponse(auth)) return auth;
    const userId = auth.userId;

    const body = await request.json();
    const { diamonds, paypalEmail } = body;

    if (!diamonds || !paypalEmail) {
      return NextResponse.json(
        { error: 'diamonds and paypalEmail are required' },
        { status: 400 },
      );
    }

    if (typeof diamonds !== 'number' || diamonds < CASHOUT_MIN_DIAMONDS) {
      return NextResponse.json(
        { error: `Minimum ${CASHOUT_MIN_DIAMONDS} diamonds required for cashout` },
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

    // Verify KYC is approved
    const kyc = await db.kycSubmission.findUnique({ where: { userId } });
    if (!kyc || kyc.status !== 'approved') {
      return NextResponse.json(
        { error: 'KYC must be approved before cashing out' },
        { status: 403 },
      );
    }

    // Check wallet balance
    const wallet = await db.wallet.findUnique({ where: { userId } });
    if (!wallet || wallet.diamonds < diamonds) {
      return NextResponse.json(
        { error: 'Insufficient diamonds' },
        { status: 400 },
      );
    }

    // Calculate USD amount after platform fee
    const grossUsd = diamonds / DIAMONDS_PER_USD;
    const netUsd = grossUsd * (1 - PLATFORM_FEE_RATE);

    // Debit diamonds and create cashout request in a transaction
    const cashout = await db.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { userId },
        data: { diamonds: { decrement: diamonds } },
      });

      return tx.cashoutRequest.create({
        data: {
          userId,
          diamonds,
          amount: Math.round(netUsd * 100) / 100,
          currency: process.env.PAYPAL_CURRENCY ?? 'USD',
          paypalEmail,
          status: 'pending',
        },
      });
    });

    return NextResponse.json({
      id: cashout.id,
      status: cashout.status,
      amount: cashout.amount,
    });
  } catch (error) {
    console.error('Cashout request error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
