# ADR 0003 — Camino A: deepen state-clone via targeted library integration

- **Status:** Accepted
- **Date:** 2026-05-22
- **Related Issues:** #53, #54, #55, #56, #57, #58 (Tier 1–6 epics)
- **Related ADR:** `docs/adr/0001-replay-first-architecture.md`

## Context

After implementing the Tier 1 quick fixes (snapshot stylesheet link, capsule fragility gate, CDP subtree walker — see commits `0001-replay-first` through current `main`), captures of the Google search bar improved measurably:

- `matchedRules` per cssGraph: 3 → 99
- `keyframes` captured: 0 → 6
- `stylesheetCount`: 1 → 14
- `component.css` size: 175 → 1,719 lines

But qualitative inspection of the rendered output against the source screenshot shows the result is still ~60% faithful, not "1:1 visual + interactive parity". Failure modes observed:

1. Elements that should be hidden (file thumbnail with no file attached, send button with no query, hidden file inputs) render as visible artifacts.
2. SVG icons relying on `<use href="#sym-N">` references where `<symbol>` lives outside the captured subtree render empty (the `+` button is a black square).
3. The text input area has no visible bounds because its layout depends on a cascade-order resolution that gets reordered when rules are emitted as a flat matched-rule list.
4. The `Modo IA` chip has the wrong colors because its hover/focus/active states aren't captured and its default state is applied with the wrong specificity.
5. The send button (blue arrow) appears even though it shouldn't in the captured state (Google hides it until the user types).

The root cause across (1)/(4)/(5) is the same: **we serialize the DOM at one moment but the rendered visual depends on runtime state that lives outside the DOM** — JS-applied classes, ancestor cascade swings, conditional rendering, event-driven mutations. The existing capsule and fallback pipelines both miss this layer.

Two structural options were considered:

