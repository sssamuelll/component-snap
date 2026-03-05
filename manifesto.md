# Spec: **ComponentSnap** (Chrome Extension)

## 1. Purpose

A Chrome extension that, on demand, activates an on-page element selector. When the user clicks an element, the tool extracts:

- The selected element’s HTML (optionally including its subtree).
- The element’s effective styling, primarily via computed styles, producing a portable “component snapshot”.

Primary goal: generate a reproducible snapshot of a component’s structure + appearance from the current page state.

## 2. Non-Goals

- Perfect reconstruction of original authored CSS (selectors/media queries/variables) in all cases.
- Bypassing browser security boundaries (CORS, cross-origin stylesheet access, closed Shadow DOM).
- Full fidelity across all responsive breakpoints or interaction states by default.

## 3. User Stories

1. User clicks the extension action → selector mode activates.
2. User hovers elements → hovered element is highlighted + shows a small tooltip (tag/classes).
3. User clicks an element → snapshot is generated and presented (copy/download).
4. User cancels selector mode via `Esc` or action click again.

## 4. Output Formats

### 4.1 Default: Portable Snapshot (Computed Styles)

- `snapshot.html`: HTML snippet (selected node or subtree).
- `snapshot.css`: generated CSS based on computed styles, scoped to the snapshot root.
- Optional: `snapshot.json` (metadata).

### 4.2 Optional: Inline Styles Mode

- Single HTML output where every element in the subtree gets `style="..."` based on computed styles.
- Highest fidelity, least maintainable.

### 4.3 Optional: Asset Report

- List of external asset URLs referenced by computed styles:
  - `background-image`, `mask-image`, `border-image`, fonts, etc.

## 5. Functional Requirements

### 5.1 Selector Mode

- Activate on extension icon click.
- Hover:
  - Draw overlay rectangle around hovered element.
  - Do not interfere with page layout.

- Click:
  - Select element under cursor (ignoring the overlay).
  - Freeze selection, extract data, exit selector mode.

- Cancel:
  - `Esc` exits selector mode without extracting.

### 5.2 Extraction

On selection, compute:

- **HTML**
  - `outerHTML` of selected element.
  - Option to include subtree (default: include subtree).
  - Remove script tags by default (configurable).

- **Styles**
  - For each element in the exported subtree:
    - Gather `getComputedStyle(element)` for a defined property allowlist.
    - Gather `getComputedStyle(element, '::before')` and `::after`.

  - Generate CSS scoped to the exported component (see scoping strategy).

- **Metadata**
  - Page URL, timestamp, viewport size, user agent (optional), extraction mode, root selector path.

### 5.3 Scoping Strategy

Assign a unique identifier to the snapshot root:

- Add attribute to exported root in output HTML: `data-componentsnap-root="UUID"`
- Generated CSS scopes all rules under:
  - `[data-componentsnap-root="UUID"] ...`

### 5.4 Presentation / Export

- Display results in one of:
  - Extension popup with tabs: HTML / CSS / Metadata.
  - Or a side panel for larger output (preferred for large snapshots).

- Actions:
  - Copy HTML
  - Copy CSS
  - Download as ZIP (html+css+json)

## 6. Computed Style Policy

### 6.1 Property Allowlist (initial)

Include properties most relevant to layout/appearance; exclude noisy defaults where possible.

Suggested categories:

- Box model: `display`, `position`, `top/right/bottom/left`, `margin*`, `padding*`, `width/height`, `box-sizing`
- Typography: `font*`, `line-height`, `letter-spacing`, `text-*`, `color`
- Background/border: `background*`, `border*`, `border-radius`, `box-shadow`, `outline*`
- Flex/grid: `flex*`, `align*`, `justify*`, `gap`, `grid*`
- Transforms: `transform*`, `opacity`, `filter`
- Misc: `cursor`, `pointer-events`, `z-index`, `overflow*`, `visibility`, `white-space`

### 6.2 De-noising Rules (initial)

- Skip properties whose value equals the UA default when determinable (best-effort).
- Skip vendor-prefixed properties unless requested.
- Skip animation/transition properties by default (configurable).
- Convert computed colors to a consistent format (e.g., `rgb/rgba` as returned).

### 6.3 Pseudo-elements

If `::before`/`::after` computed `content` is not `none`/empty:

- Emit a CSS rule for the pseudo-element including `content` and relevant properties.

## 7. Shadow DOM Handling

- If the selected element is inside an **open** shadow root:
  - Extraction can traverse and serialize nodes within that open shadow root.

- If within a **closed** shadow root:
  - Extraction is not possible; tool should report limitation.

## 8. Permissions & Security

### 8.1 Chrome Extension Permissions (minimum)

- `activeTab` (inject content script on demand)
- `scripting` (MV3 injection)
- `storage` (user settings)
- Optional:
  - `downloads` (export ZIP)
  - `sidePanel` (if using side panel UI)

### 8.2 Data Handling

- All extraction runs locally in the browser.
- No network upload by default.
- If future “share” features exist, they must be explicit opt-in.

## 9. Architecture

### 9.1 Components

- **Service Worker (background)**
  - Handles action click → toggles selector mode
  - Manages export/download

- **Content Script**
  - Selector overlay UI
  - DOM traversal + style computation
  - Sends results to background/popup

- **Popup / Side Panel UI**
  - Displays outputs and actions

### 9.2 Messaging

- `START_PICKER`, `STOP_PICKER`
- `PICKER_HOVER` (optional telemetry for UI)
- `ELEMENT_SELECTED` → payload includes HTML/CSS/metadata
- `EXPORT_ZIP`

## 10. Performance Requirements

- Must remain responsive on pages with large DOM.
- Default subtree limit:
  - Max nodes exported: e.g., 2,000 (configurable)
  - If exceeded: warn and offer “selected node only” or “cap depth”.

- Extraction time target: < 500ms for typical component subtrees (< 500 nodes), best-effort.

## 11. Error Handling

- Cross-origin stylesheet access failures are expected; in computed-style mode this is not fatal.
- If selection is `document.documentElement` or `body`, warn and confirm via UI toggle (or allow).
- If pseudo-element styles cannot be read, omit with a note in metadata.

## 12. Settings (v1)

- Export scope:
  - Selected node only / entire subtree
  - Max depth / max nodes

- Style mode:
  - Scoped CSS (default)
  - Inline styles

- Include pseudo-elements: on/off
- Remove scripts: on/off
- Include asset report: on/off

## 13. Acceptance Criteria

1. Clicking extension icon toggles selector mode on any normal webpage.
2. Hover highlights the element under cursor with accurate bounding box.
3. Clicking selects an element and produces:
   - Valid HTML output (parseable)
   - CSS output that, when applied to that HTML, closely matches the on-page rendering in the same viewport

4. `Esc` exits without output.
5. Outputs can be copied and downloaded.

## 14. Known Limitations

- Computed snapshot reflects current state only (viewport, theme, dynamic classes).
- External assets may not be fetchable due to CORS.
- Closed Shadow DOM cannot be inspected.
- Some visuals depend on ancestor context (e.g., inherited font, CSS vars, container queries); snapshot may differ unless those values are fully resolved in computed output.

## 15. Versioning

- v0.1: picker + HTML export
- v0.2: computed style export (root only)
- v0.3: subtree + scoped CSS + pseudo-elements
- v0.4: side panel UI + ZIP export + settings

## 16. Repo Layout (suggested)

- `/extension`
  - `manifest.json`
  - `background.js`
  - `contentScript.js`
  - `/ui` (popup or sidepanel)
  - `/lib` (serializer, css generator, utils)

Name: **ComponentSnap**
