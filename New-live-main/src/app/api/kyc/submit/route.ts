import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser, isNextResponse } from '@/lib/session';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (isNextResponse(auth)) return auth;
    const userId = auth.userId;

    const body = await request.json();
    const { selfieUrl, nicFrontUrl, nicBackUrl } = body;

    if (!selfieUrl) {
      return NextResponse.json(
        { error: 'selfieUrl is required' },
        { status: 400 },
      );
    }

    // Upsert KYC submission
    const submission = await db.kycSubmission.upsert({
      where: { userId },
      update: {
        selfieUrl,
        nicFrontUrl: nicFrontUrl ?? null,
        nicBackUrl: nicBackUrl ?? null,
        status: 'pending',
        reviewedBy: null,
        reviewedAt: null,
      },
      create: {
        userId,
        selfieUrl,
        nicFrontUrl: nicFrontUrl ?? null,
        nicBackUrl: nicBackUrl ?? null,
        status: 'pending',
      },
    });

    return NextResponse.json({ ok: true, status: submission.status });
  } catch (error) {
    console.error('KYC submit error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
