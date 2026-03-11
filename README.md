# Component Snap (Next-Gen)

An advanced Chrome Extension (Manifest V3) engineered to capture UI components from any webpage with high visual and behavioral fidelity. It transforms live DOM subtrees into portable, self-contained "Digital Twins."

## 🚀 The Atomic Motion Engine

Component Snap follows a replay-first capture direction. The single-folder `component.html/css/js` output is retained as a portable fallback extractor, not the primary architecture.

The portable fallback extractor currently:

- **Atomic Scoped Stylesheets:** Replaces static inline styles with dynamic, per-node CSS mappings (`[data-csnap="X"]`). This preserves the "soul" of the component, allowing original CSS transitions and animations to interpolate correctly between states.
- **Shadow-Piercing Traversal:** Recursively navigates and flattens every `ShadowRoot` on the page, piercing encapsulation boundaries to capture hidden icons and sub-components.
- **Global Symbol Harvester:** Scans the entire document for global SVG `<symbol>` and `<defs>` references, automatically bundling them into the snap to ensure iconography remains visible.
- **Interactive State Capture:** Pierces through Shadow DOM to capture `:hover`, `:active`, and `:focus` states, preserving behavioral feedback.
- **Asynchronous Base64 Inlining:** Downloads and encodes all external images, board skins, and fonts as Data URIs during capture for 100% domain independence.

## 🛠 Features

- **DevTools-Style Picker:** Activate a visual selector to identify the perfect component "shell" using a confidence-weighted traversal algorithm.
- **Action Mirror Engine:** Injects a functional layer into exports that provides visual ripple feedback on interactions and logs events to the console.
- **Dark Mode Aware:** Automatically detects the original page's color scheme and background to ensure the preview is contextually accurate.
- **Portable Fallback Exports:** Generates a single-folder lower-tier bundle for portability/debug workflows.

## 📁 Export Structure

Each snap is exported directly to your Downloads folder:

```text
Downloads/component_snap/<timestamp>_<tag>/
├── component.html   # Interactive preview with Atomic Styles
├── component.css    # Scoped stylesheet + Keyframes + Variables
├── component.js     # Interaction shim (Drag & Drop + Action Mirror)
├── snapshot.html    # Static, CSS-frozen version
├── screenshot.png   # Original rendered source of truth
└── meta.json        # Capture metadata & structural info
```

## 🧱 Technical Blockers (The Fidelity Wall)

Despite its advanced engine, Component Snap is currently hitting fundamental limitations of the web platform:
- **JavaScript Brain Loss:** We capture the *state* but not the *logic*. React/Vue internal state changes cannot be reversed without original source code.
- **User Agent Leak:** Browser defaults can still interfere with computed styles.
- **Asset Isolation:** Highly secured assets (CORS/Hotlinking) may occasionally fail Base64 conversion.

Refer to **[Issue #2](https://github.com/sssamuelll/component-snap/issues/2)** for the full technical failure report.

## 🏗 Stack

- **Frontend:** React + Vite + TypeScript
- **Build:** `@crxjs/vite-plugin`
- **Testing:** Playwright (E2E) & Vitest (Unit)

## Benchmark Harness

Issue #18 adds a small benchmark harness for the current replay-first pipeline. It targets:

- Google search bar
- Reddit header
- Lichess board

Run it after building the extension:

```bash
npm run build
npm run benchmark -- --scenario all
```

Useful flags:

- `--headed` to debug extension runs interactively
- `--update-baseline` to write `benchmarks/baselines/<scenario>/source.png`
- `--out-dir <dir>` and `--baseline-dir <dir>` to redirect artifacts

The harness writes stable JSON/TXT/PNG outputs under `benchmarks/runs/<timestamp>/...` and records honest skips/warnings when a live site cannot be automated reliably.

## 🚦 Getting Started

1. **Install Dependencies:** `npm install`
2. **Build Extension:** `npm run build`
3. **Load in Chrome:** Open `chrome://extensions`, enable **Developer mode**, and select the `dist/` folder.
4. **Run Verification:** `npm run test` or use specialized repro scripts like `npx tsx repro_reddit.ts`.
