/** Supported ways to enter an assessment. */
export type InputMode = "preset" | "url" | "product";

/** Collects Product and buying boundaries in the first meaningful action. */
export function ProductInputStage(props: {
  readonly destinationReference: string;
  readonly error: string | undefined;
  readonly inputMode: InputMode;
  readonly loading: boolean;
  readonly premiumLimit: string;
  readonly productName: string;
  readonly url: string;
  readonly onAssess: () => void;
  readonly onDestinationChange: (value: string) => void;
  readonly onInputModeChange: (mode: InputMode) => void;
  readonly onPremiumLimitChange: (value: string) => void;
  readonly onProductNameChange: (value: string) => void;
  readonly onUrlChange: (value: string) => void;
}) {
  return (
    <section className="setup-surface" aria-labelledby="page-title">
      <div className="setup-story">
        <h1 id="page-title" tabIndex={-1}>Know the way back before you buy.</h1>
        <p>
          Undo compares the evidenced exit rights, costs, and uncertainty of Equivalent Offers,
          then prepares one exact purchase decision.
        </p>
        <div className="mechanism-diagram" aria-label="Seven automatic checks feed one recommendation">
          <div className="mechanism-orbit" aria-hidden="true">
            <span className="orbit-core" />
            {Array.from({ length: 7 }, (_, index) => <span className={`orbit-point orbit-point-${index + 1}`} key={index} />)}
          </div>
          <div>
            <strong>7 checks. 3 actions.</strong>
            <span>Identity, evidence, policy, price, eligibility, authorization, and recordkeeping run as one signal.</span>
          </div>
        </div>
      </div>

      <form className="setup-panel" onSubmit={(event) => { event.preventDefault(); props.onAssess(); }}>
        <div className="panel-heading">
          <div>
            <h2>Set the purchase</h2>
            <p>Choose the Product and the maximum premium you permit for stronger reversibility.</p>
          </div>
        </div>

        <fieldset className="source-control">
          <legend>Product source</legend>
          <div className="segmented-control">
            <label className={props.inputMode === "preset" ? "selected" : ""}>
              <input checked={props.inputMode === "preset"} name="input-mode" onChange={() => props.onInputModeChange("preset")} type="radio" />
              Supported Product
            </label>
            <label className={props.inputMode === "url" ? "selected" : ""}>
              <input aria-label="Paste an approved Offer URL" checked={props.inputMode === "url"} name="input-mode" onChange={() => props.onInputModeChange("url")} type="radio" />
              Offer URL
            </label>
            <label className={props.inputMode === "product" ? "selected" : ""}>
              <input aria-label="Enter another Product" checked={props.inputMode === "product"} name="input-mode" onChange={() => props.onInputModeChange("product")} type="radio" />
              Other Product
            </label>
          </div>
        </fieldset>

        {props.inputMode === "preset" && (
          <div className="product-readout">
            <div className="product-glyph" aria-hidden="true">
              <svg viewBox="0 0 64 64"><path d="M14 35v-7a18 18 0 0 1 36 0v7" /><rect height="18" rx="6" width="11" x="8" y="31" /><rect height="18" rx="6" width="11" x="45" y="31" /><path d="M45 49c-2 5-6 7-13 7" /></svg>
            </div>
            <div><strong>Sennheiser HD 560S</strong><span>New · Black · Standard retail package · India warranty</span></div>
            <span className="signal-tag"><i aria-hidden="true" /> Exact match</span>
          </div>
        )}

        {props.inputMode === "url" && (
          <label className="field"><span>Offer URL</span><input aria-label="Offer URL" value={props.url} onChange={(event) => props.onUrlChange(event.target.value)} placeholder="https://merchant.example/product" type="url" /><small>Headphone Zone, Concept Kart, or Flipkart.</small></label>
        )}
        {props.inputMode === "product" && (
          <label className="field"><span>Product name</span><input aria-label="Product name" value={props.productName} onChange={(event) => props.onProductNameChange(event.target.value)} placeholder="Manufacturer and model" type="text" /><small>Unsupported Products stop before external work begins.</small></label>
        )}

        <div className="boundary-grid">
          <label className="field">
            <span>Delivery Destination</span>
            <select value={props.destinationReference} onChange={(event) => props.onDestinationChange(event.target.value)}>
              <option value="destination-ref-prava-default">Prava default saved destination</option>
            </select>
            <small>Undo retains only this opaque reference.</small>
          </label>
          <label className="field">
            <span>Premium Limit</span>
            <div className="currency-input"><span aria-hidden="true">₹</span><input aria-label="Premium Limit (₹)" min="0" onChange={(event) => props.onPremiumLimitChange(event.target.value)} step="1" type="number" value={props.premiumLimit} /></div>
            <small>Extra live total permitted for stronger reversibility.</small>
          </label>
        </div>

        {props.error !== undefined && <p role="alert" className="error-message">{props.error}</p>}

        <button className="primary-button assess-button" disabled={props.loading} type="submit">
          <span>{props.loading ? "Running seven checks…" : "Assess this purchase"}</span>
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h13M14 7l5 5-5 5" /></svg>
        </button>
        <p className="privacy-note">
          <svg aria-hidden="true" viewBox="0 0 24 24"><rect height="11" rx="2" width="14" x="5" y="10" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
          No payment secret or full address enters Undo.
        </p>
      </form>
    </section>
  );
}
