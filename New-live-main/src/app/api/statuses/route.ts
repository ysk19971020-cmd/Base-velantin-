import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser, isNextResponse } from '@/lib/session';

export async function GET() {
  try {
    const statuses = await db.status.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return NextResponse.json(statuses);
  } catch (error) {
    console.error('Fetch statuses error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (isNextResponse(auth)) return auth;
    const userId = auth.userId;

    const body = await request.json();
    const { text, imageUrl } = body;

    if (typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json(
        { error: 'text must not be empty' },
        { status: 400 },
      );
    }
    if (imageUrl !== undefined && imageUrl !== null && typeof imageUrl !== 'string') {
      return NextResponse.json({ error: 'imageUrl must be a string' }, { status: 400 });
    }

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const status = await db.status.create({
      data: {
        userId,
        userName: user.name,
        text: text.trim().slice(0, 300),
        imageUrl: imageUrl || null,
      },
    });

    return NextResponse.json(status, { status: 201 });
  } catch (error) {
    console.error('Create status error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
