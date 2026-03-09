# Component Snap v2 — Design Doc: CDP Capture Backbone

- **Status:** Draft
- **Date:** 2026-03-09
- **Related Issues:** #6, #7, #8, #9, #10
- **Depends on:** `docs/adr/0001-replay-first-architecture.md`, `docs/spec-export-modes-meta-v2.md`

## Goal

Introduce a Chrome DevTools Protocol (CDP) capture backbone that becomes the primary source of runtime/page truth for Component Snap v2.

This backbone will complement the existing extension capture flow and eventually replace it as the architectural center for replay-first capture.

---

## Why this exists

The current extension-only pipeline is good at:
- selecting a target on the live page
- extracting a subtree
- exporting fallback HTML/CSS/JS bundles
- cropping screenshots

But it is weak at capturing:
- page-level context
- DOMSnapshot truth
- CSS rule provenance
- Shadow DOM topology
- runtime complexity signals
- stable replay-oriented capture state

CDP is the right backbone because it gives us structured access to browser truth, not only content-script-accessible approximations.

---

## Scope of #6

This issue should implement the first working CDP capture path for:

- active target page binding
- page-level screenshot capture
- viewport / DPR / scroll capture
- DOMSnapshot capture
- initial runtime/environment metadata capture
- normalized internal capture bundle

