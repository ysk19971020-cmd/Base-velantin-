// ---------------------------------------------------------------------------
// PayPal Payment Provider Adapter
// ---------------------------------------------------------------------------
// Implements PaymentProviderAdapter using the PayPal REST API v2 (Orders)
// and v1 (Payouts).
//
// Required env vars:
//   PAYPAL_CLIENT_ID      — PayPal REST app client ID
//   PAYPAL_CLIENT_SECRET   — PayPal REST app secret
//
// Optional env vars:
//   PAYPAL_MODE            — "sandbox" (default) or "live"
//   PAYPAL_CURRENCY        — 3-letter currency code, default "USD"
//   PAYPAL_WEBHOOK_ID      — webhook ID for signature verification
// ---------------------------------------------------------------------------

import type {
  PaymentProviderAdapter,
  CoinPurchaseResult,
  CreateCoinPurchaseParams,
  WebhookResult,
  WithdrawResult,
  CreateWithdrawParams,
} from "./types";

// ---- Config ---------------------------------------------------------------

function getBaseUrl(): string {
  const mode = process.env.PAYPAL_MODE ?? "sandbox";
  return mode === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

function getCurrency(): string {
  return process.env.PAYPAL_CURRENCY ?? "USD";
}

function requireCredentials() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !secret) {
    throw new Error(
      "PayPal credentials are missing. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET environment variables.",
    );
  }
  return { clientId, secret };
}

