# Component Snap - Critical Failure Report & Technical Blockers

Despite multiple iterations (v0.0.1 to v0.0.8), Component Snap currently fails to achieve 100% accuracy on complex, modern web components (e.g., Reddit Header, Lichess Board). 

## 1. The "Fidelity Wall": Fundamental Approach Issues
Our current strategy relies on **DOM Cloning + Computed Style Injection**. This approach is hitting a wall:
- **Event Regression Failure:** We cannot capture JavaScript-driven events. While we can shim "Drag & Drop", we cannot capture the internal logic of a complex app (e.g., Lichess's move validation).
- **Style Mapping Mismatch:** Flattening Shadow DOM elements (Reddit) causes a break in CSS inheritance. Styles defined for a specific shadow root context often fail to apply correctly once the element is moved to the Light DOM.
- **Resource Isolation:** Icons and assets referenced via global SVG `<symbol>` or internal variables are often missed if they live outside the captured subtree's immediate reach.

## 2. Unresolved Issues (Status: Critical)
### A. The "Weird" Look (Browser Default Leak)
- **Problem:** Even with a CSS reset and de-noising, browser-specific styles (User Agent Styles) for inputs, buttons, and scrollbars interfere with the captured component.
- **Why it persists:** `getComputedStyle` provides the *final* value but not the *intent*. We cannot programmatically know if a property was set by a designer or by the browser's default engine.

### B. Missing Child Components (Shadow DOM)
- **Problem:** Elements inside deep, nested Shadow Roots (Reddit shreddit-icons) often appear blank.
- **Why it persists:** Our flattening engine attempts to move these to the Light DOM, but this often breaks the "scoped" CSS variables and part-styles that the component depends on.

### C. Motion & Transition Gaps
- **Problem:** Hover animations and transitions are often incomplete or "janky".
- **Why it persists:** Capturing a `:hover` state via `collectPseudoDeclarations` is limited. It cannot capture transitions that involve parent-child state changes (e.g., `header:hover .icon { ... }`).

## 3. The Path Forward (Alternative League)
To achieve "Amazing" fidelity, we may need to pivot away from DOM cloning and move towards:
1. **MHTML/WebBundle Capture:** Capturing the entire page state as a frozen binary and then programmatically cropping it.
2. **Canvas-based Proxying:** Capturing the visual layers as bitmap/vector paths instead of re-implementing the DOM.
3. **WASM-based Interaction Mirroring:** Using a more robust engine to intercept and proxy all event listeners at the prototype level.
