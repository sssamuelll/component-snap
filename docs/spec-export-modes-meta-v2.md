# Component Snap v2 Spec — Export Modes, `meta.json` v2, and Capability Taxonomy

- **Status:** Draft
- **Date:** 2026-03-09
- **Related Issues:** #3, #5, #17, #18, #19
- **Related ADR:** `docs/adr/0001-replay-first-architecture.md`

## Purpose

Define the user-facing and system-facing contract for Component Snap v2:

1. export modes
2. `meta.json` v2 schema
3. capability / risk taxonomy
4. confidence and recommendation model

This spec exists so the capture, replay, extraction, scoring, and UI work all target the same product contract.

---

## 1. Export Modes

Component Snap v2 supports three export modes.

## 1.1 Freeze Mode

### Goal
Preserve **visual truth** as reliably as possible.

### Primary use case
- exact visual reference
- documentation
- design inspection
- AI-assisted reconstruction from evidence
- fallback when replay/portable confidence is low

### Characteristics
- screenshot-backed
- minimal or no real interaction
- can include frozen DOM/CSS snapshot for inspection
- optimized for fidelity of appearance, not live behavior

### Guarantees
- source screenshot is always included
- visual evidence is preserved even when behavior cannot be exported
- confidence should usually be highest here

### Typical output
- `screenshot.png`
- `snapshot.html`
- `meta.json`
- optional structural DOM/CSS artifact for inspection

### Non-goals
- full runtime parity
- stateful interaction fidelity
- portability of actual app logic

---

## 1.2 Replay Mode

### Goal
Preserve **runtime-faithful behavior and context** as closely as possible.

### Primary use case
- reproduce the selected component inside its captured runtime context
- inspect behavior, transitions, and mutation-driven UI
- benchmark parity against the source page

### Characteristics
- page/runtime capture backed
- replay capsule driven
- retains surrounding context when needed
- can include action traces and mutation timelines

### Guarantees
- source screenshot is included
- replay capsule includes enough context to attempt high-fidelity rendering and behavior
- mode is preferred when the target is JS-heavy or Shadow DOM-heavy

### Typical output
- replay capsule bundle
- viewer entrypoint
- source screenshot(s)
- action traces
- mutation timeline
- `meta.json`

### Non-goals
- perfect standalone portability across arbitrary environments

---

## 1.3 Portable Mode

### Goal
Produce the strongest possible **portable digital twin**.

### Primary use case
- move captured component into another context
- inspect and reuse extracted component structure/assets/behavior maps
- AI-assisted reconstruction or transformation
- shareable self-contained capture

### Characteristics
- derived from replay/capture truth when possible
- packages assets, metadata, structure, and behavior hints/maps
- may preserve some live interactivity
- emits explicit unsupported-feature and confidence reports

### Guarantees
- source screenshot is included
- portable export includes confidence and unsupported features
- when strong parity is not possible, the export must still preserve evidence and limitations

### Typical output
- `component.html`
- `component.css`
- `component.js`
- assets bundle
- optional behavior map
- `meta.json`
- source screenshot(s)

### Non-goals
- pretending strong portability succeeded when confidence is low

---

## 1.4 Mode Recommendation Rules

The system should recommend a mode before capture/export when possible.

### Prefer Freeze when
- visual reference matters most
- target includes severe runtime blockers
- canvas/WebGL/iframe constraints make replay/portable weak
- confidence for replay/portable is low

### Prefer Replay when
- target is JS-heavy
- target depends on app/runtime context
- Shadow DOM complexity is high
- interaction fidelity matters more than standalone export

### Prefer Portable when
- target complexity is moderate/manageable
- assets are capturable
- strong runtime blockers are absent or mitigated
- extraction confidence is acceptable

---

## 2. `meta.json` v2

`meta.json` v2 is the canonical machine-readable summary for every export mode.

It must be emitted for all exports, even when fidelity is poor.

---

## 2.1 Top-level shape

```json
{
  "schemaVersion": "2.0",
  "captureId": "uuid-or-stable-id",
  "capturedAt": "ISO-8601",
  "mode": "freeze | replay | portable",
  "source": {},
  "target": {},
  "environment": {},
  "resources": {},
  "runtime": {},
  "behavior": {},
  "fidelity": {},
  "capabilities": {},
  "recommendation": {},
  "artifacts": {}
}
```

