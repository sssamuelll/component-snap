# Component Snap v2 — Design Doc: CSS Provenance and Matched-Style Graph

- **Status:** Draft
- **Date:** 2026-03-09
- **Related Issues:** #8, #6, #7, #9, #16
- **Depends on:** `docs/adr/0001-replay-first-architecture.md`, `docs/spec-export-modes-meta-v2.md`, `docs/design-cdp-capture-backbone.md`, `docs/design-target-to-cdp-node-mapping.md`

## Goal

Capture CSS truth for the selected target in a way that preserves **provenance**, not only final computed values.

This means Component Snap should know:
- which CSS rules matched the target
- which selectors contributed styling
- which stylesheets the rules came from
- which variables/keyframes/fonts are relevant
- which properties are computed-only fallback versus provenance-backed

The result should be a **matched-style graph** that can feed:
- replay fidelity
- portable extraction
- diagnostics
- confidence scoring

---

## Why this matters

The current system leans heavily on `getComputedStyle()` and subtree sanitization.
That is useful as fallback, but insufficient as primary truth because it loses:

- rule origin
- selector relationships
- stylesheet boundaries
- variable inheritance source
- keyframe origin
- pseudo-state provenance
- Shadow DOM stylesheet context

If we want strong fidelity, CSS must stop being treated as a flat bag of computed values.

---

## Core principle

Computed style is **evidence of outcome**.
Matched CSS rules are **evidence of cause**.

Component Snap needs both, but provenance-backed rule capture should be the primary layer.
Computed styles remain a secondary verification/fallback layer.

---

## Scope of #8

This issue should implement the first real CSS provenance capture for the mapped target node.

### In scope
- capture matched CSS rules for the mapped target node
- capture inline style on the target
- capture stylesheet/rule provenance metadata
- capture relevant computed styles as secondary layer
- capture basic custom properties (`--vars`) relevant to the target
- capture keyframe names referenced by matched rules/computed styles
- normalize into an internal matched-style graph structure

### Out of scope for now
- full ancestor-chain CSS provenance graph
- full pseudo-state graph
- full adoptedStyleSheets serialization
- complete cross-shadow stylesheet resolution perfection
- full font subsetting/bundling
- replay viewer integration

This issue is about establishing the CSS provenance backbone, not solving the entire CSS universe.

---

## Data sources to use

## Primary
### CDP CSS domain
Use Chrome DevTools Protocol CSS APIs as the main provenance source.

Likely relevant methods:
- `CSS.enable`
- `CSS.getMatchedStylesForNode`
- `CSS.getComputedStyleForNode`
- `CSS.getInlineStylesForNode`

Potentially useful later:
- `CSS.getStyleSheetText`
- `CSS.collectClassNames`
- `CSS.trackComputedStyleUpdates`
- `CSS.takeComputedStyleUpdates`

## Secondary
### Runtime / DOMSnapshot context
Use:
- mapped `nodeId` / `backendNodeId`
- target fingerprint
- DOMSnapshot string table / structure when useful
- current sanitize/computed-style code only as fallback or gap-filling logic

---

## OSS / external references to reuse

We are explicitly **not reinventing the wheel** here. #8 should reuse proven ideas, APIs, and structures wherever possible.

## 1. chrome-remote-interface
https://github.com/cyrus-and/chrome-remote-interface

Use for:
- CDP CSS domain access patterns
- request/response shaping
- client/session lifecycle patterns around `CSS.*`, `DOM.*`, and `Runtime.*`
- examples of command invocation and normalization boundaries

What we should borrow:
- connection and command patterns
- disciplined separation between raw protocol responses and normalized internal types

What we should not do:
- leak raw CDP response shapes everywhere in our app

## 2. Chrome DevTools Protocol CSS domain itself
This is the real primary dependency behind #8.

Use directly for:
- `CSS.enable`
- `CSS.getMatchedStylesForNode`
- `CSS.getComputedStyleForNode`
- `CSS.getInlineStylesForNode`
- later: `CSS.getStyleSheetText`

What we should borrow conceptually:
- DevTools already solved “which rules matched this node?”
- we should consume that truth, not rebuild a selector engine from scratch

## 3. rrweb / rrweb-snapshot
https://github.com/rrweb-io/rrweb
https://github.com/rrweb-io/rrweb-snapshot

Use for:
- mental model of style capture as replay state
- understanding that replay fidelity needs structured style state, not only flattened inline output
- thinking about how style data should compose with snapshot/replay data later

What we should borrow:
- architecture mindset
- separation between raw capture state and replay/render usage

What we should not do:
- force rrweb abstractions onto CDP CSS data if they do not fit cleanly

## 4. SingleFile / page archival family
https://github.com/gildas-lormeau/Scrapbook-for-SingleFile

Use for:
- packaging mindset around stylesheet/resource preservation
- understanding what information becomes important when moving from page truth to portable output

What we should borrow:
- asset/resource awareness
- thinking in terms of preservation, not just extraction

