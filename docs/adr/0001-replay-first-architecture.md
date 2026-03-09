# ADR 0001 — Adopt replay-first architecture over clone-first export

- **Status:** Accepted
- **Date:** 2026-03-09
- **Related Issues:** #3, #4, #5, #6, #11, #16, #17, #18

## Context

Component Snap was initially built around a **clone-first** pipeline:

1. user selects an element on the page
2. the extension identifies a likely visual root
3. the subtree is cloned and sanitized
4. computed styles are copied into a portable stylesheet
5. assets are inlined where possible
6. a portable HTML/CSS/JS bundle is exported

This approach is useful for lightweight component capture, but it does not reliably satisfy the actual project target:

- 1:1 visual accuracy on modern web apps
- faithful interactive behavior
- Shadow DOM parity
- JS-heavy app parity
- strong portable digital twins

In practice, the current architecture hits structural limits:

### 1. Subtree capture does not contain full truth
A selected subtree usually does not contain:
- runtime state
- framework behavior
- global style provenance
- Shadow DOM context
- external defs/symbols/resources
- app-level environment assumptions
- storage/auth dependencies

### 2. Computed-style export loses intent
`getComputedStyle()` captures rendered values, not the rule provenance or interaction logic that produced them.

This makes it insufficient as the main source of truth for:
- pseudo-state relationships
- inherited or contextual styling
- animated state transitions
- theme/runtime changes
- framework-driven class/state changes

### 3. Shadow DOM flattening breaks parity
Flattening Shadow DOM into the light DOM can help extraction, but often breaks:
- style scoping
- CSS variable inheritance
- `adoptedStyleSheets`
- encapsulated behavior
- internal composition relationships

### 4. JavaScript-heavy UIs cannot be ported by DOM cloning alone
React/Vue/Svelte/Web Components and custom applications often depend on runtime state and event chains that do not survive plain subtree export.

### 5. Fidelity is currently asserted, not measured
Without a replay layer and benchmark/scoring system, “1:1” is mostly aspirational.

---

## Decision

Component Snap v2 will adopt a **replay-first architecture**.

Instead of treating portable subtree export as the primary system, we will treat it as a downstream derivation of richer runtime capture.

### New default architectural flow

1. user selects target component
2. system captures page/runtime context around the target
3. system builds a replay-capable capture bundle (“replay capsule”)
4. system measures fidelity against the original source
5. system derives export outputs from replay/capture truth
6. system emits confidence and unsupported-feature reports

### Architectural layers

#### A. Capture Layer
Responsible for gathering runtime and page truth.

Includes:
- DOM / DOMSnapshot capture
- CSS provenance and matched-style graph
- viewport / DPR / scroll state
- screenshot source of truth
- Shadow DOM topology
- assets/resource graph
- runtime metadata
- optional interaction traces

#### B. Replay Layer
Responsible for recreating the captured component with surrounding context intact.

Includes:
- replay capsule format
- snapshot + mutation timeline
- target spotlight / crop view
- benchmark playback path

#### C. Extraction Layer
Responsible for generating portable outputs **from replay-backed truth**.

Includes:
- freeze exports
- replay exports
- portable exports
- fallback subtree extraction when replay-derived extraction is insufficient

#### D. Scoring Layer
Responsible for making fidelity measurable.

Includes:
- visual score
- interaction score
- motion score
- asset completeness score
- confidence score
- benchmark reports

#### E. Capability / Risk Layer
Responsible for estimating export feasibility before capture or export.

Includes:
- unsupported feature detection
- mode recommendation
- risk reporting

---

## Consequences

## Positive

### 1. Closer alignment with the real product goal
Replay-first matches the stated ambition much better than subtree cloning.

### 2. Better handling of complex modern apps
Page/runtime capture gives us a path to handle:
- nested Shadow DOM
- JS-heavy interactions
- mutation-driven UI
- app-level context

### 3. Portability becomes evidence-based
Portable output will be generated from a richer source, improving quality and allowing confidence scoring.