// ---- Access Token ---------------------------------------------------------

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const { clientId, secret } = requireCredentials();
  const base64 = Buffer.from(`${clientId}:${secret}`).toString("base64");

  const res = await fetch(`${getBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${base64}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PayPal token request failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  // Expire 60 s before the real expiry to be safe
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };

  return cachedToken.token;
}

// ---- Helper: authenticated fetch -------------------------------------------

async function paypalFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${getBaseUrl()}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    },
  });

  const body = await res.json();
  if (!res.ok) {
    throw new Error(
      `PayPal API error (${res.status}): ${JSON.stringify(body)}`,
    );
  }
  return body as T;
}

// ---- Webhook signature verification ---------------------------------------

/**
 * Verifies a PayPal webhook by calling the verify-webhook-signature endpoint.
 * Returns the parsed event body if valid, throws otherwise.
 */
async function verifyWebhook(
  rawBody: string,
  headers: Record<string, string>,
): Promise<unknown> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) {
    throw new Error(
      "PayPal webhook verification failed: PAYPAL_WEBHOOK_ID is not set.",
    );
  }

  // PayPal sends the full body; we pass it through.
  const body = JSON.parse(rawBody);

  const verification = await paypalFetch<{
    verification_status: string;
  }>("/v1/notifications/verify-webhook-signature", {
    method: "POST",
    body: JSON.stringify({
      auth_algo: headers["paypal-auth-algo"] ?? "",
      cert_url: headers["paypal-cert-url"] ?? "",
      transmission_id: headers["paypal-transmission-id"] ?? "",
      transmission_sig: headers["paypal-transmission-sig"] ?? "",
      transmission_time: headers["paypal-transmission-time"] ?? "",
      webhook_id: webhookId,
      webhook_event: body,
    }),
  });

  if (verification.verification_status !== "SUCCESS") {
    throw new Error("PayPal webhook signature verification failed.");
  }

  return body;
}

// ---- Adapter --------------------------------------------------------------

// PayPal order response shapes (partial — only the fields we use)

interface PayPalOrderResponse {
  id: string;
  status: string;
  links?: Array<{ href: string; rel: string }>;
  purchase_units?: Array<{
    reference_id?: string;
    custom_id?: string;
    amount?: { currency_code: string; value: string };
  }>;
}

interface PayPalPayoutResponse {
  batch_header: {
    payout_batch_id: string;
    batch_status: string;
  };
  items: Array<{
    payout_item_id: string;
    transaction_id?: string;
    transaction_status: string;
    errors?: Array<{ message: string }>;
  }>;
}

/**
 * Generates a PayPal order ID by calling the Orders API and returns the
 * approval URL so the frontend can redirect the user.
 */
async function createCoinPurchase(
  params: CreateCoinPurchaseParams,
): Promise<CoinPurchaseResult> {
  requireCredentials();

  const currency = getCurrency();

  const order = await paypalFetch<PayPalOrderResponse>(
    "/v2/checkout/orders",
    {
      method: "POST",
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: params.packId,
            custom_id: params.userId,
            amount: {
              currency_code: currency,
              value: String(params.amount),
            },
            description: `Coin purchase: ${params.coins} coins`,
          },
        ],
      }),
    },
  );

  // Find the approval link
  const approvalLink = order.links?.find(
    (l) => l.rel === "approve",
  )?.href;

  return {
    orderId: order.id,
    approvalUrl: approvalLink,
    providerRef: order.id,
    status: order.status === "COMPLETED" ? "paid" : "pending",
  };
}

/**
 * Handles an incoming PayPal webhook for purchase events.
 * Currently handles:
 *   - CHECKOUT.ORDER.APPROVED  → mark as pending (awaiting capture)
 *   - CHECKOUT.ORDER.COMPLETED → mark as paid, credit coins
 */
async function handlePurchaseWebhook(
  body: unknown,
  headers: Record<string, string>,
): Promise<WebhookResult> {
  // body may be a parsed object; re-stringify for verification
  const rawBody = typeof body === "string" ? body : JSON.stringify(body);
  const event = (await verifyWebhook(rawBody, headers)) as Record<string, unknown>;

  const eventType = event.event_type as string;

  // Extract the resource (order object)
  const resource = event.resource as Record<string, unknown> | undefined;
  if (!resource) {
    throw new Error("PayPal webhook missing resource.");
  }

  const orderId = resource.id as string;
  const purchaseUnits = resource.purchase_units as
      | Array<Record<string, unknown>>
      | undefined;
  const firstUnit = purchaseUnits?.[0];
  const userId = (firstUnit?.custom_id as string) ?? "";
  const coinsStr = String(firstUnit?.description ?? "0");
  // Try to extract coins from description "Coin purchase: X coins"
  const coinsMatch = coinsStr.match(/(\d+)/);
  const coins = coinsMatch ? parseInt(coinsMatch[1], 10) : 0;

  if (eventType === "CHECKOUT.ORDER.COMPLETED") {
    return {
      orderId,
      userId,
      coins,
      ok: true,
      providerRef: orderId,
    };
  }

  if (eventType === "CHECKOUT.ORDER.APPROVED") {
    return {
      orderId,
      userId,
      coins,
      ok: false, // not yet captured
      providerRef: orderId,
    };
  }

  // Other events — return ok: false so caller ignores them
  return {
    orderId: orderId ?? "unknown",
    userId,
    coins,
    ok: false,
    providerRef: orderId,
  };
}

/**
 * Sends a single-item PayPal payout to the user's destination (email).
 * Uses the Payouts API (v1).
 */
async function createWithdraw(
  params: CreateWithdrawParams,
): Promise<WithdrawResult> {
  requireCredentials();

  const currency = getCurrency();
  const senderBatchId = `wd_${params.userId}_${Date.now()}`;

  const payout = await paypalFetch<PayPalPayoutResponse>(
    "/v1/payments/payouts",
    {
      method: "POST",
      body: JSON.stringify({
        sender_batch_header: {
          sender_batch_id: senderBatchId,
          email_subject: "Valentine Express — Diamond Withdrawal",
          email_message: `You have requested a withdrawal of ${currency} ${params.amount}.`,
        },
        items: [
          {
            recipient_type: "EMAIL",
            amount: {
              value: String(params.amount),
              currency,
            },
            receiver: params.destination,
            note: `Withdrawal for ${params.diamonds} diamonds`,
            sender_item_id: `item_${params.userId}_${Date.now()}`,
          },
        ],
      }),
    },
  );

  const header = payout.batch_header;
  const item = payout.items[0];

  if (item?.errors && item.errors.length > 0) {
    return {
      batchId: header.payout_batch_id,
      itemId: item.payout_item_id,
      status: "failed",
    };
  }

  const statusMap: Record<string, WithdrawResult["status"]> = {
    SUCCESS: "paid",
    PENDING: "pending",
    DENIED: "failed",
    FAILED: "failed",
    UNCLAIMED: "pending",
    RETURNED: "failed",
  };

  return {
    batchId: header.payout_batch_id,
    itemId: item?.payout_item_id,
    status:
      statusMap[item?.transaction_status ?? ""] ?? "pending",
  };
}

/**
 * Optional callback to process an async withdraw result (e.g. status poll).
 * Currently a no-op — payouts are synchronous in our flow.
 */
async function handleWithdrawResult(_result: WithdrawResult): Promise<void> {
  // No-op for PayPal — the Payouts API returns final status synchronously.
  // Future: poll GET /v1/payments/payouts/{batch_id} for status updates.
}

// ---- Exported adapter -----------------------------------------------------

export const paypalProvider: PaymentProviderAdapter = {
  name: "paypal",
  createCoinPurchase,
  handlePurchaseWebhook,
  createWithdraw,
  handleWithdrawResult,
};