This issue should **not** fully solve:
- target-to-node mapping (#7)
- CSS provenance graph (#8)
- Shadow DOM topology detail (#9)
- resource graph / bundling (#10)
- replay capsule (#11)

But the design must leave room for them.

---

## OSS / External inputs to reuse

## 1. chrome-remote-interface
Repo: https://github.com/cyrus-and/chrome-remote-interface

Use for:
- connection setup patterns
- CDP session lifecycle
- domain enable/disable flow
- scripting examples for DOM / Runtime / Page domains

## 2. Chrome DevTools Protocol domains
Primary domains to use now:
- `Page`
- `Runtime`
- `DOMSnapshot`
- `DOM`

Domains to leave hooks for next:
- `CSS`
- `Accessibility`
- `Network`

## 3. Existing Component Snap capture flow
Reuse:
- picker UX
- selected element data
- screenshot clip logic concepts
- current target metadata as seed input for normalized capture bundle

---

## High-level architecture

```text
Popup UI
  -> Background/service worker
    -> Content script target selection
      -> Target seed payload
        -> CDP capture orchestrator
          -> Page/Runtime/DOMSnapshot capture
            -> normalized capture bundle
              -> downstream replay/extraction/scoring
```

### Important principle
The extension still owns **selection UX**.
CDP owns **capture truth**.

---

## Proposed modules

## 1. `src/cdp/types.ts`
Purpose:
- shared TypeScript types for CDP capture
- internal normalized capture bundle types

Should define at minimum:
- `CaptureSeed`
- `CaptureViewport`
- `CaptureEnvironment`
- `CaptureScreenshot`
- `CaptureDomSnapshot`
- `CaptureBundleV0`
- `CaptureBackend = 'extension' | 'cdp'`

---

## 2. `src/cdp/client.ts`
Purpose:
- establish and manage CDP connection/session

Responsibilities:
- connect to a Chrome target
- handle session creation/lifecycle
- expose enabled domains
- wrap raw protocol failures into internal errors

Design notes:
- keep transport details isolated
- avoid leaking raw protocol shape everywhere else
- future-proof for either local browser or remote debugging target

---

## 3. `src/cdp/pageCapture.ts`
Purpose:
- page/environment capture helpers

Responsibilities:
- get viewport metrics
- get device pixel ratio
- get scroll offsets
- capture page screenshot
- capture clip screenshot when we have target box
- return normalized screenshot object

---

## 4. `src/cdp/domSnapshotCapture.ts`
Purpose:
- capture DOM snapshot data from CDP

Responsibilities:
- call `DOMSnapshot.captureSnapshot`
- normalize relevant parts of the response
- keep raw response attached for debugging until schema stabilizes

Design notes:
- do not over-normalize too early
- retain enough raw structure for later CSS/shadow integration

---

## 5. `src/cdp/runtimeCapture.ts`
Purpose:
- capture environment/runtime metadata

Responsibilities:
- evaluate viewport / scroll / media preferences if needed
- capture user-agent / document metadata
- capture simple runtime hints
- record framework hint probes only if low-risk and deterministic

Examples of initial signals:
- URL
- title
- user agent
- document language
- color scheme
- reduced motion preference
- presence hints for canvas/webgl/iframes/shadow roots (coarse for now)

---

## 6. `src/cdp/orchestrator.ts`
Purpose:
- orchestrate the full capture sequence

Responsibilities:
- accept seed data from extension flow
- call page/runtime/DOMSnapshot capture helpers
- assemble `CaptureBundleV0`
- return bundle to background/service worker

This is the main entrypoint for #6.

---

## 7. `src/cdp/errors.ts`
Purpose:
- internal error taxonomy

Examples:
- `CDPConnectionError`
- `CDPDomainError`
- `DOMSnapshotCaptureError`
- `ScreenshotCaptureError`
- `RuntimeCaptureError`

This prevents raw protocol exceptions from leaking into product logic.

---

## Seed input contract

The existing extension flow should provide a lightweight seed object to the CDP orchestrator.

## `CaptureSeed`

```ts
interface CaptureSeed {
  requestId: string
  tabId?: number
  pageUrl: string
  pageTitle: string
  selectedSelector?: string
  stableSelector?: string
  boundingBox?: {
    x: number
    y: number
    width: number
    height: number
    dpr: number
  }
  elementHint?: {
    tagName?: string
    id?: string
    classList?: string[]
    textPreview?: string
    kind?: string
  }
}
```

### Notes
- this seed is not truth; it is a hint packet
- node identity work belongs to #7
- we should not overfit CDP capture to seed selectors alone

---

## Normalized output contract

## `CaptureBundleV0`

This is a temporary internal bundle, not final `meta.json`.

```ts
interface CaptureBundleV0 {
  version: '0'
  captureId: string
  createdAt: string
  backend: 'cdp'
  seed: CaptureSeed
  page: {
    url: string
    title: string
    viewport: { width: number; height: number }
    scroll: { x: number; y: number }
    dpr: number
    userAgent?: string
    colorScheme?: 'light' | 'dark' | 'unknown'
    language?: string
  }
  screenshot: {
    fullPageDataUrl?: string
    clipDataUrl?: string
    clipRect?: { x: number; y: number; width: number; height: number; dpr: number }
  }
  domSnapshot: {
    raw: unknown
    stats?: {
      documents: number
      nodes: number
      layouts?: number
    }
  }
  runtimeHints: {
    shadowDomPresent?: boolean
    iframePresent?: boolean
    canvasPresent?: boolean
    webglPresent?: boolean
  }
  debug?: {
    warnings: string[]
  }
}
```

---

## Capture flow

## Step 1 — seed arrives from current extension flow
Source: background service worker after element selection.

Input includes:
- request id
- page info
- selected selector hints
- bounding box if available

## Step 2 — bind to correct browser target
Use tab/page context to ensure CDP talks to the same page the user selected in.

## Step 3 — capture page/environment
Collect:
- viewport size
- DPR
- scroll
- page screenshot
- optional clip screenshot using current bounding box seed

## Step 4 — capture runtime metadata
Collect:
- title
- URL
- language
- color scheme
- user-agent
- coarse complexity signals

## Step 5 — capture DOMSnapshot
Call `DOMSnapshot.captureSnapshot` with conservative options first.

## Step 6 — assemble normalized bundle
Return a single internal object for downstream use.

---

## Minimal CDP primitives to use first

## `Page.captureScreenshot`
For full-page or viewport screenshot truth.

## `Runtime.evaluate`
For lightweight environment signals such as:
- viewport metrics
- scroll position
- DPR
- document title/lang
- media query status
- coarse presence probes

## `DOMSnapshot.captureSnapshot`
For structural page truth.

## `DOM.getDocument` / `DOM.describeNode`
Optional in #6, but keep hooks ready for #7 node mapping.

---

## Initial implementation strategy

## Phase A — prove connectivity
- establish CDP connection
- capture URL/title/viewport/screenshot
- return a small capture bundle

## Phase B — add DOMSnapshot
- attach raw DOMSnapshot payload
- log snapshot stats
- confirm stability across benchmark pages

## Phase C — integrate with existing flow
- invoke orchestrator after picker selection
- persist capture bundle alongside current exports/debug logs
- do not break current fallback exporter

This issue should stop at “working backbone exists”.

---

## Persistence strategy

For #6, keep persistence simple.

Recommended:
- store recent capture bundle in extension local storage for debugging
- optionally save raw debug JSON only in debug mode
- do not finalize export bundle schema yet

Possible temp files in debug mode:
- `capture.bundle.json`
- `capture.domsnapshot.json`

---

## Error handling

The CDP path must fail soft.

### If CDP capture fails
- preserve current extension fallback behavior
- record a structured warning
- continue Freeze/fallback export if possible

### Error categories
- unable to connect to target
- screenshot capture failed
- runtime evaluate failed
- DOMSnapshot unavailable/failed
- target mismatch

The user should never lose the current fallback output just because CDP failed.

---

## Security / reliability notes

- do not execute invasive page mutations just to capture metadata
- keep runtime probes read-only
- keep framework detection heuristic and low-risk
- avoid giant debug payloads in normal mode
- preserve the ability to disable CDP path for debugging

---

## Success criteria for #6

This issue is complete when:

- we can invoke a CDP capture orchestration path after target selection
- the path returns a normalized `CaptureBundleV0`
- the bundle contains:
  - page URL/title
  - viewport
  - DPR
  - scroll
  - screenshot
  - raw DOMSnapshot
  - coarse runtime hints
- failures degrade gracefully to the current fallback exporter
- implementation leaves clean hooks for #7, #8, #9, and #10

---

## Non-goals for #6

Do **not** try to solve all of these here:
- stable target node mapping
- full CSS provenance graph
- full Shadow DOM topology serialization
- resource bundling
- replay capsule format
- benchmark scoring

Those belong to the next issues.

---

## Suggested task breakdown inside #6

1. Add CDP type definitions
2. Add CDP client/session wrapper
3. Add page capture helpers
4. Add runtime capture helpers
5. Add DOMSnapshot capture helper
6. Add orchestrator entrypoint
7. Call orchestrator from background flow in debug-safe way
8. Persist recent capture bundle for inspection
9. Verify on Google / Reddit / Lichess pages
10. Document known failures and follow-up hooks

---

## Final principle

The CDP backbone should be built as a **truth layer**, not as another ad hoc export helper.

If this layer is designed correctly, replay, extraction, and scoring can all build on top of it without re-capturing the world three different ways.