- **Camino A — deepen the deterministic clone.** Pursue the full tiered roadmap (#53–#58) until the clone reproduces hover/focus/active, class mutations, multi-state, variants. The output remains "Google gibberish" (obfuscated class names, opaque to humans) but renders pixel-faithfully and behaves identically within an interaction envelope.

- **Camino B — pivot to AI semantic reinterpretation.** Use the existing capture pipeline as input quality, feed into an LLM that generates clean React + Tailwind code. The output is editable and portable but loses determinism — the LLM interprets, doesn't clone.

A prior-art survey was run (May 2026) to check whether either Camino is already solved by an existing tool.

## Prior art landscape

Tools were grouped by technical approach, not marketing. Capability scoring is qualitative (0–10) based on docs review + targeted source-code inspection where the tool is open source.

### A. DOM clone + computed-style injection (Component Snap's current approach)

| Tool | Static visual | Pseudo-states | Mutations | Output | Open source |
|---|---|---|---|---|---|
| **Component Snap** (current) | 6 | 3 (partial) | 0 | HTML+CSS+JS + meta | MIT |
| **DOM Inspector Plus** | 7 | **7** (has `interaction-capture.ts`) | 0 | AI prompt / JSX / HTML / Tailwind / JSON | MIT |
| **DivMagic** | 7 | 0 | 0 | HTML / React / Vue + Tailwind | Paid |
| **Excompt** | 6 | 0 | 0 | HTML / React / Vue + Tailwind | Paid |
| **UICloner** | 5 (vision-based) | 0 | 0 | HTML + Tailwind | MIT (vision LLM) |

Closest direct competitor: DOM Inspector Plus. Already implements what Component Snap's Tier 2 targets (computed-style diff between pseudo-states). But bails on Tier 3+ because its goal is generating prompts for downstream AI tools (v0, Claude, Cursor), not deterministic state machines.

### B. Visual snapshot via SVG/Canvas (static only)

| Tool | Approach | Output |
|---|---|---|
| **html2canvas** | Canvas manual re-paint | Bitmap PNG. No shadow DOM, no CSS vars in gradients. |
| **html-to-image** | SVG `<foreignObject>` + `getComputedStyle` per element | PNG/SVG/Canvas. Shadow DOM with config. |
| **SnapDOM** (2025) | SVG `<foreignObject>` + computed styles + pseudo-elements promoted to real nodes + shadow DOM piercing + iframe support + font embedding | PNG/SVG/WebP/Canvas. **Steady-state only**. |
| **dom-to-image** | Older SVG `<foreignObject>` approach | PNG. |

Closest to Tier 1 (pixel-perfect static): SnapDOM. Same approach Component Snap would have to reinvent, already solved with caching, font embedding, pseudo-element promotion. Output is an image, not interactive HTML — but the technique transfers.

### C. Session replay (record-then-replay over time)

| Tool | Approach | Scope |
|---|---|---|
| **rrweb** | Initial snapshot + MutationObserver + IntersectionObserver + input events | Full session (timeline) |
| **rrweb-snapshot** | Just the serialization subset of rrweb | Single DOM tree |
| **OpenReplay / PostHog / LogRocket / FullStory / Datadog RUM** | rrweb-style | Full session SaaS |

Closest to Tier 3 (mutation probing): rrweb. The MutationObserver wrapper already handles microbursts, shadow DOM crossings, adopted stylesheets, dedup. Component Snap's `state machine` is structurally a subset of rrweb's `eventWithTime` stream — specifically the `IncrementalSnapshotEvent` type with `MutationSource.Mutation` payload, captured atomically before/after a synthetic trigger. rrweb's model is **passive over time**; Component Snap wants **active per trigger**. Same primitive, inverted control flow.

### D. Full-page archival

| Tool | Approach | Output |
|---|---|---|
| **SingleFile** | DOM freeze + asset inlining | Single HTML file (whole page) |
| **HTTrack / ArchiveBox / wget --mirror** | Site spider | Multiple files |
| **WARC / MHTML** | Standard archival formats | Binary archive |

Not aimed at component isolation. Useful for asset bundling techniques (font subsetting, image inlining, base64 conversion).

### E. AI design-to-code (semantic reinterpretation)

| Tool | Input | Output |
|---|---|---|
| **v0 (Vercel)** | Screenshot / Figma + chat | React + Tailwind/shadcn (LLM) |
| **Builder.io Visual Copilot** | Figma | React/Vue/Svelte/Angular (LLM + custom model + Mitosis compiler) |
| **Locofy** | Figma | React/Vue/HTML (custom + LLM) |
| **Anima** | Figma | Flat HTML (heuristic) |
| **Magic Patterns** | Screenshot + prompt | React (LLM) |
| **UICloner** | DOM element | HTML + Tailwind (vision LLM) |

These produce editable, portable code — but as semantic reinterpretation. Loses pixel-fidelity and determinism by design. This is Camino B's space. Mitosis (Builder.io's open-source compiler) is the only piece directly reusable inside a deterministic pipeline: it transforms a normalized component AST to multiple framework outputs.

### F. Browser-native and source-required

- Chrome DevTools "Copy as HTML" — lossy, no states, no assets
- Storybook / Bit.dev — require source code
- shadcn/ui registry — manually curated

Not applicable to the black-box target.

### Capability matrix (planned vs available)