What we should not do:
- treat archival HTML flattening as a substitute for provenance capture

## 5. Existing Component Snap computed-style fallback
Reuse as:
- validation
- fallback
- comparison layer
- gap-filling when CDP provenance is partial

Not as the main source of truth.

---

## OSS reuse matrix

| Need | Primary source to reuse | How we reuse it | What we avoid rebuilding |
|---|---|---|---|
| Matched CSS rules | CDP CSS domain | Direct protocol capture + normalization | Custom selector/rule engine |
| CSS access patterns | chrome-remote-interface | Client/session/call structure ideas | Ad hoc protocol plumbing |
| Replay-oriented style model | rrweb / rrweb-snapshot | Architecture and state-shape thinking | Flat one-off style blobs |
| Preservation mindset | SingleFile family | Packaging/resource awareness | Naive HTML-only export assumptions |
| Fallback computed layer | Existing Component Snap code | Comparison + degraded mode | Replacing provenance with computed-only capture |

---

## Proposed internal model

## `MatchedStyleGraphV0`

```ts
interface MatchedStyleGraphV0 {
  target: {
    nodeId?: number
    backendNodeId?: number
    selector?: string
  }
  inline?: StyleDeclarationBlockV0
  matchedRules: MatchedRuleV0[]
  computed?: Array<{ name: string; value: string }>
  customProperties?: Array<{ name: string; value: string; source?: string }>
  keyframes?: string[]
  diagnostics?: {
    stylesheetCount?: number
    ruleCount?: number
    warnings?: string[]
  }
}
```

## `MatchedRuleV0`

```ts
interface MatchedRuleV0 {
  origin?: 'regular' | 'user-agent' | 'injected' | 'inspector' | 'inline'
  selectorList: string[]
  stylesheet?: {
    styleSheetId?: string
    sourceURL?: string
    isInline?: boolean
    startLine?: number
    startColumn?: number
  }
  media?: string[]
  supports?: string[]
  layer?: string
  declarations: Array<{
    name: string
    value: string
    important?: boolean
    disabled?: boolean
    implicit?: boolean
  }>
}
```

## `StyleDeclarationBlockV0`

```ts
interface StyleDeclarationBlockV0 {
  declarations: Array<{
    name: string
    value: string
    important?: boolean
  }>
}
```

---

## What “provenance” means in practice

For #8, provenance means we can answer:
- which selector matched?
- where did this rule come from?
- was it inline, regular stylesheet, or user-agent?
- what declarations were present?
- what variables/keyframes appear to matter?

That is enough for a strong first pass.

---

## Implementation plan for #8

We should execute #8 in explicit passes so we do not overreach and so every step builds on OSS truth instead of custom heuristics.

## Pass 1 — CSS backbone capture
Goal:
- get real provenance data flowing from CDP into `CaptureBundleV0`

Tasks:
- add CSS types
- add CSS capture helpers using CDP CSS domain
- capture matched rules, inline style, and computed styles for resolved node
- normalize into `MatchedStyleGraphV0`
- attach `cssGraph` to `CaptureBundleV0`
- fail soft when node mapping is missing or CSS domain capture fails

OSS reuse in this pass:
- CDP CSS domain as primary truth
- chrome-remote-interface patterns for call structure

## Pass 2 — provenance enrichment
Goal:
- make the style graph meaningfully useful for replay and diagnostics

Tasks:
- extract selector lists cleanly
- normalize stylesheet metadata
- tag rule origin (`regular`, `user-agent`, etc.)
- derive custom properties from matched rules and computed styles
- derive keyframe names from matched rules/computed styles
- add diagnostics warnings and counts

OSS reuse in this pass:
- DevTools provenance model
- existing computed-style fallback only as comparison layer

## Pass 3 — robustness and validation
Goal:
- make #8 solid enough to build replay/extraction on top of it

Tasks:
- add tests for normalization and diagnostics
- compare provenance-backed capture vs computed-style fallback on representative cases
- ensure unresolved-node and empty-style paths degrade gracefully
- capture explicit warnings for partial truth

OSS reuse in this pass:
- rrweb mindset for structured replay state
- SingleFile-style preservation thinking for later portability alignment

## Deferred follow-ups (not in #8 core)
- full inherited rule graph across ancestors
- pseudo-state provenance matrix
- adoptedStyleSheets deep capture
- full `@keyframes` block/source extraction
- font-face extraction/bundling

---

## What we will explicitly not reinvent

To keep #8 disciplined, we will not build these ourselves unless CDP fundamentally cannot provide them:

- a CSS selector matching engine
- a CSS cascade engine
- a stylesheet parser for matched-rule discovery
- a custom “which rules apply?” algorithm
- a replacement for DevTools CSS provenance APIs

If DevTools/CDP already knows the answer, we consume and normalize it.

---

## Proposed modules

## 1. `src/cdp/cssTypes.ts`
Purpose:
- internal TypeScript types for CSS provenance graph

