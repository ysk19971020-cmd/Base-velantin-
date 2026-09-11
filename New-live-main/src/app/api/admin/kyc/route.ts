import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin, isNextResponse } from '@/lib/session';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (isNextResponse(auth)) return auth;

    const submissions = await db.kycSubmission.findMany({
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(submissions);
  } catch (error) {
    console.error('Admin KYC list error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
