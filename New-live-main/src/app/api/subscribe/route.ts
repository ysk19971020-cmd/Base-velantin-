import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Public subscribe endpoint — lets visitors sign up for live-stream email
// alerts without needing an app account. Emails are stored in Subscriber.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, name } = body ?? {};

    if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
      return NextResponse.json(
        { error: 'A valid email address is required' },
        { status: 400 },
      );
    }
    if (name !== undefined && name !== null && typeof name !== 'string') {
      return NextResponse.json({ error: 'name must be a string' }, { status: 400 });
    }

    const subscriber = await db.subscriber.upsert({
      where: { email: email.trim().toLowerCase() },
      update: name ? { name: name.trim().slice(0, 80) } : {},
      create: {
        email: email.trim().toLowerCase(),
        name: name ? name.trim().slice(0, 80) : null,
      },
    });

    return NextResponse.json({ ok: true, email: subscriber.email }, { status: 201 });
  } catch (error) {
    console.error('Subscribe error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
