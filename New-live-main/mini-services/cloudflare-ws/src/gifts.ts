// Keep in sync with src/server/gifts.ts and mini-services/ws-service/lib/gifts.ts

export interface GiftDefinition {
  id: string;
  name: string;
  coins: number;
}

export const GIFT_CATALOG: GiftDefinition[] = [
  { id: 'rose', name: 'Rose', coins: 10 },
  { id: 'heart', name: 'Heart', coins: 25 },
  { id: 'kiss', name: 'Kiss', coins: 40 },
  { id: 'letter', name: 'Love Letter', coins: 60 },
  { id: 'bouquet', name: 'Bouquet', coins: 120 },
  { id: 'teddy', name: 'Teddy Bear', coins: 180 },
  { id: 'chocolate', name: 'Chocolate Box', coins: 220 },
  { id: 'spotlight', name: 'Spotlight', coins: 300 },
  { id: 'fireworks', name: 'Fireworks', coins: 500 },
  { id: 'ring', name: 'Diamond Ring', coins: 700 },
  { id: 'crown', name: 'Crown', coins: 900 },
];

export function getGiftById(id: string): GiftDefinition | undefined {
  return GIFT_CATALOG.find((g) => g.id === id);
}

export function coinsToDiamonds(coins: number, platformFeeRate: number): number {
  return Math.max(0, Math.floor(coins * (1 - platformFeeRate)));
}