| Capability | Component Snap (planned Tier 1–6) | DOM Inspector Plus | SnapDOM | rrweb | SingleFile | v0 | Builder.io Visual Copilot |
|---|---|---|---|---|---|---|---|
| Static visual fidelity | 9 (T1) | 7 | **10** | 8 | **10** (full page) | 6 (LLM) | 7 (LLM + custom) |
| Pseudo-state (`:hover`/`:focus`) | 9 (T2) | **7** | 0 | N/A | 0 | N/A | N/A |
| Class/attr mutations | 8 (T3) | 0 | 0 | **10** (recorded) | 0 | N/A | N/A |
| JS behavior reproduction | 6 (T4 envelope) | 0 | 0 | **10** (recorded) | 0 | 7 (regenerated) | 7 |
| Variant detection (theme/density) | 7 (T5) | 0 | 0 | 0 | 0 | 5 (prompt) | 6 |
| Multi-state composition | 8 (T6) | 0 | 0 | 5 (timeline) | 0 | N/A | N/A |
| Asset bundling | 8 | 5 | 8 | 9 | **10** | N/A | 7 |
| Shadow DOM | 7 | 5 | 9 | **10** | 9 | 5 | 7 |
| Code editable (clean output) | 2 | 6 (via downstream AI) | N/A | 1 | 2 | **10** | **10** |
| Component-isolated | **10** | **10** | **10** | 0 | 0 | **10** | 8 |
| Determinism (no AI dependency) | **10** | 6 | **10** | **10** | **10** | 0 | 3 |

The cuadrante "component-isolated + deterministic + multi-state + black-box" is unoccupied. Each existing tool consciously trades one of those axes for another (rrweb trades isolation for time-recording; DOM Inspector Plus trades determinism for AI-prompt UX; SnapDOM trades interactivity for visual precision; SingleFile trades isolation for completeness; v0 trades determinism for clean output).

## Decision

Adopt **Camino A**: pursue the full Tier 1–6 roadmap with the goal of state-clone determinism, accepting that the output remains inspectable-not-portable (Google's obfuscated classes survive in the export; the user reads the clone, doesn't paste it into their app).

**Library integrations** (concrete, by tier):

### Tier 1 — Pixel-perfect static (#53)
- Replace the custom `extractPortableFallbackSubtree` walker with `rrweb-snapshot`'s `snapshot()` for DOM serialization. Saves ~400 LOC of reinvented serialization, inherits correct shadow DOM and adopted stylesheet handling.
- Adopt `SnapDOM` as the **freeze visual layer** — generate `freeze.png` and `freeze.svg` alongside the interactive HTML. Replaces the heuristic visual score with a pixel-grounded artifact.
- Continue building the symbol harvest, invisible stripping, body context capture directly in Component Snap's pipeline (no library covers these well).

### Tier 2 — Pseudo-state capture (#54)
- Replace the in-page pseudo-state probing (`collectPseudoDeclarations`) with CDP's `CSS.forcePseudoState` + `getComputedStyleForNode` diff. More reliable than parsing stylesheets.
- Reference DOM Inspector Plus's `interaction-capture.ts` as a working example of computed-style diff between pseudo-classes. Not adopting their code (different goals) but their schema for `{hover, focus, active}` deltas is sound.

### Tier 3 — Class & attribute mutation probing (#55)
- Use `rrweb`'s `record({ checkoutEveryNms: 0, recordCanvas: false })` configured for atomic snapshots before/after each synthetic trigger.
- The state machine schema becomes a subset of rrweb's `eventWithTime` (`IncrementalSnapshotEvent` with `MutationSource.Mutation`). Reuses rrweb's microburst dedup, shadow DOM mutation handling.

### Tier 4 — Action mirror runtime (#56)
- Adopt `rrweb-player`'s replayer as a base, or extract just the `Replayer` class from `rrweb` and adapt for interactive mode (mutations applied on user event, not on timeline tick).
- Add Component Snap-specific safety guards (form intercept, fetch mock, navigation block) as a thin wrapper.

### Tier 5 — Variant detection (#57)
- Use CDP's `Emulation.setEmulatedMedia` for media-query-driven variants (`prefers-color-scheme`, `max-width`, `pointer:coarse`).
- Use the existing CSS `matchedRules` graph (already captured) to detect ancestor-class-driven swings without re-capture.

### Tier 6 — Multi-snapshot composition (#58)
- Reuse the rrweb `eventWithTime` schema for manual states (each manual snapshot is one `FullSnapshotEvent`), enabling a single replayer to handle both auto-probed (Tier 3) and manually captured (Tier 6) state transitions.

