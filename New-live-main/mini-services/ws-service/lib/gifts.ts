// ---------------------------------------------------------------------------
// Server-side gift catalog (ws-service's own copy)
// ---------------------------------------------------------------------------
// IMPORTANT: this must stay in sync with src/server/gifts.ts in the main
// Next.js app. It's duplicated here (rather than imported across the
// mini-services boundary) because ws-service is deployed as a separate,
// self-contained service — some hosts (e.g. Railway with a Root Directory
// set) only include that subdirectory's files in the build context, so
// relative imports reaching outside it (../../src/...) fail to resolve.
// ---------------------------------------------------------------------------

export interface GiftDefinition {
  id: string;
  name: string;
  coins: number;
}

export const GIFT_CATALOG: GiftDefinition[] = [
  { id: "rose", name: "Rose", coins: 10 },
  { id: "heart", name: "Heart", coins: 25 },
  { id: "kiss", name: "Kiss", coins: 40 },
  { id: "letter", name: "Love Letter", coins: 60 },
  { id: "bouquet", name: "Bouquet", coins: 120 },
  { id: "teddy", name: "Teddy Bear", coins: 180 },
  { id: "chocolate", name: "Chocolate Box", coins: 220 },
  { id: "spotlight", name: "Spotlight", coins: 300 },
  { id: "fireworks", name: "Fireworks", coins: 500 },
  { id: "ring", name: "Diamond Ring", coins: 700 },
  { id: "crown", name: "Crown", coins: 900 },
];

const PLATFORM_FEE_RATE = parseFloat(process.env.PLATFORM_FEE_RATE ?? "0.30");

export function getGiftById(id: string): GiftDefinition | undefined {
  return GIFT_CATALOG.find((g) => g.id === id);
}

export function coinsToDiamonds(coins: number): number {
  return Math.max(0, Math.floor(coins * (1 - PLATFORM_FEE_RATE)));
}
