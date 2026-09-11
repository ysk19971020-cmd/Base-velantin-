import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser, isNextResponse } from '@/lib/session';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (isNextResponse(auth)) return auth;

    const users = await db.user.findMany({
      select: {
        id: true,
        name: true,
        createdAt: true,
        profile: { select: { avatarUrl: true, city: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return NextResponse.json(
      users.map(u => ({
        id: u.id,
        name: u.name,
        avatarUrl: u.profile?.avatarUrl ?? null,
        city: u.profile?.city ?? null,
      })),
    );
  } catch (error) {
    console.error('List users error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
