# Component Snap v2 — Design Doc: Target-to-CDP Node Mapping

- **Status:** Draft
- **Date:** 2026-03-09
- **Related Issues:** #7, #6, #8, #9, #11
- **Depends on:** `docs/adr/0001-replay-first-architecture.md`, `docs/design-cdp-capture-backbone.md`

## Goal

Map the element selected by the extension content script to a stable identity inside the Chrome DevTools Protocol capture world.

This is required so Component Snap can:
- find the correct target inside DOMSnapshot data
- collect matched CSS rules for the right node
- anchor Shadow DOM context correctly
- spotlight the correct component in replay
- measure fidelity against the intended target rather than an approximation

---

## Why this matters

Right now the extension can identify a target in page JavaScript land, but CDP operates on its own node identity model:
- `nodeId`
- `backendNodeId`
- remote object references
- DOMSnapshot indices

If we cannot bridge those worlds robustly, then replay-first architecture degrades back into “best guess by selector”, which is not good enough for:
- complex repeated components
- dynamic DOMs
- Shadow DOM
- runtime-driven UI mutations
- pages where selectors are unstable or duplicated

---

## Core principle

We should **not** trust any single identity strategy alone.

Instead, node mapping should use a **layered identity strategy**:

1. direct handle / remote object mapping when possible
2. CDP node identity resolution when possible
3. structural fingerprint matching as fallback
4. selector matching only as a weaker fallback

The output should include both:
- resolved node identity
- mapping confidence + evidence

---

## Identity model

## 1. Extension-side target identity

When the user clicks a target, the content script should emit a richer target fingerprint, not just selector text.

### Proposed target fingerprint fields

```ts
interface TargetFingerprint {
  stableSelector?: string
  selectedSelector?: string
  tagName: string
  id?: string
  classList: string[]
  textPreview?: string
  boundingBox: {
    x: number
    y: number
    width: number
    height: number
  }
  ordinalPath?: number[]
  siblingIndex?: number
  childCount?: number
  attributeHints: Array<{ name: string; value: string }>
  ancestry: Array<{
    tagName: string
    id?: string
    classList: string[]
    siblingIndex?: number
  }>
  shadowContext?: {
    insideShadowRoot: boolean
    shadowDepth: number
    hostChain: string[]
  }
}
```

This should become the main seed for mapping, not selector alone.

---

## 2. CDP-side identity

The mapping system should aim to resolve at least one of:
- `backendNodeId` (preferred when possible)
- `nodeId`
- DOMSnapshot index / reference

Why:
- `backendNodeId` is generally more stable across some CDP operations
- `nodeId` is useful for CSS/DOM calls in a given session
- DOMSnapshot indices are useful for replay/capture anchoring

---

## Proposed strategy stack

## Strategy A — direct DOM -> remote object -> node resolution

### Idea
Use CDP runtime evaluation to identify the selected node directly in the live page and convert that to CDP node identity.

### Approaches
- evaluate a resolver script in page context using target fingerprint data
- get a remote object handle
- call DOM resolution APIs to derive `nodeId` / `backendNodeId`

### Why this is best
This is the most direct bridge between content-script target and CDP identity.

### Risks
- runtime changes between selection and capture
- closed shadow roots
- ambiguous resolver results
- object handles may be session-specific and short-lived

---

## Strategy B — DOM.describeNode / DOM.getDocument traversal anchored by fingerprint

### Idea
Walk the DOM via CDP and search for the best node match based on:
- tag
- id
- class tokens
- bounding box proximity
- ancestry path
- sibling index
- text preview

### Why it matters
If direct resolution is not possible, we still need a robust search strategy.

### Risks
- expensive if done naively
- dynamic DOM drift
- duplicated repeated nodes

---

## Strategy C — DOMSnapshot-backed fingerprint matching

### Idea
Once a DOMSnapshot exists, match the target against snapshot nodes using a weighted fingerprint score.

### Candidate signals
- tag name
- attributes
- ancestor path similarity
- text snippets
- layout bounds
- shadow host chain
- sibling count / child count

### Why this matters
This is essential for replay and offline-ish matching, even if live node ids shift.

---

## Strategy D — selector fallback

### Idea
Use the stable selector or selected selector as a weak fallback.

### Why it is weak
- duplicates are common
- class-based selectors are unstable
- Shadow DOM often breaks selector assumptions
- dynamic UI can re-render under the same selector

Selector matching should never be treated as high-confidence by itself.

---

## Weighted confidence model

Each resolved mapping should carry confidence and evidence.

## Example output

