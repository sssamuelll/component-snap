import type { ReplayViewerState } from '../cdp/replayViewerState.ts'

const DATA_URL_PREFIX = /^data:([^;,]+)?(;base64)?,/i

export const sanitizeArtifactSegment = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'artifact'

export const dataUrlToBuffer = (value: string) => {
  const match = value.match(DATA_URL_PREFIX)
  if (!match) throw new Error('Expected a data URL artifact.')
  const payload = value.slice(match[0].length)
  if (match[2]) return Buffer.from(payload, 'base64')
  return Buffer.from(decodeURIComponent(payload), 'utf8')
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

export interface PortableArtifactStructureCheck {
  ok: boolean
  warnings: string[]
  evidence: string[]
}

const detectBootstrapRootSelector = (js: string) => {
  const match = js.match(/const\s+rootSelector\s*=\s*(["'])((?:\\.|(?!\1).)*)\1/)
  const raw = match?.[2] || ''
  return raw.replace(/\\([\\"'])/g, '$1')
}

export const inspectPortableArtifactStructure = (input: {
  html: string
  js: string
  expectedRootSelector?: string
  targetClass?: 'semantic-ui' | 'render-scene'
}): PortableArtifactStructureCheck => {
  const warnings: string[] = []
  const evidence: string[] = []
  const html = input.html || ''
  const js = input.js || ''
  const bootstrapRootSelector = detectBootstrapRootSelector(js)
  const hasMaterializedRoot = /data-csnap-root="true"/i.test(html)
  const hasCapsuleRoot = /data-csnap-capsule-root="true"/i.test(html)
  const hasScenePrimitive = /<cg-board\b|<piece\b|<square\b/i.test(html)
  const hasSceneFrame = /puzzle__board|cg-wrap|cg-container|data-csnap-root="true"/i.test(html)

  if (hasMaterializedRoot) evidence.push('structure-root-materialized')
  else warnings.push('structure-root-missing')

  if (hasCapsuleRoot) evidence.push('structure-capsule-root-materialized')

  if (bootstrapRootSelector) {
    evidence.push(`structure-bootstrap-selector:${bootstrapRootSelector}`)
    if (bootstrapRootSelector === '[data-csnap-root="true"]' && hasMaterializedRoot) {
      evidence.push('structure-bootstrap-root-aligned')
    } else if (hasMaterializedRoot) {
      warnings.push('structure-bootstrap-root-mismatch')
    }
  } else {
    warnings.push('structure-bootstrap-selector-missing')
  }

  if (input.expectedRootSelector) {
    if (input.expectedRootSelector === '[data-csnap-root="true"]' && hasMaterializedRoot) {
      evidence.push('structure-expected-root-present')
    } else if (input.expectedRootSelector !== '[data-csnap-root="true"]' && html.includes(input.expectedRootSelector)) {
      evidence.push('structure-expected-root-present')
    } else {
      warnings.push(`structure-expected-root-missing:${input.expectedRootSelector}`)
    }
  }

  if (input.targetClass === 'render-scene' || hasScenePrimitive) {
    if (hasSceneFrame) evidence.push('structure-scene-frame-present')
    else warnings.push('structure-scene-frame-missing')
  }

  return {
    ok: warnings.length === 0,
    warnings,
    evidence,
  }
}

export const buildPortablePreviewDocument = (input: {
  title: string
  html: string
  css: string
  js: string
}) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(input.title)}</title>
    <style>
      html, body {
        margin: 0;
        min-height: 100vh;
        background: #ffffff;
      }
      body {
        display: flex;
        align-items: flex-start;
        justify-content: flex-start;
        padding: 24px;
        box-sizing: border-box;
      }
      #component-snap-frame {
        display: inline-block !important;
        position: relative !important;
        isolation: isolate !important;
        box-sizing: border-box !important;
        min-width: 1px !important;
        min-height: 1px !important;
      }
      #component-snap-root {
        display: inline-block !important;
        position: relative !important;
        box-sizing: border-box !important;
        min-width: 1px !important;
        min-height: 1px !important;
      }
    </style>
    <style>${input.css}</style>
  </head>
  <body>
    <div id="component-snap-frame"><div id="component-snap-root">${input.html}</div></div>
    <script type="module">${input.js}</script>
  </body>
</html>
`

export const buildReplayViewerArtifact = (state: ReplayViewerState) => {
  const warnings = [...state.screenshotWarnings]
  const debug = [
    `imageSource=${state.imageSource}`,
    `timelineEvents=${state.debug.timelineEventCount}`,
    `missingArtifacts=${state.debug.missingArtifacts.join('|') || 'none'}`,
    `mappingStrategy=${state.debug.mappingStrategy || 'n/a'}`,
    `mappingConfidence=${typeof state.debug.mappingConfidence === 'number' ? state.debug.mappingConfidence.toFixed(3) : 'n/a'}`,
  ]

  const targetRect = state.targetRect
    ? `x=${state.targetRect.x}, y=${state.targetRect.y}, width=${state.targetRect.width}, height=${state.targetRect.height}`
    : 'n/a'

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Replay Viewer Artifact</title>
    <style>
      body {
        margin: 0;
        padding: 24px;
        font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
        background: #f6f7fb;
        color: #1f2430;
      }
      .frame {
        display: inline-block;
        border: 1px solid #c8d0e0;
        background: #fff;
        padding: 12px;
      }
      img {
        display: block;
        max-width: 100%;
        border: 1px solid #d9deea;
      }
      pre {
        white-space: pre-wrap;
        margin: 16px 0 0;
      }
    </style>
  </head>
  <body>
    <div class="frame">
      ${state.imageSrc ? `<img alt="Replay snapshot" src="${state.imageSrc}" />` : '<p>No screenshot artifact available.</p>'}
    </div>
    <pre>${escapeHtml(
      [
        `page=${state.pageTitle} <${state.pageUrl}>`,
        `createdAt=${state.createdAt}`,
        `targetRect=${targetRect}`,
        `warnings=${warnings.join('|') || 'none'}`,
        ...debug,
      ].join('\n'),
    )}</pre>
  </body>
</html>
`
}