### 4. Benchmarking becomes meaningful
A replay layer makes it possible to compare source vs replay vs portable outputs across hard examples.

## Negative / Costs

### 1. Higher technical complexity
This architecture is significantly more complex than plain export.

### 2. More moving parts
We now need capture, replay, extraction, scoring, and benchmark systems.

### 3. Longer path to polished portable mode
Strong portability becomes a later-stage result, not the first milestone.

### 4. More infrastructure dependencies
We will rely more heavily on browser/runtime tooling such as CDP and replay libraries.

---

## What we keep from v1

The current implementation is not discarded.

We keep and reuse:
- the extension picker UX
- visual root detection heuristics
- screenshot cropping
- asset inlining fallback logic
- portable HTML/CSS/JS export experience
- sanitize/subtree extraction logic as fallback
- current benchmark repro targets and debugging scripts

In v2, these become part of a **portable-fallback extractor**, not the defining system architecture.

---

## What changes in v2

### Before
Subtree clone/export was the primary path.

### After
Runtime/page capture and replay become the primary path.

### Before
Computed styles were treated as the main truth.

### After
Computed styles become one input among several:
- DOMSnapshot
- matched CSS rules
- screenshots
- resource graph
- mutation timelines
- interaction traces

### Before
Shadow DOM flattening was a central tactic.

### After
Shadow DOM is treated as first-class and preserved where possible; flattening becomes fallback behavior.

### Before
Portability was attempted directly from raw page selection.

### After
Portability is derived from replay-backed truth whenever possible.

---

## Non-goals

This ADR does **not** claim that every component from every modern web app will become perfectly portable.

It also does **not** require that:
- runtime replay and portable extraction are solved in one iteration
- all framework internals become serializable
- all Shadow DOM cases become fully exportable immediately

The goal is to adopt the architecture that gives the project a credible path toward the stated target.

---

## OSS and external references to leverage

We explicitly choose to **reuse existing open-source work** where it meaningfully reduces risk.

### rrweb
https://github.com/rrweb-io/rrweb

Use for:
- replay model
- snapshot + mutation timeline concepts
- replay viewer concepts

### rrweb-snapshot
https://github.com/rrweb-io/rrweb-snapshot

Use for:
- DOM snapshot / rebuild concepts
- separation of serialization concerns

### chrome-remote-interface
https://github.com/cyrus-and/chrome-remote-interface

Use for:
- CDP access patterns
- DOMSnapshot / CSS / Runtime / Page capture plumbing

### puppeteer/replay
https://github.com/puppeteer/replay

Use for:
- action trace and interaction replay concepts
- schema inspiration for behavior capture

### SingleFile family
https://github.com/gildas-lormeau/Scrapbook-for-SingleFile

Use for:
- resource packaging
- asset bundling
- self-contained archive strategies

---

## Implementation implications

This ADR directly drives the following work:

- #5 Define export modes, meta.json v2, and capability taxonomy
- #6 Implement CDP capture backbone for page/runtime state
- #7 Map extension-picked element to CDP node identity
- #8 Capture CSS provenance and matched-style graph
- #9 Capture Shadow DOM topology and adoptedStyleSheets metadata
- #10 Build resource graph and asset bundler
- #11 Prototype replay capsule format using rrweb concepts
- #12 Build replay viewer with target spotlight / crop
- #13 Record action traces for behavior capture
- #14 Record mutation timeline and infer state transitions
- #15 Refactor current sanitize/export pipeline into portable-fallback extractor
- #16 Implement portable extraction from replay capsule
- #17 Build fidelity scoring pipeline
- #18 Create benchmark harness for Google / Reddit / Lichess
- #19 Add preflight capability detector and export mode recommendation

---

## Final principle

If a component cannot yet be preserved as full truth, the system must preserve:
- evidence
- context
- replayability
- measurable confidence

Replay-first is the architecture that makes that possible.
