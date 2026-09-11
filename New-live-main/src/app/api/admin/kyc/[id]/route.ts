import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin, isNextResponse } from '@/lib/session';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAdmin(request);
    if (isNextResponse(auth)) return auth;
    const adminUserId = auth.userId;

    const { id } = await params;
    const body = await request.json();
    const { action } = body;

    if (!action || !['approve', 'reject'].includes(action)) {
      return NextResponse.json(
        { error: 'action must be "approve" or "reject"' },
        { status: 400 },
      );
    }

    // Find KYC submission
    const submission = await db.kycSubmission.findUnique({ where: { id } });
    if (!submission) {
      return NextResponse.json(
        { error: 'KYC submission not found' },
        { status: 404 },
      );
    }

    if (submission.status !== 'pending') {
      return NextResponse.json(
        { error: `Cannot review a submission with status: ${submission.status}` },
        { status: 400 },
      );
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';

    const updated = await db.kycSubmission.update({
      where: { id },
      data: {
        status: newStatus,
        reviewedBy: adminUserId,
        reviewedAt: new Date(),
      },
    });

    return NextResponse.json({ ok: true, status: updated.status });
  } catch (error) {
    console.error('Admin KYC review error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
