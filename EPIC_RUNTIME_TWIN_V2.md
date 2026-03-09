# Component Snap v2 — Runtime Twin Architecture Epic

## Mission

Build Component Snap into a system that can achieve, as closely as possible, the following target on modern web apps:

- 1:1 visual accuracy
- faithful interactive behavior
- Shadow DOM + JS-heavy parity
- strong portable digital twin exports

This is **not** a normal DOM export problem. It is a **capture + replay + extraction + scoring** problem.

The current DOM-clone/computed-style pipeline remains useful, but only as a fallback/export layer — not as the core architecture.

---

## Product Thesis

Component Snap v2 will support three execution modes over time:

1. **Freeze Mode**
   - Pixel-faithful visual snapshot
   - Screenshot-backed
   - Minimal/no real interaction
   - Used as source of truth and fallback

2. **Replay Mode**
   - Closest runtime-faithful reproduction
   - Page-level or capsule-level replay
   - Preserves JS-driven behavior where possible

3. **Portable Twin Mode**
   - Strong extracted twin with packaged assets, behavior maps, and measurable confidence
   - Best effort when true runtime portability is impossible

The long-term goal is Portable Twin Mode, but the path goes through Replay Mode first.

---

## Key Strategic Decision

### Old model
Select subtree → clone DOM → inline computed styles → export portable HTML

### New model
Select target → capture page/runtime context → replay faithfully → extract/score portable twin

This inversion matters.

A subtree alone usually does **not** contain enough information to reconstruct:
- JS behavior
- Shadow DOM styling context
- CSS rule provenance
- global defs/symbols
- runtime state
- network/resource dependencies
- storage/auth/runtime environment

---

## Architectural Pillars

## Pillar 1 — Browser State Capture
Capture the page/runtime context around the selected component.

### Required data classes
- DOM structure
- Shadow root structure
- CSS rule provenance and matched styles
- fonts and asset dependency graph
- viewport, scroll, zoom, DPR
- storage state (local/session where allowed)
- script/runtime environment metadata
- screenshot and clip source of truth
- optional event/action traces

### Core primitives to use
- Chrome DevTools Protocol (CDP)
  - `DOMSnapshot.captureSnapshot`
  - `DOM.getDocument` / `DOM.describeNode`
  - `CSS.getMatchedStylesForNode`
  - `CSS.getComputedStyleForNode`
  - `Runtime.evaluate`
  - `Page.captureScreenshot`
  - `Accessibility.getFullAXTree` (optional semantic layer)
- Chrome extension APIs where appropriate

### Relevant references
- `cyrus-and/chrome-remote-interface`
- Chrome DevTools Protocol docs

---

## Pillar 2 — Replay Capsule
Rebuild the component inside a runtime-aware capsule rather than a naive portable DOM.

### Concept
A “capsule” is a captured execution environment sufficient to re-render and replay the target component with high fidelity.

### Capsule contents
- page snapshot or relevant subtree with preserved boundaries
- assets and fonts
- style graph
- mutation timeline
- event/action trace
- environment metadata
- confidence and unsupported feature report

### Relevant references
- `rrweb-io/rrweb`
- `rrweb-io/rrweb-snapshot`
- `puppeteer/replay`
- SingleFile-style packaging approaches

### Why this matters
Replay must come before extraction if we want JS-heavy and Shadow DOM-heavy parity.

---

## Pillar 3 — Extraction Engine
Only after a high-fidelity replay exists should we attempt a portable twin export.

