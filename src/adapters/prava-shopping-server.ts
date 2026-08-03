import { execFile } from "node:child_process";
import { createPrivateKey, sign } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  SUPPORTED_OFFERS,
  SUPPORTED_PRODUCT,
  type CheckoutQuote,
  type Offer,
  type PravaCheckoutRequest,
  type PravaCheckoutResult,
  type Product,
} from "../domain.js";
import {
  errorLogDetails,
  type PipelineLogDetails,
  type PipelineLogger,
} from "../pipeline-logging.js";

const execFileAsync = promisify(execFile);

type CommandOutput = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut?: boolean;
};

class PravaCommandError extends Error {
  constructor(
    readonly exitCode: number,
    readonly timedOut: boolean,
  ) {
    super("Prava command failed");
  }
}

function pravaErrorLogDetails(cause: unknown): PipelineLogDetails {
  return cause instanceof PravaCommandError
    ? { errorType: "PravaCommandError", exitCode: cause.exitCode, timedOut: cause.timedOut }
    : errorLogDetails(cause);
}

type PravaQuoteResult =
  | { readonly _tag: "ok"; readonly value: ReadonlyArray<CheckoutQuote> }
  | {
      readonly _tag: "err";
      readonly error: {
        readonly _tag: "DependencyUnavailable";
        readonly dependency: "prava";
        readonly cause: unknown;
      };
    };

/** Executes the official Prava CLI without invoking a shell. */
export type PravaCommandRunner = (
  args: ReadonlyArray<string>,
  timeoutMs: number,
) => Promise<CommandOutput>;

/** Server-only one-time credential used by Prava's accepted sandbox card path. */
export type PravaCheckoutCredentials = {
  readonly token: string;
  readonly cryptogram: string;
  readonly expiryMonth: string;
  readonly expiryYear: string;
};

/** Atomically exposes one Prava credential at most once and redacts string coercion. */
export class OneTimePravaCheckoutCredential {
  #value: PravaCheckoutCredentials | undefined;

  constructor(value: PravaCheckoutCredentials) {
    this.#value = value;
  }

  /** Consumes the credential once; later calls prove it is no longer available. */
  take(): PravaCheckoutCredentials | undefined {
    const value = this.#value;
    this.#value = undefined;
    return value;
  }

  /** Prevents accidental secret disclosure through interpolation or ordinary logging. */
  toString(): string {
    return "[REDACTED Prava checkout credential]";
  }
}

type CatalogConfig = {
  readonly offerId: Offer["id"];
  readonly merchantDomain: string;
  readonly productId: string;
  readonly variantId: string;
  readonly requiredDescriptionMarkers: ReadonlyArray<string>;
};

