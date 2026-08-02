/** Supported ways to enter the walking skeleton. */
export type InputMode = "preset" | "url" | "product";

/** Renders Product selection and unsupported-input controls. */
export function ProductInputStage(props: {
  readonly error: string | undefined;
  readonly inputMode: InputMode;
  readonly productName: string;
  readonly url: string;
  readonly onInputModeChange: (mode: InputMode) => void;
  readonly onProductNameChange: (value: string) => void;
  readonly onStart: () => void;
  readonly onUrlChange: (value: string) => void;
}) {
  return (
    <div className="stage-card compact">
      <p className="step-kicker">Step 1 of 7</p>
      <h2>Choose a Product</h2>
      <p className="stage-copy">This MVP supports one precisely matched Product and three approved Offer URLs.</p>
      <fieldset className="choice-stack">
        <legend className="sr-only">Product input method</legend>
        <label className={props.inputMode === "preset" ? "choice selected" : "choice"}>
          <input aria-label="Sennheiser HD 560S" checked={props.inputMode === "preset"} name="input-mode" onChange={() => props.onInputModeChange("preset")} type="radio" />
          <span><strong>Sennheiser HD 560S</strong><small>New · Black variant · India warranty region</small></span>
          <span className="supported">Supported</span>
        </label>
        <label className={props.inputMode === "url" ? "choice selected" : "choice"}>
          <input aria-label="Paste an approved Offer URL" checked={props.inputMode === "url"} name="input-mode" onChange={() => props.onInputModeChange("url")} type="radio" />
          <span><strong>Paste an approved Offer URL</strong><small>Headphone Zone, Concept Kart, or Flipkart</small></span>
        </label>
        <label className={props.inputMode === "product" ? "choice selected" : "choice"}>
          <input aria-label="Enter another Product" checked={props.inputMode === "product"} name="input-mode" onChange={() => props.onInputModeChange("product")} type="radio" />
          <span><strong>Enter another Product</strong><small>Other Products stop before external work</small></span>
        </label>
      </fieldset>
      {props.inputMode === "url" && (
        <label className="field"><span>Offer URL</span><input value={props.url} onChange={(event) => props.onUrlChange(event.target.value)} placeholder="https://merchant.example/product" type="url" /></label>
      )}
      {props.inputMode === "product" && (
        <label className="field"><span>Product name</span><input value={props.productName} onChange={(event) => props.onProductNameChange(event.target.value)} placeholder="Manufacturer and model" type="text" /></label>
      )}
      {props.error !== undefined && <p role="alert" className="error-message">{props.error}</p>}
      <button className="primary-button" onClick={props.onStart} type="button">Start assessment <span aria-hidden="true">→</span></button>
    </div>
  );
}

/** Renders parsed buyer constraints before any adapter work begins. */
export function ConstraintsStage(props: {
  readonly destinationReference: string;
  readonly error: string | undefined;
  readonly loading: boolean;
  readonly premiumLimit: string;
  readonly onCompare: () => void;
  readonly onDestinationChange: (value: string) => void;
  readonly onPremiumLimitChange: (value: string) => void;
}) {
  return (
    <div className="stage-card compact">
      <p className="step-kicker">Step 2 of 7</p>
      <h2>Set your boundaries</h2>
      <p className="stage-copy">Quotes use a masked destination reference. No full address enters the assessment.</p>
      <div className="form-grid">
        <label className="field"><span>Delivery Destination</span><select value={props.destinationReference} onChange={(event) => props.onDestinationChange(event.target.value)}><option value="Bengaluru · destination-ref-01">Bengaluru · saved destination •01</option><option value="Hyderabad · destination-ref-02">Hyderabad · saved destination •02</option></select></label>
        <label className="field">
          <span>Premium Limit (₹)</span>
          <input aria-label="Premium Limit (₹)" min="0" onChange={(event) => props.onPremiumLimitChange(event.target.value)} step="1" type="number" value={props.premiumLimit} />
          <small>Maximum extra live total you permit for stronger reversibility.</small>
        </label>
      </div>
      {props.error !== undefined && <p role="alert" className="error-message">{props.error}</p>}
      <button className="primary-button" disabled={props.loading} onClick={props.onCompare} type="button">{props.loading ? "Building assessment…" : "Compare offers"} <span aria-hidden="true">→</span></button>
    </div>
  );
}
