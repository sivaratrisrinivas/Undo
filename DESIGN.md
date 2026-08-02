---
name: Undo
description: A precise purchase-reversibility assessment console.
colors:
  ink: "#171815"
  page: "#e9e9e5"
  surface: "#f7f7f3"
  surface-quiet: "#deded9"
  line: "#c7c8c1"
  line-strong: "#999d96"
  muted: "#5c625c"
  dark: "#171916"
  dark-raised: "#242722"
  dark-line: "#3d413a"
  dark-muted: "#b3b9ae"
  signal: "#c3f759"
  signal-ink: "#172000"
  warning: "#fff2c7"
  warning-ink: "#5b4300"
  danger: "#a5282f"
  danger-surface: "#fff0f0"
  focus: "#005fcc"
  white: "#fff"
typography:
  display:
    fontFamily: '"Manrope Variable", "DejaVu Sans Condensed", "Arial Narrow", "Avenir Next Condensed", sans-serif'
    fontSize: "clamp(3.4rem, 5.3vw, 5.6rem)"
    fontWeight: 520
    lineHeight: 0.96
    letterSpacing: "-0.038em"
  body:
    fontFamily: 'Ubuntu, Inter, "Avenir Next", "Segoe UI", sans-serif'
    fontSize: "1.05rem"
    lineHeight: 1.65
  label:
    fontFamily: 'Ubuntu, Inter, "Avenir Next", "Segoe UI", sans-serif'
    fontSize: "0.76rem"
    fontWeight: 680
rounded:
  base: "8px"
  control: "10px"
  button: "11px"
  card: "12px"
components:
  button-primary:
    backgroundColor: "{colors.dark}"
    textColor: "{colors.white}"
    rounded: "{rounded.button}"
    padding: "0.8rem 1.05rem"
    height: "3rem"
  button-primary-hover:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.signal-ink}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.button}"
    padding: "0.78rem 1rem"
    height: "3rem"
  input-field:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.75rem 0.9rem"
    height: "3.15rem"
  recommendation-readout:
    backgroundColor: "{colors.dark}"
    textColor: "{colors.white}"
    rounded: "{rounded.base}"
    padding: "clamp(1.35rem, 3vw, 2.5rem)"
  evidence-card:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "1.15rem"
---

# Design System: Undo

## Overview

**Creative North Star: "Quiet Mastering Console"**

Undo makes purchase reversibility feel measured rather than promotional: a restrained aluminium work surface, calibration-like rules and dividers, and a dark readout where the recommended offer resolves as a verified signal. The experience compresses a complex evidence chain into three buyer actions while keeping every check inspectable in place.

The system is precise, calm, and candid. Luminous signal color is deliberately scarce; it marks readiness, eligibility, and the one consequential confirmation path instead of decorating the interface. The visual language rejects comparison-table wizardry, dashboard noise, sales urgency, and simulated certainty.

**Key Characteristics:**

- Warm-grey, aluminium-like planes separated by fine calibration lines.
- One smoked-dark readout for the decision that matters most.
- Restrained lime signal state and warm warning state, never a rainbow of status colors.
- Licensed, bundled Manrope Variable display type paired with a highly legible local-first text stack.
- Dense proof remains available through quiet disclosure, lists, and stable controls.

## Colors

The palette is an instrument panel: neutral material layers carry the interface, charcoal concentrates attention, and signal color reports verified state.

### Primary

- **Luminous Signal:** the readiness, eligibility, and high-confidence action color. It appears in the active progress marker, verified tags, readout signal, and authorization action; it is not a general surface fill.
- **Signal Ink:** the dark text placed on luminous signal surfaces.

### Secondary

- **Smoked Readout:** the concentrated decision surface for the recommended offer, authorization panel, and version panel.
- **Raised Readout:** the restrained inner layer used for explanation and code-like retained-version values inside the dark surface.
- **Dark Divider:** the low-contrast rule that calibrates sections within the smoked readout.
- **Dark Annotation:** the subdued metadata tone on the smoked readout.

### Tertiary

