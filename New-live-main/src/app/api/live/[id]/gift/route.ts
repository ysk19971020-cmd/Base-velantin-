import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, isNextResponse } from "@/lib/session";
import { getGiftById, coinsToDiamonds } from "@/server/gifts";

// ---------------------------------------------------------------------------
// POST /api/live/[id]/gift — send a gift during a live (replaces the WS
// service live_gift). The coin cost and diamond payout are looked up
// server-side (never trusted from the client), coins are debited from the
// sender in the same transaction that credits the host's diamonds, and the
// gift is persisted. The client broadcasts the gift flash over the stream's
// Agora RTM channel.
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireUser(request);
    if (isNextResponse(auth)) return auth;

    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const gift = getGiftById(String(body.giftId ?? ""));
    if (!gift) {
      return NextResponse.json({ error: "Unknown gift" }, { status: 400 });
    }

    const live = await db.liveStream.findFirst({
      where: { id, status: "active" },
    });
    if (!live) {
      return NextResponse.json({ error: "Live ended" }, { status: 404 });
    }

    const diamonds = coinsToDiamonds(gift.coins);

    await db.$transaction(async (tx) => {
      const senderWallet = await tx.wallet.findUnique({
        where: { userId: auth.userId },
      });
      if (!senderWallet || senderWallet.coins < gift.coins) {
        throw new Error("Insufficient coins");
      }
      await tx.wallet.update({
        where: { userId: auth.userId },
        data: { coins: { decrement: gift.coins } },
      });
      // Upsert the host's wallet: create with the diamonds if it somehow
      // doesn't exist yet (mirrors the old WS service's addDiamondsToWallet).
      await tx.wallet.upsert({
        where: { userId: live.hostId },
        update: {
          diamonds: { increment: diamonds },
          lifetimeEarned: { increment: diamonds },
        },
        create: {
          userId: live.hostId,
          coins: 0,
          diamonds,
          lifetimeEarned: diamonds,
        },
      });
      await tx.liveGift.create({
        data: {
          streamId: live.id,
          senderId: auth.userId,
          senderName: (await tx.user.findUnique({
            where: { id: auth.userId },
            select: { name: true },
          }))?.name ?? "Unknown",
          giftName: gift.name,
          coins: gift.coins,
          diamonds,
        },
      });
    });

    return NextResponse.json({ ok: true, gift: { name: gift.name, coins: gift.coins } });
  } catch (error) {
    if (error instanceof Error && error.message === "Insufficient coins") {
      return NextResponse.json({ error: "Insufficient coins" }, { status: 400 });
    }
    console.error("Live gift error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