**Mitosis is explicitly out of Camino A.** It belongs to Camino B (clean-code emission). Optional future work, but not on the critical path.

## Consequences

### Positive
- **Saves ~600–800 LOC reinventing well-trodden ground** (DOM serialization, mutation observation, replay primitives). The current `extractPortableFallbackSubtree` (~600 LOC) shrinks substantially.
- **Inherits correctness from production libraries.** rrweb has handled millions of session-replay edge cases; SnapDOM has handled thousands of html-to-image tickets. Bugs we'd otherwise rediscover are already patched.
- **Shared mental model with the JS replay ecosystem.** Anyone who's worked with PostHog/OpenReplay/LogRocket recognizes the schema; reduces onboarding cost.
- **Schema convergence** between Tier 3 (auto-probed) and Tier 6 (manually captured) via rrweb event format.

### Negative
- **Coupling to library release cadence.** rrweb major versions can change schemas; need pinning + adapter layer.
- **Bundle size grows.** rrweb-snapshot is ~30KB minzipped; SnapDOM is ~25KB. Acceptable for an extension, but document the budget.
- **Some Component Snap concepts won't map cleanly** to rrweb's model (e.g., the "target subtree promotion" logic from ADR 0001's selection truth). Need a thin adapter to bridge.
- **Loss of full control over edge cases.** If a future version of Google's search bar uses a pattern rrweb doesn't handle, we're blocked until upstream patches (or fork).

### Mitigations
- Pin library versions explicitly in `package.json` with `~` not `^` to avoid surprise schema changes.
- Wrap each library behind a single adapter module (`src/adapters/rrweb.ts`, `src/adapters/snapdom.ts`). The rest of Component Snap should never import the libraries directly. This keeps emergency swap-out tractable.
- Track the size budget in `meta.json`'s build section.
- Document the divergence between "rrweb's snapshot of the page" and "Component Snap's target subtree" in the adapter layer.

## What's NOT in this decision

- **Honest fidelity scoring (pixelmatch real vs heuristic).** Already planned as a separate fix; tracked outside this ADR.
- **Camino B (AI-driven output).** Explicitly out of scope. May revisit later as an additional export mode, but not as the primary direction.
- **Mitosis integration.** Belongs to Camino B.
- **Migration path of existing capsule (CDP-driven) pipeline.** The capsule path stays as a supplementary data source (custom properties, keyframes, descendant rules via CDP). It is no longer the primary artifact producer.

## References

External
- [rrweb](https://github.com/rrweb-io/rrweb) — record/replay over time
- [rrweb-snapshot](https://github.com/rrweb-io/rrweb/blob/master/packages/rrweb-snapshot/README.md) — DOM serialization subset
- [rrweb serialization docs](https://github.com/rrweb-io/rrweb/blob/master/docs/serialization.md)
- [SnapDOM](https://github.com/zumerlab/snapdom) — modern html2canvas alternative
- [SnapDOM website](https://snapdom.dev/)
- [DOM Inspector Plus](https://github.com/Sreelal727/dom-inspector-plus) — closest direct competitor, MIT, has `interaction-capture.ts`
- [SingleFile](https://github.com/gildas-lormeau/SingleFile) — asset inlining reference
- [Builder.io Visual Copilot architecture writeup](https://www.builder.io/blog/figma-to-code-visual-copilot)
- [How session replay works (rrweb deep dive)](https://dev.to/yuyz0112/how-does-session-replay-work-part1-serialization-3pbk)
- [Best of session-replay tools (PostHog, May 2026)](https://posthog.com/blog/best-open-source-session-replay-tools)

Internal
- `docs/adr/0001-replay-first-architecture.md` — original replay-first decision
- `docs/adr/0002-render-scene-frame-contract.md` — render-scene boundary
- `EPIC_RUNTIME_TWIN_V2.md` — Pillar 1–6 architecture
- `ISSUES.md` — current technical blockers
- Issues `#53–#58` — Tier 1–6 epics (updated post-ADR with concrete library integration steps)