## 2. `src/cdp/cssCapture.ts`
Purpose:
- low-level CDP CSS capture helpers

Responsibilities:
- enable CSS domain
- get matched styles for node
- get computed style for node
- get inline styles for node

## 3. `src/cdp/cssNormalize.ts`
Purpose:
- normalize raw CDP CSS responses into `MatchedStyleGraphV0`

Responsibilities:
- flatten selector lists
- normalize declarations
- extract stylesheet metadata
- gather keyframes/custom properties heuristically

## 4. `src/cdp/cssDiagnostics.ts`
Purpose:
- derive warnings and counts
- note missing provenance pieces

## 5. Hook from `src/cdp/orchestrator.ts`
Purpose:
- once node mapping resolves `nodeId`, invoke CSS capture and attach result to `CaptureBundleV0`

---

## Capture flow

## Step 1 — ensure target node mapping exists
#8 depends on #7 output.
If node mapping is unresolved, CSS capture should fail soft and record a warning.

## Step 2 — enable CSS domain
Call `CSS.enable` once per capture session.

## Step 3 — fetch matched styles
Use `CSS.getMatchedStylesForNode` with the resolved `nodeId`.

Expected useful outputs include:
- matchedCSSRules
- inherited styles (optional for later)
- pseudo element matches (capture lightly if already available)

## Step 4 — fetch computed style
Use `CSS.getComputedStyleForNode`.

This is secondary truth used for:
- fallback
- diffing
- variable/keyframe detection

## Step 5 — fetch inline style
Use `CSS.getInlineStylesForNode`.

## Step 6 — normalize into style graph
Build `MatchedStyleGraphV0` with:
- matched rules
- inline declarations
- computed style subset or full list
- custom property candidates
- keyframe names
- diagnostics

---

## Custom properties strategy

We do not need perfect inheritance tracing yet.

### First pass approach
- collect custom property declarations from matched rules and inline style
- scan computed style results for `--*` names when available
- record them in `customProperties`
- avoid pretending we fully know the inheritance path

### Why
This provides useful truth without over-claiming.

---

## Keyframe strategy

### First pass approach
- inspect matched declarations and computed style for:
  - `animation`
  - `animation-name`
- collect referenced keyframe names into `keyframes`
- optionally attach source stylesheet metadata when clearly available

### Non-goal
Do not fully reconstruct every `@keyframes` block yet unless it is low-friction.
That can come later.

---

## User-agent styles

These matter because they can explain weird rendering deltas.

### First pass rule
- if CDP marks a rule as user-agent origin, keep it
- provenance graph should preserve that origin
- do not silently merge it into author styles

This is useful for diagnosing browser-default interference.

---

## Shadow DOM and stylesheet caveats

For #8 we should be honest about limits.

### We should attempt
- capture matched rules for the resolved node even if inside shadow context
- preserve whatever stylesheet metadata CDP provides

### We should not claim yet
- complete adoptedStyleSheets provenance
- perfect closed-shadow CSS introspection

If something is unavailable, the style graph diagnostics should say so.

---

## Diagnostics / warnings

`MatchedStyleGraphV0.diagnostics.warnings` should include issues like:
- `node-unresolved`
- `css-domain-unavailable`
- `matched-rules-empty`
- `computed-style-empty`
- `inline-style-empty`
- `stylesheet-source-missing`
- `custom-properties-partial`
- `keyframes-derived-heuristically`

These are not necessarily failures, but they matter for confidence scoring later.

---

## Changes needed in existing types

`CaptureBundleV0` should gain something like:

```ts
cssGraph?: MatchedStyleGraphV0
```

This allows replay/extraction/scoring to consume CSS provenance directly.

---

## Testing strategy

## Unit tests
Add tests for normalization logic:
- selector extraction
- rule declaration normalization
- custom property extraction
- keyframe name extraction
- diagnostics generation

## Integration sanity
If practical, add a light test around orchestration behavior when:
- node mapping is present
- node mapping is absent

---

## Success criteria for #8

This issue is complete when:
- CSS capture runs from a resolved mapped node
- matched rules are captured through CDP
- computed style is captured as secondary layer
- inline style is captured
- output is normalized into a usable `MatchedStyleGraphV0`
- the result is attached to `CaptureBundleV0`
- failures degrade gracefully with warnings
- build/tests pass

---

## Non-goals for #8

Do **not** try to solve all of these here:
- perfect inherited style graph
- full pseudo-state provenance matrix
- full `@font-face` extraction/bundling
- full keyframe block reconstruction
- complete adoptedStyleSheets handling
- replay rendering parity

#8 is the provenance backbone, not the final CSS engine.

---

## Final principle

For Component Snap v2, CSS should no longer answer only:
- “what did the browser render?”

It should also answer:
- “which rule made that happen?”
- “where did that rule come from?”

That is the difference between clone-first approximation and replay-first truth.
