import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isNextResponse } from '@/lib/session';
import { getSignedUploadParams, type UploadKind } from '@/server/cloudinary';

const VALID_KINDS: UploadKind[] = ['avatar', 'kyc_selfie', 'kyc_nic_front', 'kyc_nic_back', 'status'];

export async function POST(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (isNextResponse(auth)) return auth;
    const userId = auth.userId;

    const body = await request.json();
    const kind = body.kind as string;

    if (!kind || !VALID_KINDS.includes(kind as UploadKind)) {
      return NextResponse.json(
        { error: `kind must be one of: ${VALID_KINDS.join(', ')}` },
        { status: 400 },
      );
    }

    let params;
    try {
      params = getSignedUploadParams(kind as UploadKind, userId);
    } catch (err) {
      console.error('Cloudinary sign error:', err);
      const message = err instanceof Error ? err.message : 'Cloudinary is not configured';
      return NextResponse.json({ error: message }, { status: 502 });
    }

    return NextResponse.json(params);
  } catch (error) {
    console.error('Upload sign error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
