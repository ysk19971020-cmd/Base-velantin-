import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { createSessionToken } from '@/lib/session';

const LOBBY_CHAT_NAME = 'Lobby';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, email, password } = body;

    // Validate name
    if (!name || typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 32) {
      return NextResponse.json(
        { error: 'Name is required and must be 1-32 characters' },
        { status: 400 },
      );
    }

    // Validate email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || typeof email !== 'string' || !emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'A valid email is required' },
        { status: 400 },
      );
    }

    // Validate password
    if (!password || typeof password !== 'string' || password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters' },
        { status: 400 },
      );
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if email already exists
    const existing = await db.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return NextResponse.json(
        { error: 'Email already registered' },
        { status: 409 },
      );
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user, profile, and wallet in a transaction
    const user = await db.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          name: name.trim(),
          email: normalizedEmail,
          password: hashedPassword,
        },
      });

      await tx.profile.create({
        data: { userId: newUser.id },
      });

      await tx.wallet.create({
        data: {
          userId: newUser.id,
          coins: 0,
          diamonds: 0,
          lifetimeEarned: 0,
        },
      });

      // Create lobby chat if not exists, add user as member
      const lobby = await tx.chat.upsert({
        where: { id: 'lobby' },
        update: {},
        create: {
          id: 'lobby',
          name: LOBBY_CHAT_NAME,
          isGroup: true,
        },
      });

      await tx.chatMember.upsert({
        where: {
          chatId_userId: { chatId: lobby.id, userId: newUser.id },
        },
        update: {},
        create: {
          chatId: lobby.id,
          userId: newUser.id,
        },
      });

      return newUser;
    });

    const token = await createSessionToken(user.id);

    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      token,
    }, { status: 201 });
  } catch (error) {
    console.error('Register error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
