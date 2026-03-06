# Component Snap - Known Issues & Blockers

## 1. CSS Variable Enumeration Failure (High Priority)
**Problem:** `window.getComputedStyle(el)` does not allow enumeration of custom properties (CSS Variables) via indices. Our current `getVariables` function returns an empty set, causing all `var(--...)` dependent styles (like Lichess skins and piece sets) to fail.
**Proposed Fix:** Scan all document stylesheets once to collect all unique variable names used in the app, then use `getPropertyValue(name)` on the target elements to capture their active values.

## 2. SVG Marker & Defs Isolation
**Problem:** Components using SVGs for arrows or complex icons often rely on `<defs>` or `<marker>` elements defined elsewhere in the DOM. Capturing a subtree often misses these definitions, leading to broken visuals (e.g., arrows without heads).
**Proposed Fix:** Automatically detect `url(#id)` references in SVG attributes and attempt to locate and include the referenced definitions in the snapshot.

## 3. External Asset CORS/Referrer Block
**Problem:** Even when URLs are resolved correctly, some sites block asset loading (images, fonts) when the "Referer" is not their own domain. Standalone snapshots viewed from `file://` or a different origin may trigger these blocks.
**Proposed Fix:** Offer an "Asset Proxy" or "Base64 Inline" mode for high-fidelity exports.

## 4. Shadow DOM (Closed)
**Problem:** Components inside a `closed` Shadow Root remain invisible to our traverser.
**Status:** Known limitation of the Web Platform.

## 5. Viewport-Relative Sizing (vh/vw)
**Problem:** If a component is sized using `vh` or `vw`, it may look different in the standalone preview if the preview window size differs from the original.
**Proposed Fix:** Optionally convert `vh`/`vw` to absolute `px` during capture.
