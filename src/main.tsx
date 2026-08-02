import "@fontsource-variable/manrope/wght.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { createBrowserEvidenceRepository } from "./adapters/browser-evidence-repository";
import { createBrowserPurchaseAuthorizationRepository } from "./adapters/browser-purchase-authorization-repository";
import { createBrowserUndoRecordRepository } from "./adapters/browser-undo-record-repository";
import { createFakeAdapters } from "./adapters/fake-adapters";
import { createOpenAiPolicyExtractionAdapter } from "./adapters/openai-policy-extraction";
import { createPravaShoppingAdapter } from "./adapters/prava-shopping";
import { createSensoEvidenceAdapter } from "./adapters/senso-evidence";
import { App } from "./App";
import { officialEvidenceAppliesToSupportedProduct, type EvidenceSnapshot, type Product } from "./domain";
import { POLICY_CONTRACT_RELEASE } from "./evaluation/policy-contract";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Root element is missing");
}

const fakeAdapters = createFakeAdapters();
const baseAdapters = {
  ...fakeAdapters,
  authorization: createBrowserPurchaseAuthorizationRepository(localStorage, navigator.locks),
  records: createBrowserUndoRecordRepository(localStorage, navigator.locks),
  now: import.meta.env.VITE_EVIDENCE_MODE === "fake"
    ? fakeAdapters.now
    : () => new Date().toISOString(),
  nextAuthorizationId: () => crypto.randomUUID(),
  nextRecordId: () => crypto.randomUUID(),
};
const adapters =
  import.meta.env.VITE_EVIDENCE_MODE === "fake"
    ? baseAdapters
    : {
        ...baseAdapters,
        policyContract: { purchaseEnabled: () => POLICY_CONTRACT_RELEASE.purchaseEnabled },
        evidenceApplicability: {
          appliesToProduct: (_product: Product, snapshot: EvidenceSnapshot) =>
            officialEvidenceAppliesToSupportedProduct(snapshot),
        },
        senso: createSensoEvidenceAdapter(),
        openAi: createOpenAiPolicyExtractionAdapter(),
        prava: createPravaShoppingAdapter(),
        evidence: createBrowserEvidenceRepository(localStorage),
      };

createRoot(root).render(
  <StrictMode>
    <App adapters={adapters} />
  </StrictMode>,
);
