import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser, isNextResponse } from '@/lib/session';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (isNextResponse(auth)) return auth;
    const userId = auth.userId;

    const body = await request.json();
    const { token } = body;

    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'token is required' }, { status: 400 });
    }

    await db.user.update({
      where: { id: userId },
      data: { fcmToken: token },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Save FCM token error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Lets a user turn notifications back off (clears the stored token so the
// backend stops trying to push to a device that opted out).
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (isNextResponse(auth)) return auth;

    await db.user.update({
      where: { id: auth.userId },
      data: { fcmToken: null },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Clear FCM token error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