### Export tiers
- **freeze/** screenshot-first visual artifact
- **replay/** runtime-backed capsule
- **portable/** best-effort extracted component twin

### Portable twin contents
- structured HTML snapshot
- CSS bundle
- asset bundle
- behavior map
- metadata schema
- confidence score
- unsupported features report
- source screenshot

### Current engine reuse
The existing `sanitizeSubtree` / computed-style logic is reused as:
- fallback extraction
- debug export
- lower-confidence portable mode

It should no longer define the system architecture.

---

## Pillar 4 — Behavioral Fidelity Layer
We cannot reliably serialize framework closures directly. Instead we need to capture behavior envelopes.

### Capture targets
- hover/focus/active transitions
- click → mutation sequences
- input → UI state changes
- open/close patterns
- drag/drop flows
- list expansion/filtering
- keyboard interactions

### Implementation direction
- record user interaction traces
- correlate actions with DOM mutations and visual changes
- infer state transitions
- package behavior maps with replay or portable outputs

### Relevant references
- `puppeteer/replay`
- `rrweb`

---

## Pillar 5 — Fidelity Scoring
If we are serious about “1:1”, we need measurement.

### Required scores
- visual fidelity score
- structural fidelity score
- motion fidelity score
- interaction fidelity score
- asset completeness score
- portability score
- overall confidence

### Benchmark suite
Start with three canonical targets:
1. Google search bar
2. Reddit header
3. Lichess board

Each benchmark should compare:
- original screenshot/video
- replay screenshot/video
- portable screenshot/video
- behavioral pass/fail

### Tooling direction
- Playwright-based benchmark runner
- screenshot diffing
- action replay
- metrics emitted into `meta.json`

---

## Pillar 6 — Capability Detection
Before exporting, the system should estimate whether strong parity is realistic.

### Detect and flag
- nested Shadow DOM
- canvas/WebGL
- cross-origin iframes
- media-heavy surfaces
- CSP blockers
- lazy chunking / hydration dependency
- adoptedStyleSheets usage
- external symbol/defs usage
- auth/state dependency

### Output
A preflight report with:
- confidence score
- detected risks
- recommended export mode

This prevents fake promises and guides users toward Freeze / Replay / Portable.

---

## GitHub / OSS inputs to incorporate

## 1. rrweb
Repo: `https://github.com/rrweb-io/rrweb`

Use for:
- snapshot + mutation model
- replay architecture mental model
- DOM event timeline concepts

## 2. rrweb-snapshot
Repo: `https://github.com/rrweb-io/rrweb-snapshot`

Use for:
- DOM serialization/rebuild techniques
- separation between snapshot and replay concerns

## 3. chrome-remote-interface
Repo: `https://github.com/cyrus-and/chrome-remote-interface`

Use for:
- CDP access patterns
- page/runtime/style snapshot plumbing

## 4. puppeteer/replay
Repo: `https://github.com/puppeteer/replay`

Use for:
- interaction recording/replay model
- action timeline schema inspiration

## 5. SingleFile / page archival approaches
Reference family: `https://github.com/gildas-lormeau/Scrapbook-for-SingleFile`

Use for:
- resource packaging
- asset bundling
- page self-containment strategies

---

## v2 Epic

## Epic: Runtime Twin Architecture

### Outcome
A new architecture that can capture, replay, score, and extract complex web components with dramatically higher fidelity than the current DOM-clone pipeline.

### Non-goal
Do not prematurely promise universal full portability from subtree extraction alone.

---

## Implementation Tasks

### Phase 0 — Foundation and decisions
- [ ] Write architecture decision record: “Replay-first over clone-first”
- [ ] Define export modes: Freeze / Replay / Portable
- [ ] Define benchmark targets: Google, Reddit, Lichess
- [ ] Define `meta.json` v2 schema
- [ ] Define fidelity score model
- [ ] Define unsupported-feature taxonomy

### Phase 1 — CDP capture backbone
- [ ] Add a CDP capture module alongside extension capture
- [ ] Implement node targeting bridge from selected element to CDP node id
- [ ] Capture DOMSnapshot for target page
- [ ] Capture matched CSS rules and computed styles for target subtree
- [ ] Capture page-level screenshot and exact clip rect
- [ ] Capture viewport / DPR / scroll state
- [ ] Capture shadow root metadata and adopted stylesheet usage
- [ ] Capture resource graph (fonts, images, SVG defs, external CSS)

### Phase 2 — Replay capsule
- [ ] Design replay capsule format
- [ ] Prototype rrweb-backed capture + replay path
- [ ] Store initial snapshot + incremental mutation timeline
- [ ] Package assets into replay bundle
- [ ] Build replay viewer to mount and inspect the captured component context
- [ ] Support component-focused cropping/spotlighting inside replay viewer
- [ ] Verify replay on Google/Reddit/Lichess

### Phase 3 — Behavior capture
- [ ] Record user interactions as action traces
- [ ] Observe resulting DOM mutations and screenshot deltas
- [ ] Map actions to state transitions
- [ ] Add keyboard / hover / click / drag scenarios
- [ ] Prototype behavior map export for replay mode
- [ ] Define which interactions are “native replay” vs “emulated replay”

### Phase 4 — Portable twin extraction
- [ ] Refactor current extraction pipeline into `portable-fallback` module
- [ ] Build replay-aware extraction from capsule, not raw page only
- [ ] Preserve shadow boundaries where possible
- [ ] Add flattening only as fallback mode
- [ ] Bundle assets/fonts/symbols/defs into portable package
- [ ] Add behavior-map-powered interaction shim layer
- [ ] Emit confidence + unsupported features in export

### Phase 5 — Fidelity scoring + CI benchmarks
- [ ] Build Playwright benchmark harness
- [ ] Recreate benchmark interactions on source and replayed outputs
- [ ] Add screenshot diff scoring
- [ ] Add motion diff heuristics
- [ ] Add interaction success/failure scoring
- [ ] Emit benchmark reports per export mode
- [ ] Add CI benchmark job for regression tracking

### Phase 6 — Product hardening
- [ ] Surface preflight confidence in popup UI
- [ ] Recommend best export mode before capture
- [ ] Add debug inspector for missing assets/styles/runtime blockers
- [ ] Add downloadable capture report
- [ ] Document known unsupported classes explicitly

---

## Suggested GitHub issue breakdown

1. Architecture: replay-first runtime twin v2
2. Define export modes and `meta.json` v2
3. Implement CDP capture backbone
4. Map extension-selected node to CDP node identity
5. Capture shadow root and adopted stylesheet metadata
6. Build resource graph + asset bundler
7. Prototype rrweb-backed replay capsule
8. Build replay viewer with target spotlighting
9. Add action trace recorder
10. Add mutation timeline recorder
11. Define behavior map schema
12. Refactor current sanitize/export pipeline into fallback portable extractor
13. Add portable extraction from replay capsule
14. Add fidelity scoring pipeline
15. Add benchmark harness for Google / Reddit / Lichess
16. Add preflight capability detector and confidence score

---

## Sequencing recommendation

### Start here
1. CDP backbone
2. replay capsule prototype
3. fidelity scoring

### Then
4. behavior capture
5. portable extraction from replay
6. confidence model and product UX

This keeps us honest: replay quality first, portability second.

---

## Final principle

If the system cannot preserve truth, it must preserve evidence.

That means every export should carry:
- source screenshot
- fidelity score
- capability report
- unsupported features
- suggested next-best mode

That is how Component Snap becomes serious instead of magical.