const CATALOG_CONFIGS: ReadonlyArray<CatalogConfig> = [
  {
    offerId: "headphone-zone",
    merchantDomain: "headphonezone.in",
    productId: "gid://shopify/Product/4807978942527",
    variantId: "gid://shopify/ProductVariant/33115065450559",
    requiredDescriptionMarkers: [
      "Sennheiser HD 560",
      "BOX CONTENTS",
      "2 Year Warranty",
      "warranty in India",
    ],
  },
  {
    offerId: "concept-kart",
    merchantDomain: "conceptkart.com",
    productId: "gid://shopify/Product/8076382404682",
    variantId: "gid://shopify/ProductVariant/43111211499594",
    requiredDescriptionMarkers: ["Sennheiser HD 560S", "Black", "detachable cable", "6.3mm adapter"],
  },
];

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function hasExactKeys(
  value: Record<string, unknown> | undefined,
  keys: ReadonlyArray<string>,
): value is Record<string, unknown> {
  if (value === undefined) return false;
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function stringAt(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function numberAt(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseJson(stdout: string): unknown {
  return JSON.parse(stdout);
}

function emptyProduct(): Product {
  return {
    manufacturer: "",
    model: "",
    variant: "",
    condition: "",
    bundleContents: "",
    warrantyRegion: "",
  };
}

function unavailableQuote(
  offer: Offer,
  reason: string,
  destinationReference: string,
  product: Product = emptyProduct(),
): CheckoutQuote {
  return {
    offerId: offer.id,
    merchant: offer.merchant,
    seller: offer.seller,
    destinationReference,
    product,
    itemTotalInr: 0,
    deliveryInr: 0,
    taxesInr: 0,
    appliedDiscounts: [],
    advertisedDiscounts: [],
    cashbackInr: 0,
    rewardPoints: 0,
    totalInr: 0,
    purchaseAvailable: false,
    unavailableReason: reason,
  };
}

function configFor(offer: Offer): CatalogConfig | undefined {
  return CATALOG_CONFIGS.find((config) => config.offerId === offer.id);
}

function parseVerifiedVariant(
  payload: unknown,
  config: CatalogConfig,
): { readonly variantId: string; readonly product: Product } | undefined {
  const product = record(record(payload)?.product);
  if (
    product === undefined ||
    product.id !== config.productId ||
    product.merchant !== config.merchantDomain
  ) {
    return undefined;
  }
  const description = stringAt(product.description);
  if (
    description === undefined ||
    !config.requiredDescriptionMarkers.every((marker) => description.includes(marker))
  ) {
    return undefined;
  }
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const variant = variants
    .map(record)
    .find((candidate) =>
      candidate?.id === config.variantId &&
      candidate.merchantDomain === config.merchantDomain &&
      candidate.available === true &&
      candidate.currency === "INR" &&
      numberAt(candidate.priceAmount) !== undefined,
    );
  return variant === undefined
    ? undefined
    : { variantId: config.variantId, product: SUPPORTED_PRODUCT };
}

function parseQuote(
  payload: unknown,
  offer: Offer,
  config: CatalogConfig,
  destinationReference: string,
  product: Product,
): CheckoutQuote | undefined {
  const quote = record(payload);
  const finalPrice = record(quote?.final_price);
  const breakdown = record(quote?.price_breakdown);
  if (
    quote === undefined ||
    finalPrice === undefined ||
    breakdown === undefined ||
    stringAt(quote.checkout_session_id) === undefined ||
    stringAt(quote.expires_at) === undefined ||
    !Number.isFinite(Date.parse(String(quote.expires_at))) ||
    quote.merchant !== config.merchantDomain ||
    finalPrice.currency !== "INR"
  ) {
    return undefined;
  }
  const totalInr = numberAt(finalPrice.amount);
  const subtotalCents = numberAt(breakdown.subtotal_cents);
  const shippingCents = numberAt(breakdown.shipping_cents);
  const taxCents = numberAt(breakdown.tax_cents);
  if (
    totalInr === undefined ||
    subtotalCents === undefined ||
    shippingCents === undefined ||
    taxCents === undefined ||
    !Number.isSafeInteger(subtotalCents) ||
    !Number.isSafeInteger(shippingCents) ||
    !Number.isSafeInteger(taxCents)
  ) {
    return undefined;
  }
  const itemTotalInr = subtotalCents / 100;
  const deliveryInr = shippingCents / 100;
  const taxesInr = taxCents / 100;
  const appliedDiscountInr = itemTotalInr + deliveryInr + taxesInr - totalInr;
  if (appliedDiscountInr < 0 || !Number.isSafeInteger(totalInr * 100)) {
    return undefined;
  }
  return {
    offerId: offer.id,
    merchant: offer.merchant,
    seller: offer.seller,
    destinationReference,
    product,
    itemTotalInr,
    deliveryInr,
    taxesInr,
    appliedDiscounts: appliedDiscountInr === 0
      ? []
      : [{ label: "Discount applied at Prava checkout", amountInr: appliedDiscountInr }],
    advertisedDiscounts: [],
    cashbackInr: 0,
    rewardPoints: 0,
    totalInr,
    purchaseAvailable: true,
  };
}

async function runJson(
  runner: PravaCommandRunner,
  args: ReadonlyArray<string>,
  timeoutMs: number,
): Promise<unknown> {
  const result = await runner(args, timeoutMs);
  if (result.exitCode !== 0) {
    throw new PravaCommandError(result.exitCode, result.timedOut === true);
  }
  return parseJson(result.stdout);
}

async function quoteOffer(
  offer: Offer,
  destinationReference: string,
  runner: PravaCommandRunner,
  logger?: PipelineLogger,
): Promise<CheckoutQuote> {
  logger?.log("prava.offer_quote", "started", { offerId: offer.id });
  const config = configFor(offer);
  if (config === undefined) {
    logger?.log("prava.offer_quote", "blocked", { offerId: offer.id, reason: "catalog_not_configured" });
    return unavailableQuote(offer, "Prava returned no orderable listing for this merchant and seller", destinationReference);
  }
  try {
    logger?.log("prava.product_lookup", "started", { offerId: offer.id });
    const productPayload = await runJson(
      runner,
      ["shop", "product", "--product-id", config.productId, "--merchant", config.merchantDomain, "--json"],
      30_000,
    );
    const verified = parseVerifiedVariant(productPayload, config);
    if (verified === undefined) {
      logger?.log("prava.product_lookup", "failed", {
        offerId: offer.id,
        reason: "product_identity_or_availability_unverified",
      });
      return unavailableQuote(offer, "Prava could not prove the exact Product identity and availability", destinationReference);
    }
    logger?.log("prava.product_lookup", "succeeded", { offerId: offer.id });
    const quoteArgs = [
      "shop", "quote", "--variant-id", verified.variantId,
      "--merchant", config.merchantDomain,
      "--quantity", "1", "--yes", "--json",
    ];
    if (destinationReference !== "destination-ref-prava-default") {
      quoteArgs.push("--address-id", destinationReference);
    }
    logger?.log("prava.checkout_quote", "started", { offerId: offer.id });
    const quotePayload = await runJson(runner, quoteArgs, 50_000);
    const quote = parseQuote(quotePayload, offer, config, destinationReference, verified.product);
    if (quote === undefined) {
      logger?.log("prava.checkout_quote", "failed", {
        offerId: offer.id,
        reason: "invalid_or_incomplete_quote",
      });
      return unavailableQuote(
        offer,
        "Prava returned an invalid or incomplete checkout quote",
        destinationReference,
        verified.product,
      );
    }
    logger?.log("prava.checkout_quote", "succeeded", {
      offerId: offer.id,
      totalInr: quote.totalInr,
    });
    logger?.log("prava.offer_quote", "succeeded", { offerId: offer.id });
    return quote;
  } catch (cause: unknown) {
    logger?.log("prava.offer_quote", "failed", {
      offerId: offer.id,
      ...pravaErrorLogDetails(cause),
    });
    const reason = cause instanceof SyntaxError
      ? "Prava returned an unreadable checkout response"
      : "Prava could not obtain a live checkout quote for this Offer";
    return unavailableQuote(offer, reason, destinationReference);
  }
}

/** Runs the locally installed official Prava CLI with a minimal inherited environment. */
export const runInstalledPrava: PravaCommandRunner = async (args, timeoutMs) => {
  const cliPath = resolve(process.cwd(), "node_modules/@prava-sdk/cli/dist/index.js");
  const allowedEnvironmentKeys = [
    "HOME",
    "NODE_EXTRA_CA_CERTS",
    "PRAVA_DASHBOARD_URL",
    "PRAVA_SERVER_URL",
    "PRAVA_STATE_DIR",
    "PRAVA_TIMEOUT_MS",
    "PRAVA_WALLET_API_URL",
  ] as const;
  const env: Record<string, string> = {};
  for (const key of allowedEnvironmentKeys) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  try {
    const output = await execFileAsync(process.execPath, [cliPath, ...args], {
      env,
      timeout: timeoutMs,
      maxBuffer: 2_000_000,
    });
    return { exitCode: 0, stdout: output.stdout, stderr: output.stderr };
  } catch (cause: unknown) {
    if (typeof cause !== "object" || cause === null) throw cause;
    const failure = cause as {
      readonly code?: unknown;
      readonly killed?: unknown;
      readonly stdout?: unknown;
      readonly stderr?: unknown;
    };
    return {
      exitCode: typeof failure.code === "number" ? failure.code : 1,
      stdout: typeof failure.stdout === "string" ? failure.stdout : "",
      stderr: typeof failure.stderr === "string" ? failure.stderr : "",
      timedOut: failure.killed === true || failure.code === "ETIMEDOUT",
    };
  }
};

type PravaWalletApiConfig = {
  readonly baseUrl: string;
  readonly agentId: string;
  readonly privateKey: string;
};

function walletApiConfigFrom(
  env: Readonly<Record<string, string | undefined>>,
): PravaWalletApiConfig | undefined {
  const agentId = env.PRAVA_AGENT_ID?.trim();
  const privateKey = env.PRAVA_AGENT_PRIVATE_KEY?.trim();
  if (agentId === undefined || agentId === "" || privateKey === undefined || privateKey === "") {
    return undefined;
  }
  const rawUrl = env.PRAVA_WALLET_API_URL?.trim() || "https://pay-api.prava.space";
  const url = new URL(rawUrl);
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".prava.space") ||
    url.pathname.replace(/\/$/, "") !== "" ||
    !/^[A-Za-z0-9_-]{6,200}$/.test(agentId)
  ) {
    throw new Error("Prava Wallet API configuration is invalid");
  }
  createPrivateKey({
    key: Buffer.from(privateKey, "base64"),
    format: "der",
    type: "pkcs8",
  });
  return { baseUrl: url.origin, agentId, privateKey };
}

function argumentAfter(args: ReadonlyArray<string>, name: string): string | undefined {
  const index = args.indexOf(name);
  const value = index < 0 ? undefined : args[index + 1];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function directWalletRequest(
  args: ReadonlyArray<string>,
): { readonly path: string; readonly body: Record<string, unknown>; readonly envelope: boolean } {
  if (args[0] !== "shop") throw new Error("Unsupported Prava command group");
  if (args[1] === "product") {
    const productId = argumentAfter(args, "--product-id");
    const merchant = argumentAfter(args, "--merchant");
    if (productId === undefined || merchant === undefined) throw new Error("Invalid Prava product command");
    return {
      path: "/v1/wallet/shop/product",
      body: { product_id: productId, merchantDomain: merchant },
      envelope: false,
    };
  }
  if (args[1] === "quote") {
    const variantId = argumentAfter(args, "--variant-id");
    const merchant = argumentAfter(args, "--merchant");
    const quantity = Number(argumentAfter(args, "--quantity") ?? "1");
    const addressId = argumentAfter(args, "--address-id");
    if (
      variantId === undefined || merchant === undefined ||
      !Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 10
    ) throw new Error("Invalid Prava quote command");
    return {
      path: "/v1/wallet/shop/quote",
      body: {
        variant_id: variantId,
        merchantDomain: merchant,
        quantity,
        ...(addressId === undefined ? {} : { address_id: addressId }),
      },
      envelope: false,
    };
  }
  if (args[1] === "checkout") {
    const checkoutSessionId = argumentAfter(args, "--checkout-session-id");
    const token = argumentAfter(args, "--token");
    const cryptogram = argumentAfter(args, "--cryptogram");
    const expiryMonth = argumentAfter(args, "--expiry-month");
    const expiryYear = argumentAfter(args, "--expiry-year");
    if (checkoutSessionId === undefined || token === undefined || cryptogram === undefined) {
      throw new Error("Invalid Prava checkout command");
    }
    return {
      path: "/v1/wallet/shop/checkout",
      body: {
        checkout_session_id: checkoutSessionId,
        credentials: {
          token,
          cryptogram,
          ...(expiryMonth === undefined ? {} : { expiry_month: expiryMonth }),
          ...(expiryYear === undefined ? {} : { expiry_year: expiryYear }),
        },
      },
      envelope: true,
    };
  }
  throw new Error("Unsupported Prava shopping command");
}

/** Executes the same signed Prava shopping contract without local CLI filesystem state. */
export function createPravaWalletApiRunner(
  env: Readonly<Record<string, string | undefined>>,
  fetcher: typeof fetch = fetch,
): PravaCommandRunner {
  const config = walletApiConfigFrom(env);
  if (config === undefined) throw new Error("Prava Wallet API agent configuration is incomplete");
  return async (args, timeoutMs) => {
    try {
      const request = directWalletRequest(args);
      const body = JSON.stringify(request.body);
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const key = createPrivateKey({
        key: Buffer.from(config.privateKey, "base64"),
        format: "der",
        type: "pkcs8",
      });
      const signature = sign(null, Buffer.from(timestamp + body), key).toString("base64");
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetcher(`${config.baseUrl}${request.path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Agent-Id": config.agentId,
            "X-Skill-Name": "prava-shopping",
            "X-Timestamp": timestamp,
            "X-Signature": signature,
          },
          body,
          signal: abortController.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      const payload: unknown = await response.json().catch(() => ({}));
      const envelope = record(payload);
      if (!response.ok || envelope?.success === false) {
        return { exitCode: 1, stdout: "", stderr: "Prava Wallet API request failed" };
      }
      const output = request.envelope ? payload : envelope?.data;
      if (output === undefined) {
        return { exitCode: 1, stdout: "", stderr: "Prava Wallet API response was incomplete" };
      }
      return { exitCode: 0, stdout: JSON.stringify(output), stderr: "" };
    } catch (cause: unknown) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: "Prava Wallet API request failed",
        timedOut: cause instanceof Error && cause.name === "AbortError",
      };
    }
  };
}

const runServerPrava: PravaCommandRunner = (args, timeoutMs) => {
  const directConfig = walletApiConfigFrom(process.env);
  return directConfig === undefined
    ? runInstalledPrava(args, timeoutMs)
    : createPravaWalletApiRunner(process.env)(args, timeoutMs);
};

/** Obtains independently verified live quotes for every curated Offer. */
export async function quoteOffersWithPrava(
  offers: ReadonlyArray<Offer>,
  destinationReference: string,
  runner: PravaCommandRunner = runServerPrava,
  logger?: PipelineLogger,
): Promise<PravaQuoteResult> {
  logger?.log("prava.quote_batch", "started", { offerCount: offers.length });
  try {
    const quotes = await Promise.all(
      offers.map((offer) => quoteOffer(offer, destinationReference, runner, logger)),
    );
    logger?.log("prava.quote_batch", "succeeded", {
      quoteCount: quotes.length,
      purchaseAvailableCount: quotes.filter((quote) => quote.purchaseAvailable).length,
    });
    return { _tag: "ok", value: quotes };
  } catch (cause: unknown) {
    logger?.log("prava.quote_batch", "failed", errorLogDetails(cause));
    return {
      _tag: "err",
      error: { _tag: "DependencyUnavailable", dependency: "prava", cause },
    };
  }
}

/** Validates the narrow browser request before it reaches the Prava process boundary. */
export function parsePravaQuoteRequest(value: unknown): {
  readonly offers: ReadonlyArray<Offer>;
  readonly destinationReference: string;
} {
  const payload = record(value);
  const destinationReference = stringAt(payload?.destinationReference);
  const offers = payload?.offers;
  const validDestination = destinationReference !== undefined && (
    destinationReference === "destination-ref-prava-default" || /^addr_[a-zA-Z0-9_-]{1,200}$/.test(destinationReference)
  );
  if (!validDestination || !Array.isArray(offers) || offers.length !== SUPPORTED_OFFERS.length) {
    throw new Error("Invalid Prava quote request");
  }
  const exactOffers = SUPPORTED_OFFERS.every((expected, index) => {
    const candidate = record(offers[index]);
    return candidate !== undefined &&
      candidate.id === expected.id &&
      candidate.merchant === expected.merchant &&
      candidate.seller === expected.seller &&
      candidate.url === expected.url;
  });
  if (!exactOffers) throw new Error("Invalid Prava quote request");
  return { offers: SUPPORTED_OFFERS, destinationReference };
}

function isSupportedProduct(value: unknown): value is Product {
  const product = record(value);
  return hasExactKeys(product, [
    "manufacturer", "model", "variant", "condition", "bundleContents", "warrantyRegion",
  ]) &&
    product.manufacturer === SUPPORTED_PRODUCT.manufacturer &&
    product.model === SUPPORTED_PRODUCT.model &&
    product.variant === SUPPORTED_PRODUCT.variant &&
    product.condition === SUPPORTED_PRODUCT.condition &&
    product.bundleContents === SUPPORTED_PRODUCT.bundleContents &&
    product.warrantyRegion === SUPPORTED_PRODUCT.warrantyRegion;
}

function isSafeDestinationReference(value: string | undefined): value is string {
  return value !== undefined && (
    value === "destination-ref-prava-default" ||
    /^addr_[a-zA-Z0-9_-]{1,200}$/.test(value)
  );
}

/** Parses the secret-free, exact Purchase Authorization facts accepted by checkout. */
export function parsePravaCheckoutRequest(value: unknown): PravaCheckoutRequest {
  const payload = record(value);
  const authorizationId = stringAt(payload?.authorizationId);
  const expiresAt = stringAt(payload?.expiresAt);
  const destinationReference = stringAt(payload?.destinationReference);
  const maximumTotalInr = payload?.maximumTotalInr;
  const offerValue = record(payload?.offer);
  const offer = SUPPORTED_OFFERS.find((candidate) =>
    candidate.id === offerValue?.id &&
    candidate.merchant === offerValue.merchant &&
    candidate.seller === offerValue.seller &&
    candidate.url === offerValue.url,
  );
  if (
    !hasExactKeys(payload, [
      "authorizationId", "expiresAt", "product", "quantity", "offer", "destinationReference",
      "maximumTotalInr", "paymentMethod",
    ]) ||
    !hasExactKeys(offerValue, ["id", "merchant", "seller", "url"]) ||
    authorizationId === undefined ||
    authorizationId.length > 200 ||
    !/^[a-zA-Z0-9_-]+$/.test(authorizationId) ||
    expiresAt === undefined || !Number.isFinite(Date.parse(expiresAt)) ||
    !isSupportedProduct(payload?.product) ||
    payload?.quantity !== 1 ||
    offer === undefined ||
    !isSafeDestinationReference(destinationReference) ||
    typeof maximumTotalInr !== "number" ||
    !Number.isFinite(maximumTotalInr) ||
    maximumTotalInr < 0 ||
    payload?.paymentMethod !== "prava_one_time_prepaid"
  ) {
    throw new Error("Invalid Prava checkout request");
  }
  return {
    authorizationId,
    expiresAt,
    product: SUPPORTED_PRODUCT,
    quantity: 1,
    offer,
    destinationReference,
    maximumTotalInr,
    paymentMethod: "prava_one_time_prepaid",
  };
}

async function prepareAuthorizedCheckout(
  request: PravaCheckoutRequest,
  runner: PravaCommandRunner,
  logger?: PipelineLogger,
): Promise<{ readonly quote: CheckoutQuote; readonly checkoutSessionId: string } | undefined> {
  const config = configFor(request.offer);
  if (config === undefined) {
    logger?.log("prava.checkout_product", "failed", {
      offerId: request.offer.id,
      reason: "catalog_not_configured",
    });
    return undefined;
  }
  logger?.log("prava.checkout_product", "started", { offerId: request.offer.id });
  const productPayload = await runJson(
    runner,
    ["shop", "product", "--product-id", config.productId, "--merchant", config.merchantDomain, "--json"],
    30_000,
  );
  const verified = parseVerifiedVariant(productPayload, config);
  if (verified === undefined) {
    logger?.log("prava.checkout_product", "failed", {
      offerId: request.offer.id,
      reason: "product_identity_or_availability_unverified",
    });
    return undefined;
  }
  logger?.log("prava.checkout_product", "succeeded", { offerId: request.offer.id });
  const quoteArgs = [
    "shop", "quote", "--variant-id", verified.variantId,
    "--merchant", config.merchantDomain,
    "--quantity", String(request.quantity), "--yes", "--json",
  ];
  if (request.destinationReference !== "destination-ref-prava-default") {
    quoteArgs.push("--address-id", request.destinationReference);
  }
  logger?.log("prava.checkout_requote", "started", { offerId: request.offer.id });
  const quotePayload = await runJson(runner, quoteArgs, 50_000);
  const checkoutSessionId = stringAt(record(quotePayload)?.checkout_session_id);
  const quote = parseQuote(
    quotePayload,
    request.offer,
    config,
    request.destinationReference,
    verified.product,
  );
  if (checkoutSessionId === undefined || quote === undefined) {
    logger?.log("prava.checkout_requote", "failed", {
      offerId: request.offer.id,
      reason: "invalid_or_incomplete_quote",
    });
    return undefined;
  }
  logger?.log("prava.checkout_requote", "succeeded", {
    offerId: request.offer.id,
    totalInr: quote.totalInr,
  });
  return { quote, checkoutSessionId };
}

/** Re-quotes and submits one authorized Prava sandbox checkout without retrying the charge. */
export async function checkoutWithPrava(
  request: PravaCheckoutRequest,
  credential: OneTimePravaCheckoutCredential | undefined,
  runner: PravaCommandRunner = runServerPrava,
  now: () => number = Date.now,
  logger?: PipelineLogger,
): Promise<PravaCheckoutResult> {
  logger?.log("prava.checkout_preparation", "started", { offerId: request.offer.id });
  if (credential === undefined) {
    logger?.log("prava.checkout_preparation", "blocked", { reason: "credential_not_configured" });
    return {
      _tag: "not_submitted",
      reason: "purchase_unavailable",
      confirmedTotalInr: null,
      explanation: "Prava one-time sandbox checkout is not configured",
    };
  }
  let prepared;
  try {
    prepared = await prepareAuthorizedCheckout(request, runner, logger);
  } catch (cause: unknown) {
    logger?.log("prava.checkout_preparation", "failed", pravaErrorLogDetails(cause));
    return {
      _tag: "not_submitted",
      reason: "purchase_unavailable",
      confirmedTotalInr: null,
      explanation: "Prava could not prepare a fresh checkout quote",
    };
  }
  if (prepared === undefined) {
    logger?.log("prava.checkout_preparation", "blocked", { reason: "authorized_offer_unverified" });
    return {
      _tag: "not_submitted",
      reason: "purchase_unavailable",
      confirmedTotalInr: null,
      explanation: "Prava could not verify the authorized Product and Offer",
    };
  }
  const authorizationExpired = (): boolean => {
    const expiresAtMilliseconds = Date.parse(request.expiresAt);
    return !Number.isFinite(expiresAtMilliseconds) || now() >= expiresAtMilliseconds;
  };
  if (prepared.quote.totalInr > request.maximumTotalInr) {
    logger?.log("prava.checkout_guard", "blocked", {
      reason: "authorized_maximum_exceeded",
      freshTotalInr: prepared.quote.totalInr,
      maximumTotalInr: request.maximumTotalInr,
    });
    return {
      _tag: "not_submitted",
      reason: "blocked_by_price",
      confirmedTotalInr: prepared.quote.totalInr,
      explanation: "The fresh Prava total exceeds the authorized maximum",
    };
  }
  if (authorizationExpired()) {
    logger?.log("prava.checkout_guard", "blocked", { reason: "authorization_expired" });
    return {
      _tag: "not_submitted",
      reason: "purchase_unavailable",
      confirmedTotalInr: prepared.quote.totalInr,
      explanation: "The Purchase Authorization expired before Prava checkout submission",
    };
  }

  const credentials = credential.take();
  if (credentials === undefined) {
    logger?.log("prava.checkout_guard", "blocked", { reason: "credential_already_consumed" });
    return {
      _tag: "not_submitted",
      reason: "purchase_unavailable",
      confirmedTotalInr: prepared.quote.totalInr,
      explanation: "The one-time Prava checkout credential was already consumed",
    };
  }

  let output: CommandOutput;
  logger?.log("prava.checkout_submission", "started", { offerId: request.offer.id });
  try {
    output = await runner([
      "shop", "checkout",
      "--checkout-session-id", prepared.checkoutSessionId,
      "--token", credentials.token,
      "--cryptogram", credentials.cryptogram,
      "--expiry-month", credentials.expiryMonth,
      "--expiry-year", credentials.expiryYear,
      "--yes", "--json",
    ], 120_000);
  } catch (cause: unknown) {
    logger?.log("prava.checkout_submission", "failed", errorLogDetails(cause));
    return {
      _tag: "submitted",
      paymentStatus: "unknown",
      merchantOrderIdentifier: null,
      confirmedTotalInr: prepared.quote.totalInr,
      failureReason: "Prava did not confirm whether the merchant accepted the order",
    };
  }
  if (output.timedOut === true) {
    logger?.log("prava.checkout_submission", "failed", { reason: "timeout_after_submission" });
    return {
      _tag: "submitted",
      paymentStatus: "unknown",
      merchantOrderIdentifier: null,
      confirmedTotalInr: prepared.quote.totalInr,
      failureReason: "Prava timed out after checkout submission; an order may exist",
    };
  }
  let payload: unknown;
  try {
    payload = parseJson(output.stdout);
  } catch (cause: unknown) {
    logger?.log("prava.checkout_result", "failed", {
      reason: "unreadable_response",
      ...errorLogDetails(cause),
    });
    return {
      _tag: "submitted",
      paymentStatus: "unknown",
      merchantOrderIdentifier: null,
      confirmedTotalInr: prepared.quote.totalInr,
      failureReason: "Prava returned an unreadable result after checkout submission",
    };
  }
  const envelope = record(payload);
  const data = record(envelope?.data);
  const status = stringAt(data?.status);
  const orderIdentifier = stringAt(data?.order_id) ?? null;
  if (envelope?.success === true && status === "paid") {
    if (orderIdentifier === null) {
      logger?.log("prava.checkout_result", "failed", {
        reason: "successful_payment_without_order_identifier",
      });
      return {
        _tag: "submitted",
        paymentStatus: "unknown",
        merchantOrderIdentifier: null,
        confirmedTotalInr: prepared.quote.totalInr,
        failureReason: "Prava reported successful payment without a merchant order identifier",
      };
    }
    logger?.log("prava.checkout_result", "succeeded", {
      paymentStatus: "successful",
      hasMerchantOrderIdentifier: true,
      confirmedTotalInr: prepared.quote.totalInr,
    });
    return {
      _tag: "submitted",
      paymentStatus: "successful",
      merchantOrderIdentifier: orderIdentifier,
      confirmedTotalInr: prepared.quote.totalInr,
    };
  }
  if (status !== undefined && ["cancelled", "declined", "expired", "failed"].includes(status)) {
    logger?.log("prava.checkout_result", "failed", {
      paymentStatus: "failed",
      providerStatus: status,
      confirmedTotalInr: prepared.quote.totalInr,
    });
    return {
      _tag: "submitted",
      paymentStatus: "failed",
      merchantOrderIdentifier: null,
      confirmedTotalInr: prepared.quote.totalInr,
      failureReason: `Prava confirmed checkout ${status}`,
    };
  }
  logger?.log("prava.checkout_result", "failed", {
    reason: "provider_outcome_unconfirmed",
    providerStatus: status ?? "missing",
  });
  return {
    _tag: "submitted",
    paymentStatus: "unknown",
    merchantOrderIdentifier: null,
    confirmedTotalInr: prepared.quote.totalInr,
    failureReason: "Prava did not confirm whether the merchant accepted the order",
  };
}
