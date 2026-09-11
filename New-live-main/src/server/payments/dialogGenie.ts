// ---------------------------------------------------------------------------
// Dialog Genie Payment Provider Adapter — STUB
// ---------------------------------------------------------------------------
// This is a placeholder implementation. Dialog Genie is a Sri Lankan mobile-
// money / carrier-billing provider used in the Valentine Express project.
//
// To implement this adapter, you will need:
//
//   DIALOG_GENIE_API_KEY          — API key issued by Dialog Genie
//   DIALOG_GENIE_MERCHANT_ID      — Merchant identifier
//   DIALOG_GENIE_BASE_URL         — Base URL of the Dialog Genie API
//                                   (e.g. https://sandbox.dialog.lk/api)
//   DIALOG_GENIE_WEBHOOK_SECRET   — Secret for verifying incoming webhooks
//   DIALOG_GENIE_CURRENCY         — Currency code (default: "LKR")
//
// Refer to the Dialog Genie developer documentation for the exact API
// endpoints, request/response shapes, and signature algorithms.
// ---------------------------------------------------------------------------

import type {
  PaymentProviderAdapter,
  CoinPurchaseResult,
  CreateCoinPurchaseParams,
  WebhookResult,
  WithdrawResult,
  CreateWithdrawParams,
} from "./types";

const NOT_CONFIGURED_MSG =
  'Dialog Genie is not configured yet. Set DIALOG_GENIE_API_KEY, DIALOG_GENIE_MERCHANT_ID, and DIALOG_GENIE_BASE_URL environment variables.';

/**
 * Stub for creating a coin purchase via Dialog Genie.
 *
 * TODO: Implement the following flow:
 * 1. Build a payment-initiation request to the Dialog Genie checkout API
 *    (typically POST to {DIALOG_GENIE_BASE_URL}/payments/initiate).
 * 2. Include the merchant ID, amount, currency, and a callback/redirect URL.
 * 3. Sign the request using DIALOG_GENIE_API_KEY per their spec.
 * 4. Return the { orderId, approvalUrl, providerRef, status: "pending" }.
 *
 * @param _params — purchase parameters (userId, packId, amount, currency, coins)
 * @throws Error if Dialog Genie is not configured
 */
async function createCoinPurchase(
  _params: CreateCoinPurchaseParams,
): Promise<CoinPurchaseResult> {
  throw new Error(NOT_CONFIGURED_MSG);
}

/**
 * Stub for handling a Dialog Genie purchase webhook.
 *
 * TODO: Implement the following flow:
 * 1. Verify the webhook signature using DIALOG_GENIE_WEBHOOK_SECRET.
 * 2. Parse the event body to extract orderId, userId, and coins.
 *    The exact field names depend on Dialog Genie's webhook payload.
 * 3. Map the payment status to "paid" / "failed".
 * 4. Return the { orderId, userId, coins, ok, providerRef }.
 *
 * @param _body — raw webhook body
 * @param _headers — HTTP headers (use for signature verification)
 * @throws Error if Dialog Genie is not configured
 */
async function handlePurchaseWebhook(
  _body: unknown,
  _headers: Record<string, string>,
): Promise<WebhookResult> {
  throw new Error(NOT_CONFIGURED_MSG);
}

/**
 * Stub for creating a withdrawal (disbursement) via Dialog Genie.
 *
 * TODO: Implement the following flow:
 * 1. Call the Dialog Genie disbursement/payout endpoint
 *    (typically POST to {DIALOG_GENIE_BASE_URL}/payouts).
 * 2. Include the destination phone number, amount, and reference.
 * 3. Sign and send the request.
 * 4. Return { batchId, itemId, status }.
 *
 * @param _params — withdrawal parameters (userId, amount, destination, diamonds)
 * @throws Error if Dialog Genie is not configured
 */
async function createWithdraw(
  _params: CreateWithdrawParams,
): Promise<WithdrawResult> {
  throw new Error(NOT_CONFIGURED_MSG);
}

// ---- Exported stub adapter ------------------------------------------------

/**
 * Dialog Genie payment provider adapter (stub — not yet implemented).
 *
 * To activate: set PAYMENTS_BUY_PROVIDER=dialog_genie (or
 * PAYMENTS_WITHDRAW_PROVIDER=dialog_genie) along with the required
 * environment variables listed at the top of this file.
 */
export const dialogGenieProvider: PaymentProviderAdapter = {
  name: "dialog_genie",
  createCoinPurchase,
  handlePurchaseWebhook,
  createWithdraw,
};
