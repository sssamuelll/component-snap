# Component Snap

Chrome Extension (Manifest V3) to capture a UI component from any webpage and export:

- screenshot (`screenshot.png`)
- HTML/CSS/JS artifacts
- metadata (`meta.json`)

## Current status

Component Snap is functional for basic snaps, but still has an open blocker:

- **Visual fidelity mismatch** on complex/dynamic sites (e.g. Google search bar)
- **Duplicate export structure** (`portable/` and `raw/`) when only one final export is desired

These are tracked in the first GitHub issue.

## Stack

- React + Vite + TypeScript
- `@crxjs/vite-plugin` (Chrome extension build)
- Playwright (E2E)
- Vitest (unit)

## Project scripts

```bash
npm install
npm run build
npm run test
npm run test:e2e
```

## Load extension locally

1. Build:
   ```bash
   npm run build
   ```
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked** and select `dist/`

## Current export behavior

Each snap writes to:

```text
Downloads/component_snap/<timestamp>_<tag>/
```

With artifacts currently including:

- `portable/component.html`
- `portable/component.css`
- `portable/component.js`
- `portable/snapshot.html`
- `raw/component.html`
- `raw/component.css`
- `raw/component.js`
- `screenshot.png`
- `meta.json`

## Goal

Produce exports that look **exactly** like the original rendered component and avoid redundant artifact duplication unless explicitly requested.