---

## 2.2 `source`

Describes the original source page.

```json
{
  "url": "https://example.com",
  "title": "Page Title",
  "origin": "https://example.com",
  "userAgent": "...",
  "pageLanguage": "en",
  "colorScheme": "light | dark | unknown"
}
```

Required fields:
- `url`
- `title`
- `origin`

---

## 2.3 `target`

Describes the selected component/element.

```json
{
  "selectedSelector": "...",
  "stableSelector": "...",
  "tagName": "div",
  "componentKind": "search-input | button | card | unknown",
  "boundingBox": {
    "x": 0,
    "y": 0,
    "width": 100,
    "height": 40,
    "dpr": 2
  },
  "fingerprint": {
    "textHash": "...",
    "structureHash": "...",
    "attributesHash": "..."
  },
  "shadowContext": {
    "insideShadowRoot": true,
    "shadowDepth": 2,
    "hostChain": ["custom-app", "search-shell"]
  }
}
```

Required fields:
- `stableSelector`
- `boundingBox`

---

## 2.4 `environment`

Describes rendering environment details relevant to fidelity.

```json
{
  "viewport": { "width": 1440, "height": 900 },
  "scroll": { "x": 0, "y": 320 },
  "devicePixelRatio": 2,
  "timezone": "Europe/Berlin",
  "locale": "en-US",
  "reducedMotion": false,
  "prefersColorScheme": "light"
}
```

---

## 2.5 `resources`

Summarizes external and internal dependencies.

```json
{
  "summary": {
    "fonts": 2,
    "images": 4,
    "stylesheets": 3,
    "svgSymbols": 7,
    "scripts": 12,
    "missing": 1,
    "blocked": 2
  },
  "critical": [
    { "type": "font", "url": "...", "status": "captured" },
    { "type": "image", "url": "...", "status": "blocked" }
  ]
}
```

Statuses:
- `captured`
- `referenced`
- `missing`
- `blocked`
- `inlined`
- `unknown`

---

## 2.6 `runtime`

Describes runtime complexity and runtime-backed capture info.

```json
{
  "frameworkHints": ["react", "web-components"],
  "shadowDom": {
    "present": true,
    "nestedDepth": 2,
    "adoptedStyleSheets": true
  },
  "dynamicSignals": {
    "mutationObserverActivity": true,
    "hydrationMarkers": true,
    "canvasPresent": false,
    "webglPresent": false,
    "crossOriginIframes": false
  },
  "captureBackends": ["extension", "cdp", "rrweb"]
}
```

---

## 2.7 `behavior`

Summarizes captured interactivity.

```json
{
  "tracesRecorded": true,
  "traceTypes": ["hover", "click", "input", "keyboard"],
  "mutationTimeline": true,
  "behaviorMap": {
    "available": true,
    "states": 4,
    "transitions": 6
  }
}
```

---

## 2.8 `fidelity`

Holds measured fidelity outputs.

```json
{
  "visual": 0.93,
  "interaction": 0.71,
  "motion": 0.64,
  "assetCompleteness": 0.88,
  "portability": 0.69,
  "overallConfidence": 0.76,
  "benchmark": {
    "suite": "google-search-bar",
    "version": "v1"
  }
}
```

All scores are normalized to `0.0 - 1.0`.

---

## 2.9 `capabilities`

Capability/risk report for this capture.

```json
{
  "featuresDetected": [
    "shadow-dom",
    "adopted-stylesheets",
    "js-heavy-runtime"
  ],
  "unsupported": [
    {
      "code": "cross-origin-iframe",
      "severity": "high",
      "impact": "portable",
      "message": "Cross-origin iframe content could not be captured for portable export."
    }
  ],
  "risks": [
    {
      "code": "runtime-state-dependency",
      "severity": "medium",
      "impact": "replay-portable"
    }
  ]
}
```

---

## 2.10 `recommendation`

Tells the UI and downstream consumers what mode is best.

```json
{
  "recommendedMode": "replay",
  "reasonCodes": [
    "js-heavy-runtime",
    "nested-shadow-dom",
    "portable-confidence-low"
  ],
  "summary": "Replay is recommended because the target depends on runtime state and nested shadow roots."
}
```

---

## 2.11 `artifacts`

Points to emitted files.