- **Evidence Warning:** the warm acknowledgement and blocked-state surface, reserved for material conditions and uncertainty that require attention.
- **Warning Ink:** the brown-black text that keeps the warning surface readable without turning it into an alarm.
- **Evidence Danger:** the red used only for errors and blocked conditions.
- **Danger Wash:** the light error surface behind danger copy.

### Neutral

- **Instrument Ink:** the near-black default text and icon color.
- **Aluminium Page:** the warm-grey page ground.
- **Clean Surface:** the pale work plane for panels, disclosures, and content sections.
- **Quiet Surface:** the subdued fill behind segmented controls and product glyphs.
- **Calibration Line:** the default thin divider and border.
- **Strong Calibration Line:** the more assertive perimeter and hover boundary.
- **Muted Annotation:** the soft grey-green used for explanations, timestamps, and supporting information.
- **Focus Blue:** the non-negotiable visible keyboard focus outline.
- **White:** the high-contrast field and evidence-card surface.

**The Signal-Is-Meaning Rule.** Use luminous signal only to communicate an affirmed, actionable state; never use it as a decorative accent or a second brand color.

**The Calibration Rule.** Prefer a one-pixel rule or a quiet tonal shift to a decorative border treatment. Dividers explain structure without competing with evidence.

## Typography

**Display Font:** Manrope Variable, DejaVu Sans Condensed, Arial Narrow, Avenir Next Condensed, sans-serif

**Body Font:** Ubuntu, Inter, Avenir Next, Segoe UI, sans-serif

**Character:** Manrope Variable gives the display system an engineered, editorial readout quality; the humanist text stack keeps Policy Evidence and dense controls practical to scan. The OFL-1.1 display face is bundled through `@fontsource-variable/manrope@5.3.0`; the local-first display and text stacks remain resilient fallbacks.

### Hierarchy

- **Display** (520, responsive display token, 0.96): the first action's proposition and major stage titles; tightly tracked and balanced to read like a physical console label.
- **Headline** (500–680, responsive through 2.4–4.8rem, 0.95): the recommended merchant and key assessment headings.
- **Title** (560–680, 1.45–2.25rem): panel and stage titles.
- **Body** (regular, 1.05rem, 1.65): explanatory copy, kept to roughly 55–62 characters where the implementation establishes a measure.
- **Label** (650–720, 0.62–0.86rem, slight tracking where uppercase): compact metadata, status labels, and form controls.

**The Readout Hierarchy Rule.** Let one decision value carry the largest type inside a smoked readout; all surrounding evidence is compact, quiet, and subordinate.

## Layout

The desktop workspace is constrained to the narrower of 1440px and 94vw, with a generous responsive top/bottom field. The first action pairs a left narrative and assurance mechanism with a larger right setup panel; at 1120px this becomes a single vertical flow. The assessment then alternates decisive, full-width bands with a two-column recommendation readout and assurance console.

Three buyer actions remain visible as a horizontal progress rail. Content is dense but segmented by rules, not cards within cards: offer rows, evidence disclosures, and summary rows make the proof chain scannable without departing the current surface. At 760px, fields and decision panels stack, evidence moves to one column, and the action rail suppresses secondary detail. At 420px, labels compact further while the 320px minimum viewport remains intact.

**The Three-Actions Rule.** The visual hierarchy may expose seven checks, but it must always preserve Configure, Understand, and Authorize as the buyer's only meaningful progression.

## Elevation & Depth

Depth is structural and restrained. Pale surfaces lift with a diffuse, low-contrast shadow only when they establish a major working plane; the dark readout uses tonal layering and internal rules instead of stronger shadows. The recommendation signal resolves with a brief blur-and-clip animation, while reduced-motion preferences collapse all animation and transitions.

### Shadow Vocabulary

- **Working Plane:** `0 18px 55px rgba(28, 31, 27, .08)` for setup and assessment surfaces that need separation from the aluminium page.
- **Quiet Record:** `0 14px 40px rgba(28, 31, 27, .06)` for standalone review and record surfaces.
- **Segmented Selection:** `0 2px 7px rgba(21, 23, 20, .1)` for the chosen segment only.

**The Flat-Readout Rule.** Inside the dark decision surface, use tonal layers and hairline dividers for hierarchy; do not pile shadows onto evidence or totals.

## Shapes

