import type { PravaCheckoutRequest, PravaCheckoutResult } from "../domain.ts";
import {
  OneTimePravaCheckoutCredential,
  type PravaCheckoutCredentials,
} from "./prava-shopping-server.ts";

export type PravaPaymentSession = {
  readonly sessionId: string;
  readonly iframeUrl: string;
  readonly expiresAt: string;
};

export type PravaPaymentCredentialResult =
  | { readonly _tag: "pending" }
  | { readonly _tag: "failed"; readonly explanation: string }
  | {
      readonly _tag: "ready";
      readonly transactionReference: string;
      readonly credential: OneTimePravaCheckoutCredential;
    };

type PravaApiConfig = {
  readonly baseUrl: string;
  readonly secretKey: string;
  readonly userId: string;
  readonly userEmail: string;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function apiConfigFrom(env: Readonly<Record<string, string | undefined>>): PravaApiConfig {
  const baseUrl = nonEmptyString(env.PRAVA_API_BASE_URL);
  const secretKey = nonEmptyString(env.PRAVA_SECRET_KEY);
  const userId = nonEmptyString(env.PRAVA_DEMO_USER_ID);
  const userEmail = nonEmptyString(env.PRAVA_DEMO_USER_EMAIL);
  if (baseUrl === undefined || secretKey === undefined || userId === undefined || userEmail === undefined) {
    throw new Error("Prava sandbox session configuration is incomplete");
  }
  const url = new URL(baseUrl);
  if (
    url.protocol !== "https:" ||
    url.origin !== "https://sandbox.api.prava.space" ||
    url.pathname.replace(/\/$/, "") !== "" ||
    !secretKey.startsWith("sk_test_") ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)
  ) {
    throw new Error("Prava sandbox session configuration is invalid");
  }
  return { baseUrl: url.origin, secretKey, userId, userEmail };
}

async function errorMessage(response: Response): Promise<string> {
  const payload: unknown = await response.json().catch(() => undefined);
  return nonEmptyString(record(record(payload)?.error)?.message) ?? `Prava API returned ${response.status}`;
}