```ts
interface NodeMappingResult {
  resolved: boolean
  confidence: number
  strategy: 'direct-handle' | 'dom-traversal' | 'domsnapshot-match' | 'selector-fallback'
  evidence: string[]
  node?: {
    nodeId?: number
    backendNodeId?: number
    objectId?: string
    snapshotIndex?: number
  }
  warnings?: string[]
}
```

## Example scoring intuition
- direct handle + backendNodeId + matching bounds + matching ancestry = very high confidence
- DOM traversal with unique ID/tag/path match = high confidence
- snapshot match with several structural signals = medium/high confidence
- selector-only match = low confidence

---

## Data we should capture from content script next

The current seed is too light for serious mapping. We should expand it.

## Needed additions
- precise bounding box at selection time
- ancestry path summary
- sibling index
- child count
- selected node attribute hints
- shadow host chain when applicable
- ordinal path from root-like anchor

This work can begin in #7 without forcing full schema stabilization yet.

---

## Proposed implementation modules

## 1. `src/cdp/nodeMappingTypes.ts`
Purpose:
- mapping-specific types
- result/confidence structures

## 2. `src/cdp/nodeResolverRuntime.ts`
Purpose:
- runtime-evaluated target resolver
- bridge fingerprint to remote object / candidate nodes

## 3. `src/cdp/nodeResolverDom.ts`
Purpose:
- DOM traversal and node lookup via CDP DOM domain

## 4. `src/cdp/nodeResolverSnapshot.ts`
Purpose:
- DOMSnapshot matching logic
- weighted scoring against snapshot data

## 5. `src/cdp/nodeMapping.ts`
Purpose:
- orchestration across all strategies
- choose best candidate
- return normalized mapping result

---

## Proposed flow

## Step 1 — enrich content-script fingerprint
On selection, gather richer target identity data.

## Step 2 — attempt direct runtime resolution
Use runtime-evaluated lookup first.

## Step 3 — resolve CDP node identity
Convert the matched live element into node identity if possible.

## Step 4 — validate with structural evidence
Compare tag, ancestry, bounds, shadow chain, text snippet.

## Step 5 — attach snapshot anchor
Map the resolved node to DOMSnapshot index/candidate if possible.

## Step 6 — emit `NodeMappingResult`
Store:
- chosen strategy
- confidence
- evidence
- warnings
- resolved identities

---

## Shadow DOM considerations

## Open shadow roots
For open roots, runtime/direct resolution should usually be attempted first.

## Closed shadow roots
Closed roots may limit inspection. In those cases we may only be able to:
- identify host elements
- reason via bounding boxes and visible descendants
- lower confidence explicitly

## Host chain importance
Shadow host ancestry should be preserved as mapping evidence.

---

## Dynamic DOM considerations

A selected target may mutate between click and capture.

To reduce mismatch:
- mapping should happen immediately after selection when possible
- target fingerprint should include geometry and structure
- confidence should be reduced when drift is detected

Potential drift signals:
- bounding box changed too much
- text preview no longer matches
- child count diverges sharply
- candidate count > 1 with near-equal scores

---

## Minimal implementation plan for #7

This issue should aim for a first serious version, not perfection.

## Phase A — richer content-script seed
- capture better target fingerprint data
- send it to background/CDP layer

## Phase B — runtime direct resolution path
- add a page-context resolver using the fingerprint
- attempt CDP object/node resolution

## Phase C — basic confidence model
- emit chosen strategy + evidence + confidence
- downgrade selector-only results

## Phase D — snapshot anchor hook
- attach placeholder or early snapshot linkage for later replay integration

---

## Success criteria for #7

This issue is complete when:
- the selected target is no longer represented only by selector text
- mapping returns a structured `NodeMappingResult`
- at least one direct or structural strategy exists beyond selector fallback
- the result includes confidence and evidence
- mapping works meaningfully better than selector-only on repeated/dynamic elements
- the design leaves clear hooks for CSS capture (#8) and Shadow DOM work (#9)

---

## Non-goals for #7

Do **not** try to solve all of these here:
- full CSS rule provenance capture
- full shadow serialization
- replay viewer integration
- final DOMSnapshot offline matching perfection

The goal is to build a credible bridge between extension target identity and CDP node identity.

---

## OSS / external references to reuse

### chrome-remote-interface
https://github.com/cyrus-and/chrome-remote-interface

Use for:
- DOM / Runtime resolution patterns
- backend node / node id handling

### rrweb / rrweb-snapshot
https://github.com/rrweb-io/rrweb
https://github.com/rrweb-io/rrweb-snapshot

Use for:
- thinking about snapshot anchoring and structural matching
- not necessarily direct code reuse here, but model reuse

---

## Final principle

A selector is a hint.
A node mapping is evidence.

Component Snap needs evidence.