```json
{
  "screenshot": "./screenshot.png",
  "snapshotHtml": "./snapshot.html",
  "componentHtml": "./component.html",
  "componentCss": "./component.css",
  "componentJs": "./component.js",
  "replayCapsule": "./replay/capsule.json",
  "behaviorMap": "./behavior/map.json"
}
```

Paths may be omitted if not relevant to the chosen mode.

---

## 3. Capability / Risk Taxonomy

The system needs a shared vocabulary for what it detected and why fidelity may degrade.

## 3.1 Feature codes

Detected features are neutral facts about the target/page.

### Rendering / structure
- `shadow-dom`
- `nested-shadow-dom`
- `adopted-stylesheets`
- `svg-symbol-defs`
- `canvas`
- `webgl`
- `video`
- `iframe`
- `cross-origin-iframe`
- `slot-based-composition`

### Runtime
- `js-heavy-runtime`
- `hydration-dependent`
- `mutation-driven-ui`
- `virtualized-list`
- `drag-drop-interaction`
- `keyboard-driven-interaction`
- `router-dependent`
- `global-store-dependent`

### Resource / environment
- `external-fonts`
- `cors-protected-assets`
- `csp-restricted`
- `theme-dependent`
- `auth-state-dependent`
- `locale-dependent`
- `viewport-sensitive`

---

## 3.2 Unsupported / blocker codes

These indicate known hard limits or unresolved export blockers.

### Hard blockers
- `cross-origin-iframe`
- `unreadable-canvas-state`
- `webgl-scene-not-portable`
- `closed-shadow-root-unavailable`
- `asset-fetch-blocked`
- `critical-script-context-missing`

### Soft blockers
- `runtime-state-dependency`
- `mutation-replay-incomplete`
- `pseudo-state-approximation`
- `motion-capture-incomplete`
- `font-substitution-risk`
- `selector-identity-unstable`
- `portable-behavior-emulated`

---

## 3.3 Severity levels

- `low`
- `medium`
- `high`
- `critical`

### Meaning
- `low`: minor degradation possible
- `medium`: likely visible/behavioral mismatch in some cases
- `high`: major parity risk for one or more modes
- `critical`: strong parity impossible for at least one target mode

---

## 3.4 Impact targets

Each risk/blocker should specify impacted mode(s):

- `freeze`
- `replay`
- `portable`
- `replay-portable`
- `all`

---

## 4. Confidence Model

Confidence is not a vibe. It must be computed from evidence.

## 4.1 Inputs

### Positive inputs
- source screenshot captured successfully
- target identified stably
- DOMSnapshot captured
- CSS provenance captured
- assets captured completely
- replay succeeds on benchmark interaction trace
- shadow context captured
- no critical blockers

### Negative inputs
- nested shadow roots without sufficient observability
- blocked assets
- cross-origin iframes
- canvas/webgl dependencies
- runtime state dependency without replay support
- mutation replay mismatch
- large screenshot diff
- interaction failures

---

## 4.2 Score outputs

Minimum score set:
- `visual`
- `interaction`
- `motion`
- `assetCompleteness`
- `portability`
- `overallConfidence`

All normalized to `0.0 - 1.0`.

---

## 4.3 Recommendation thresholds

Initial heuristic thresholds:

- `overallConfidence >= 0.85` and `portability >= 0.8` → Portable recommended
- `overallConfidence >= 0.7` and runtime complexity high → Replay recommended
- otherwise → Freeze recommended

These thresholds are provisional and should be revised after benchmark data exists.

---

## 5. Acceptance Criteria

This issue/spec is complete when:

- export mode semantics are documented
- `meta.json` v2 fields are defined
- capability taxonomy is defined
- severity and impact rules are defined
- recommendation logic is defined at a first-pass level
- spec is stable enough for issues #6, #17, #18, and #19 to build against

---

## 6. Implementation Notes

### Do not do
- invent dozens of unstable fields before capture data exists
- overfit the schema to the current fallback exporter
- hide uncertainty behind vague language

### Do do
- prefer explicit fields over magical blobs
- allow omission of mode-specific artifacts
- preserve evidence even when parity fails
- keep the schema extensible but concrete

---

## Final principle

Every export must answer these questions clearly:

1. What did we capture?
2. How truthful is it?
3. What broke or was at risk?
4. Which mode should the user trust most?

If `meta.json` v2 cannot answer those questions, it is incomplete.