/** Creates one short-lived hosted Prava sandbox session for an exact Purchase Authorization. */
export async function createPravaPaymentSession(
  request: PravaCheckoutRequest,
  env: Readonly<Record<string, string | undefined>>,
  fetcher: typeof fetch = fetch,
): Promise<PravaPaymentSession> {
  const config = apiConfigFrom(env);
  const totalAmount = request.maximumTotalInr.toFixed(2);
  const response = await fetcher(`${config.baseUrl}/v1/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      user_id: config.userId,
      user_email: config.userEmail,
      total_amount: totalAmount,
      currency: "INR",
      external_order_ref: request.authorizationId,
      description: `${request.product.manufacturer} ${request.product.model}`,
      integration_type: "full_checkout",
      purchase_context: [{
        merchant_details: {
          name: request.offer.merchant,
          url: new URL(request.offer.url).origin,
          country_code_iso2: "IN",
          category_code: "5732",
          category: "Electronics",
        },
        product_details: [{
          product_id: request.offer.id,
          description: `${request.product.manufacturer} ${request.product.model} ${request.product.variant}`,
          unit_price: totalAmount,
          quantity: request.quantity,
        }],
        effective_until_minutes: 10,
      }],
    }),
  });
  if (response.status !== 201) throw new Error(await errorMessage(response));
  const payload: unknown = await response.json();
  const session = record(payload);
  const sessionId = nonEmptyString(session?.session_id);
  const iframeUrl = nonEmptyString(session?.iframe_url);
  const expiresAt = nonEmptyString(session?.expires_at);
  if (
    sessionId === undefined || iframeUrl === undefined || expiresAt === undefined ||
    !Number.isFinite(Date.parse(expiresAt)) || new URL(iframeUrl).protocol !== "https:"
  ) {
    throw new Error("Prava API returned an invalid payment session");
  }
  return { sessionId, iframeUrl, expiresAt };
}

function parseCredential(lineItem: Record<string, unknown>): PravaCheckoutCredentials | undefined {
  const token = nonEmptyString(lineItem.token);
  const cryptogram = nonEmptyString(lineItem.dynamic_cvv);
  const expiryMonth = nonEmptyString(lineItem.expiry_month);
  const expiryYear = nonEmptyString(lineItem.expiry_year);
  if (
    token === undefined || !/^\d{16}$/.test(token) ||
    cryptogram === undefined || !/^\d{3,4}$/.test(cryptogram) ||
    expiryMonth === undefined || !/^(0[1-9]|1[0-2])$/.test(expiryMonth) ||
    expiryYear === undefined || !/^20\d{2}$/.test(expiryYear)
  ) return undefined;
  return { token, cryptogram, expiryMonth, expiryYear };
}

/** Polls server-side for a single-use credential and never serializes it to the browser. */
export async function pollPravaPaymentCredential(
  sessionId: string,
  request: PravaCheckoutRequest,
  env: Readonly<Record<string, string | undefined>>,
  fetcher: typeof fetch = fetch,
): Promise<PravaPaymentCredentialResult> {
  const config = apiConfigFrom(env);
  if (!/^ses{1,2}_[A-Za-z0-9_-]+$/.test(sessionId)) throw new Error("Invalid Prava session id");
  const response = await fetcher(
    `${config.baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/payment-result?_t=${Date.now()}`,
    { headers: { Authorization: `Bearer ${config.secretKey}` }, cache: "no-store" },
  );
  if (!response.ok) throw new Error(await errorMessage(response));
  const payload: unknown = await response.json();
  const result = record(payload);
  if (result?.status === "pending") return { _tag: "pending" };
  if (result?.status === "failed") {
    const transaction = Array.isArray(result.transactions) ? record(result.transactions[0]) : undefined;
    const failure = nonEmptyString(record(transaction?.error)?.message) ?? "Prava card approval failed";
    return { _tag: "failed", explanation: failure };
  }
  if (result?.status !== "awaiting_result" || !Array.isArray(result.transactions)) {
    return { _tag: "failed", explanation: "Prava returned an unexpected payment state" };
  }
  const transaction = record(result.transactions[0]);
  const lineItem = Array.isArray(transaction?.line_items) && transaction.line_items.length === 1
    ? record(transaction.line_items[0])
    : undefined;
  const transactionReference = nonEmptyString(lineItem?.txn_ref_id);
  const merchantName = nonEmptyString(lineItem?.merchant_name);
  const totalAmount = nonEmptyString(lineItem?.total_amount);
  const credential = lineItem === undefined ? undefined : parseCredential(lineItem);
  if (
    transactionReference === undefined || merchantName !== request.offer.merchant ||
    totalAmount === undefined || Number(totalAmount) !== request.maximumTotalInr ||
    credential === undefined
  ) {
    return { _tag: "failed", explanation: "Prava payment credentials did not match the authorization" };
  }
  return {
    _tag: "ready",
    transactionReference,
    credential: new OneTimePravaCheckoutCredential(credential),
  };
}

/** Reports a confirmed merchant checkout result to close the Prava sandbox transaction. */
export async function reportPravaPaymentStatus(
  sessionId: string,
  transactionReference: string,
  result: PravaCheckoutResult,
  env: Readonly<Record<string, string | undefined>>,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (
    result._tag === "submitted" && result.paymentStatus === "unknown"
  ) return;
  const config = apiConfigFrom(env);
  const approved = result._tag === "submitted" && result.paymentStatus === "successful";
  const response = await fetcher(
    `${config.baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/report-status`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        txn_ref_id: transactionReference,
        txn_status: approved ? "APPROVED" : "DECLINED",
        ...(approved
          ? { authorization_code: "PRAVA_SANDBOX", response_code: "00" }
          : { response_code: "05" }),
      }),
    },
  );
  if (!response.ok) throw new Error(await errorMessage(response));
}