The basic form is gently softened and machined rather than bubbly: the foundational radius is used for major surfaces, controls are slightly rounder, and evidence cards receive the softest corners. Status dots and seals are circular; pills are reserved for compact state labels. Borders stay thin and neutral, with no decorative outlines or heavy strokes.

**The Machined-Corner Rule.** Use the established radius family to distinguish a working surface, a field, and a compact card; do not introduce oversized rounded capsules outside state tags.

## Components

### Buttons

**Character:** Quiet, full-width when an action is consequential; signal appears only at the moment of verified commitment.

- **Shape:** softly machined button corners via the button radius.
- **Primary:** smoked readout background with white text; its hover becomes the luminous signal treatment with signal ink. Assessment and authorization variants stretch to the container width and give the label a directional arrow.
- **Secondary:** transparent with a strong calibration outline; on dark authorization panels it inverts to pale text and a dark divider outline.
- **Focus / Active:** keyboard focus uses the focus-blue outline; active primary and secondary buttons move down by one pixel.

### Inputs / Fields

**Character:** Calm white measurement fields set into the aluminium panel.

- **Shape:** control-radius fields with a calibration-line border and compact explanatory text below.
- **Focus:** the focus border and the visible focus-blue outline remain distinct from an ordinary hover.
- **Source Selector:** three compact segments live on a quiet-surface track; only the selected segment becomes white and gains the small selection shadow.

### Navigation

**Character:** A three-position action rail, not a generic application nav.

- **Style:** each action owns a ruled column with a numbered circular marker, compact action label, and optional detail.
- **State:** the current marker is luminous signal; complete steps use a muted green confirmation; upcoming steps remain subdued.
- **Responsive:** supporting caption and secondary labels are removed before the primary action labels are compressed.

### Recommendation Readout

**Character:** The smoked-dark console channel where a recommendation becomes legible.

- **Surface:** dark field with restrained dark-raised reasoning panel, dark dividers, and luminous eligibility signal.
- **Hierarchy:** merchant, confirmed total, and four calibration-like specifications appear in one bounded decision area.
- **Motion:** the signal resolves once with a short blur-to-clear transition and respects reduced-motion preferences.

### Evidence Cards / Disclosure

**Character:** Verbatim proof treated as an inspectable record, not promotional content.

- **Surface:** white card in a ruled disclosure, with muted annotation, quoted wording on a quiet surface, and source links in blue.
- **Shape:** card-radius corners; the disclosure returns to the foundational radius.
- **Behavior:** evidence stays collapsed until requested, then opens into a responsive three-, two-, or one-column grid.

### Offer Channel

**Character:** A calibrated row rather than a comparison card.

- **Structure:** merchant, total, remedy, evidence, eligibility, explanation, and citation align against a single rule system.
- **State:** an eligible selection receives a quiet green wash; blocked offers retain their row but are disabled and visibly labelled.
- **Responsive:** column details stack beneath merchant identity rather than disappearing from the decision record.

### Material Warning Acknowledgement

**Character:** One warm, explicit consent check within the authorization console.

- **Surface:** warning treatment with one clear checkbox, a compact list of every material warning, and no false-success styling.
- **Behavior:** the aggregated acknowledgement must be checked before the single-use authorization control becomes available; it does not conceal the individual warnings it covers.

## Do's and Don'ts

### Do:

- **Do** concentrate the chosen offer and exact total in the smoked recommendation readout.
- **Do** keep the bundled Manrope Variable face first in the display token and preserve the local-first display and text stacks as resilient fallbacks.
- **Do** preserve the focus-blue outline and the reduced-motion override on every new interactive pattern.
- **Do** use calibration lines, compact labels, exact citations, and quiet disclosure to make proof inspectable.
- **Do** reserve luminous signal for eligibility, readiness, and the authorized path forward.

### Don't:

- **Don't** turn Undo into a comparison-table wizard, a sales dashboard, or an urgency-driven checkout surface.
- **Don't** use green signal color for generic decoration, secondary links, or unverified claims.
- **Don't** hide warnings, evidence state, or blocked options merely to make the console look simpler.
- **Don't** load the display face from a remote font service or remove its local-first fallbacks.
- **Don't** replace the three-action rail with seven buyer-facing steps.
