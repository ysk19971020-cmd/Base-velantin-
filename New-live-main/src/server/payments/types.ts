// ---------------------------------------------------------------------------
// Payment Provider Abstraction Layer — Types & Factory
// ---------------------------------------------------------------------------

export type PaymentProvider = "paypal" | "dialog_genie";

// ---- Coin Purchase --------------------------------------------------------

export interface CreateCoinPurchaseParams {
  userId: string;
  packId: string;
  amount: number; // price in minor units or float
  currency: string;
  coins: number;
}

export interface CoinPurchaseResult {
  orderId: string;
  approvalUrl?: string; // for PayPal redirect
  providerRef: string; // PayPal order ID etc.
  status: "pending" | "paid" | "failed";
}

// ---- Webhook --------------------------------------------------------------

export interface WebhookResult {
  orderId: string;
  userId: string;
  coins: number;
  ok: boolean;
  providerRef?: string;
}

// ---- Withdrawal -----------------------------------------------------------

export interface CreateWithdrawParams {
  userId: string;
  amount: number;
  destination: string; // PayPal email, phone, etc.
  diamonds: number;
}

export interface WithdrawResult {
  batchId: string;
  itemId?: string;
  status: "pending" | "paid" | "failed";
}

// ---- Adapter Interface -----------------------------------------------------

export interface PaymentProviderAdapter {
  name: PaymentProvider;
  createCoinPurchase(params: CreateCoinPurchaseParams): Promise<CoinPurchaseResult>;
  handlePurchaseWebhook(
    body: unknown,
    headers: Record<string, string>,
  ): Promise<WebhookResult>;
  createWithdraw(params: CreateWithdrawParams): Promise<WithdrawResult>;
  handleWithdrawResult?(result: WithdrawResult): Promise<void>;
}

// ---- Factory helpers -------------------------------------------------------

/**
 * Returns the payment adapter used for buying coins.
 * Reads `PAYMENTS_BUY_PROVIDER` env var (default: "paypal").
 */
export function getBuyProvider(): PaymentProviderAdapter {
  const name = (process.env.PAYMENTS_BUY_PROVIDER ?? "paypal") as PaymentProvider;
  return resolveProvider(name);
}

/**
 * Returns the payment adapter used for withdrawing diamonds.
 * Reads `PAYMENTS_WITHDRAW_PROVIDER` env var (default: "paypal").
 */
export function getWithdrawProvider(): PaymentProviderAdapter {
  const name = (process.env.PAYMENTS_WITHDRAW_PROVIDER ??
    "paypal") as PaymentProvider;
  return resolveProvider(name);
}

// ---- Internal resolver -----------------------------------------------------

function resolveProvider(name: PaymentProvider): PaymentProviderAdapter {
  switch (name) {
    case "paypal":
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require("./paypal").paypalProvider;
    case "dialog_genie":
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require("./dialogGenie").dialogGenieProvider;
    default:
      throw new Error(
        `Unknown payment provider: "${name}". Supported: paypal, dialog_genie`,
      );
  }
}
