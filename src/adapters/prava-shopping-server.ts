import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  SUPPORTED_OFFERS,
  SUPPORTED_PRODUCT,
  type CheckoutQuote,
  type Offer,
  type Product,
} from "../domain.ts";

const execFileAsync = promisify(execFile);

type CommandOutput = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

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

function unavailableQuote(offer: Offer, reason: string, product: Product = emptyProduct()): CheckoutQuote {
  return {
    offerId: offer.id,
    merchant: offer.merchant,
    seller: offer.seller,
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
    throw new Error(`Prava CLI exited with status ${result.exitCode}`);
  }
  return parseJson(result.stdout);
}

async function quoteOffer(
  offer: Offer,
  destinationReference: string,
  runner: PravaCommandRunner,
): Promise<CheckoutQuote> {
  const config = configFor(offer);
  if (config === undefined) {
    return unavailableQuote(offer, "Prava returned no orderable listing for this merchant and seller");
  }
  try {
    const productPayload = await runJson(
      runner,
      ["shop", "product", "--product-id", config.productId, "--merchant", config.merchantDomain, "--json"],
      30_000,
    );
    const verified = parseVerifiedVariant(productPayload, config);
    if (verified === undefined) {
      return unavailableQuote(offer, "Prava could not prove the exact Product identity and availability");
    }
    const quoteArgs = [
      "shop", "quote", "--variant-id", verified.variantId,
      "--merchant", config.merchantDomain,
      "--quantity", "1", "--yes", "--json",
    ];
    if (destinationReference !== "destination-ref-prava-default") {
      quoteArgs.push("--address-id", destinationReference);
    }
    const quotePayload = await runJson(runner, quoteArgs, 50_000);
    return parseQuote(quotePayload, offer, config, verified.product)
      ?? unavailableQuote(offer, "Prava returned an invalid or incomplete checkout quote", verified.product);
  } catch (cause: unknown) {
    const reason = cause instanceof SyntaxError
      ? "Prava returned an unreadable checkout response"
      : "Prava could not obtain a live checkout quote for this Offer";
    return unavailableQuote(offer, reason);
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
    const failure = cause as { readonly code?: unknown; readonly stdout?: unknown; readonly stderr?: unknown };
    return {
      exitCode: typeof failure.code === "number" ? failure.code : 1,
      stdout: typeof failure.stdout === "string" ? failure.stdout : "",
      stderr: typeof failure.stderr === "string" ? failure.stderr : "",
    };
  }
};

/** Obtains independently verified live quotes for every curated Offer. */
export async function quoteOffersWithPrava(
  offers: ReadonlyArray<Offer>,
  destinationReference: string,
  runner: PravaCommandRunner = runInstalledPrava,
): Promise<PravaQuoteResult> {
  try {
    const quotes = await Promise.all(
      offers.map((offer) => quoteOffer(offer, destinationReference, runner)),
    );
    return { _tag: "ok", value: quotes };
  } catch (cause: unknown) {
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
