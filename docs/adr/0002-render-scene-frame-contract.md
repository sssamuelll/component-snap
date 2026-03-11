# ADR 0002 — Adopt a render-scene frame contract for scene-like exports

- **Status:** Accepted
- **Date:** 2026-03-11
- **Related Issues:** #5, #18, #19, #21, #22
- **Related ADR:** `docs/adr/0001-replay-first-architecture.md`

## Context

Component Snap now has enough replay-first and scene-detection machinery to expose a more fundamental product boundary:

- some targets are ordinary **semantic UI**
- some targets are **render-scene** surfaces

Examples of render-scene targets include:
- Lichess boards
- scene-like custom-element surfaces
- layered DOM renderers
- editor/game-style UI regions

Recent Lichess captures made the failure mode clear:

- the picked node may be a scene primitive like `cg-board`
- selection heuristics may correctly promote a visual root like `div.puzzle__board.main-board`
- but fallback or portable export can still collapse toward a leaf scene primitive
- the captured CSS still assumes wrapper-chain context (`main-board`, `cg-wrap`, `cg-container`, absolute layers, transforms)
- the final artifact then becomes visually blank or incoherent, even when it contains pieces, squares, assets, and other real scene structure

This means the remaining problem is not just “missing CSS” or “bad selector choice”.
It is a mismatch between the system’s export model and the actual rendering contract of scene-like targets.

## Problem

Component Snap currently mixes three truths that diverge on render-scene targets:

1. **selection truth** — what visual root we choose on the live page
2. **export truth** — what subtree we actually serialize/package
3. **render truth** — what structure must remain intact for the target to render coherently

For semantic UI, these often align.
For render-scene targets, they do not.

The system still assumes too strongly that:

> enough DOM + CSS + assets = portable twin

That can hold for semantic UI.
It does not reliably hold for scene-like targets unless the frame that gives geometry and positioning meaning is preserved.

## Decision

Component Snap will adopt a **render-scene frame contract**.

For targets classified as `render-scene`, the canonical export unit is:

> **render root + required frame chain + scene primitives**

not the picked leaf subtree alone.

### Definitions

#### Picked node
The node directly hit-tested or chosen by the user.

#### Promoted root
The visual root promoted by selection heuristics to better represent the target.

#### Render root
The canonical root that export must preserve for scene coherence.

For `render-scene`, render root equals the promoted root unless a wider wrapper is required for geometry.

#### Frame chain
The minimum wrapper chain required to preserve:
- positioning context
- dimensions / aspect ratio
- transforms
- absolute/fixed layer relationships
- scene container semantics

Examples:
- board/stage/viewport wrappers
- `cg-wrap`
- `cg-container`
- transform-bearing containers
- scene/layer wrappers

#### Scene primitives
Renderable scene children such as:
- `canvas`
- `svg`
- `video`
- `img`
- scene custom elements like `cg-board`, `piece`, `square`
- absolute-positioned layered descendants

## Rules

### 1. Export boundary rule
For `render-scene`, export must preserve the render root and any frame-bearing wrappers required for geometry.

### 2. Wrapper-preservation rule
Wrappers must not be collapsed merely because they look low-semantic if they carry:
- position context
- size context
- transform context
- layer grouping
- scene-container meaning

### 3. Bootstrap rule
Export bootstrap/runtime logic must target the **exported root selector**, not a page-only selector that may not exist in the artifact.

### 4. Fidelity rule
A render-scene export cannot be considered strong portable success if the frame contract is incomplete.

### 5. Honesty rule
If scene primitives survive but frame context is lost, the system must report this explicitly rather than presenting the output as a strong portable twin.

## Export validity states

### Frame-complete
A render-scene export is `frame-complete` if:
- exported root equals render root
- required frame chain is preserved
- scene primitives remain inside that frame
- bootstrap targets the exported artifact root
- geometry required for rendering remains meaningful

### Frame-incomplete
A render-scene export is `frame-incomplete` if:
- export collapses to a leaf primitive
- wrapper chain required for geometry is removed
- positioning or sizing context is lost
- bootstrap targets a selector absent from the artifact
- scene primitives survive but their scene does not

### Leaf-without-frame
A special failure subtype of `frame-incomplete` where scene leaf primitives remain (`cg-board`, `piece`, `square`, etc.) but the frame required to render them coherently is gone.

## Metadata consequences

`meta.json` must evolve to record, for render-scene targets:
- `targetClass`
- `exportMode`
- `pickedSelector`
- `promotedSelector`
- `renderRootSelector`
- `exportedRootSelector`
- `bootstrapRootSelector`
- `frameStatus`
- `frameFailureReason`
- build identity (`commitSha`, build timestamp, pipeline version)

This is required both for honesty and for reliable debugging.

## Scoring consequences

Render-scene scoring must emphasize:
- frame integrity
- scene primitive retention
- wrapper-chain preservation
- transform preservation
- layer integrity
- geometry coherence

It must de-emphasize semantic-ui-biased assumptions like:
- text richness
- anchor density
- semantic subtree completeness as the primary proxy

A `frame-incomplete` render-scene export must receive a hard portability penalty.

## Product consequences

Render-scene targets should not be treated as ordinary portable semantic components.

Acceptable outputs include:
- `render-scene-freeze`
- future `render-scene-bundle`

Unacceptable output behavior:
- presenting a `frame-incomplete` render-scene fallback as a strong portable component twin

## Positive consequences

- aligns export behavior with actual rendering truth for scene-like targets
- explains Lichess-style failures in architectural terms instead of patch-level symptoms
- gives selection, export, bootstrap, scoring, and metadata a shared unit of truth
- makes future scene-bundle work legible

## Negative consequences / costs

- more explicit complexity in capture/export rules
- fewer shortcuts where wrapper collapsing used to seem harmless
- forces clearer product messaging when strong portability is not actually available
- requires spec, metadata, scoring, and benchmark updates, not just extractor tweaks

## Non-goals

This ADR does **not** promise universal portable replay of all scene-like targets.

Its purpose is narrower:
- make scene exports structurally coherent
- make failure explicit when frame preservation is incomplete
- stop stretching semantic component portability beyond its natural boundary

## Follow-up work

1. update export spec / `meta.json` v2 with render-scene frame fields
2. add frame-preservation boundary rules to selection/export
3. route render-scene fallback/export through a frame-aware path
4. add frame-integrity scoring and failure taxonomy
5. align benchmark and preflight expectations with render-scene classification
