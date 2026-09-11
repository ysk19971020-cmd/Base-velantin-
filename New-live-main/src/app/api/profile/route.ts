import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser, isNextResponse } from '@/lib/session';

export async function GET(request: NextRequest) {
  try {
    // Viewing another user's public profile is allowed (e.g. from chat/live);
    // fall back to the caller's own id when none is specified.
    let userId = request.nextUrl.searchParams.get('userId');
    if (!userId) {
      const auth = await requireUser(request);
      if (isNextResponse(auth)) return auth;
      userId = auth.userId;
    }

    const profile = await db.profile.findUnique({
      where: { userId },
    });

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    return NextResponse.json({ profile });
  } catch (error) {
    console.error('Profile GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (isNextResponse(auth)) return auth;
    const userId = auth.userId;

    const body = await request.json();
    const { bio, birthday, city, gender, avatarUrl } = body;

    // Validate gender
    if (gender && !['male', 'female', 'other'].includes(gender)) {
      return NextResponse.json({ error: 'Invalid gender' }, { status: 400 });
    }

    // Validate birthday
    let birthdayDate: Date | undefined;
    if (birthday) {
      birthdayDate = new Date(birthday);
      if (isNaN(birthdayDate.getTime())) {
        return NextResponse.json({ error: 'Invalid birthday' }, { status: 400 });
      }
    }

    const profile = await db.profile.upsert({
      where: { userId },
      update: {
        ...(bio !== undefined && { bio: bio.trim().slice(0, 300) }),
        ...(birthdayDate && { birthday: birthdayDate }),
        ...(city !== undefined && { city: city.trim().slice(0, 100) }),
        ...(gender && { gender }),
        ...(avatarUrl !== undefined && { avatarUrl }),
      },
      create: { userId },
    });

    // Calculate age from birthday
    let age: number | null = null;
    if (profile.birthday) {
      const today = new Date();
      const birth = new Date(profile.birthday);
      age = today.getFullYear() - birth.getFullYear();
      const m = today.getMonth() - birth.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
        age--;
      }
    }

    return NextResponse.json({
      profile: {
        id: profile.id,
        userId: profile.userId,
        avatarUrl: profile.avatarUrl,
        bio: profile.bio,
        birthday: profile.birthday,
        city: profile.city,
        gender: profile.gender,
        age,
      },
    });
  } catch (error) {
    console.error('Profile PUT error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
