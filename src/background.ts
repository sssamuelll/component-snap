import { runCDPCapture } from './cdp/orchestrator'
import { scoreCaptureFidelity } from './cdp/fidelityScoring'
import { buildFidelityExport } from './cdp/fidelityReporting'
import { extractPortableFromReplayCapsule } from './cdp/portableExtraction'
import type { ActionTraceEventV0, CaptureBundleV0, CaptureSeed, FidelityScoringV0, MutationTraceEventV0 } from './cdp/types'
import type { TargetClass, TargetFingerprint, TargetSubtype } from './cdp/nodeMappingTypes'
import type { PortableFallbackExtractionDiagnostics } from './portableFallback/extractor'

chrome.runtime.onInstalled.addListener(() => {
  console.log('[component-snap] extension installed')
})

type ClipRect = {
  x: number
  y: number
  width: number
  height: number
  dpr: number
}

type StoredPayload = {
  title: string
  url: string
  selection: string
  exportMode?: 'semantic-ui-portable' | 'render-scene-freeze'
  exportTier?: 'capsule' | 'fallback'
  exportDiagnostics?: {
    source?: 'replay-capsule' | 'portable-fallback'
    targetClass?: 'semantic-ui' | 'render-scene'
    exportMode?: 'semantic-ui-portable' | 'render-scene-freeze'
    warnings: string[]
    confidencePenalty?: number
    confidence?: number
    fidelity?: FidelityScoringV0
    cdpError?: string
  }
  build?: {
    commitSha?: string
    timestamp?: string
    pipelineVersion?: string
  }
  provenance?: {
    pickedSelector?: string
    promotedSelector?: string
    renderRootSelector?: string
    exportedRootSelector?: string
    bootstrapRootSelector?: string
  }
  frame?: {
    status?: 'frame-complete' | 'frame-incomplete'
    failureReason?:
      | 'leaf-without-frame'
      | 'missing-position-context'
      | 'missing-size-context'
      | 'missing-wrapper-chain'
      | 'bootstrap-root-mismatch'
      | 'unknown'
  }
  snappedAt?: string
  snapFolder?: string
  requestId?: string
  cdpCapture?: unknown
  element?: {
    tag?: string
    id?: string
    classes?: string[]
    text?: string
    selector?: string
    html?: string
    css?: string
    freezeHtml?: string
    js?: string
    kind?: string
    screenshotDataUrl?: string
    selectedSelector?: string
    portableFallback?: PortableFallbackExtractionDiagnostics
    targetFingerprint?: TargetFingerprint
    targetClassHint?: TargetClass
    targetSubtypeHint?: TargetSubtype
    targetClassReasons?: string[]
  }
}

type DebugEvent = {
  at: string
  level: 'info' | 'error'
  requestId?: string
  event: string
  detail?: string
}

const activeRequests = new Map<string, number>()
const debugLog: DebugEvent[] = []

const backgroundGlobal = globalThis as typeof globalThis & {
  __componentSnapRegisterActiveRequest?: (requestId: string, tabId: number) => { ok: boolean }
  __componentSnapGetDebugLogs?: () => DebugEvent[]
}

backgroundGlobal.__componentSnapRegisterActiveRequest = (requestId: string, tabId: number) => {
  activeRequests.set(requestId, tabId)
  log('register_active_request', 'info', requestId, `tabId: ${tabId}`)
  return { ok: true }
}

backgroundGlobal.__componentSnapGetDebugLogs = () => [...debugLog]

const log = (event: string, level: 'info' | 'error' = 'info', requestId?: string, detail?: string) => {
  console.log(`[${level}] ${event} ${requestId || ''}`, detail || '')
  debugLog.unshift({ at: new Date().toISOString(), level, event, requestId, detail })
  if (debugLog.length > 120) debugLog.length = 120
}

const sanitize = (input: string) => input.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60)

const PIPELINE_VERSION = 'observability-v1'
const BUILD_COMMIT_SHA = '85b8cae'
const BUILD_TIMESTAMP = '2026-03-11T17:02:38+01:00'

const deriveProvenance = (payload: StoredPayload) => {
  const promotedSelector =
    payload.element?.targetFingerprint?.promotedStableSelector ||
    payload.element?.targetFingerprint?.promotedSelectedSelector ||
    payload.element?.selector
  const pickedSelector =
    payload.element?.targetFingerprint?.stableSelector ||
    payload.element?.targetFingerprint?.selectedSelector ||
    payload.element?.selectedSelector ||
    payload.element?.selector
  const artifactHasMaterializedRoot = /data-csnap-root="true"/i.test(payload.element?.html || '')
  const exportedRootSelector = artifactHasMaterializedRoot ? '[data-csnap-root="true"]' : promotedSelector
  const bootstrapRootSelector = artifactHasMaterializedRoot ? '[data-csnap-root="true"]' : promotedSelector
  const renderRootSelector = promotedSelector

  return {
    pickedSelector,
    promotedSelector,
    renderRootSelector,
    exportedRootSelector,
    bootstrapRootSelector,
  }
}

const deriveFrameState = (payload: StoredPayload, provenance: ReturnType<typeof deriveProvenance>) => {
  const targetClass = payload.exportDiagnostics?.targetClass
  if (targetClass !== 'render-scene') {
    return {
      status: 'frame-complete' as const,
      failureReason: undefined,
    }
  }

  const html = payload.element?.html || ''
  const hasSceneLeafOnly = /<cg-board\b/i.test(html) && !/(puzzle__board|cg-wrap|cg-container|data-csnap-root=)/i.test(html)
  const bootstrapMismatch = provenance.bootstrapRootSelector !== provenance.exportedRootSelector

  if (bootstrapMismatch) {
    return { status: 'frame-incomplete' as const, failureReason: 'bootstrap-root-mismatch' as const }
  }
  if (hasSceneLeafOnly) {
    return { status: 'frame-incomplete' as const, failureReason: 'leaf-without-frame' as const }
  }

  return {
    status: 'frame-complete' as const,
    failureReason: undefined,
  }
}

const toDataUrlFromText = (text: string, mimeType: string) => {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(text)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return `data:${mimeType};base64,${btoa(binary)}`
}

const cropDataUrl = async (imageDataUrl: string, clipRect: ClipRect) => {
  const response = await fetch(imageDataUrl)
  const blob = await response.blob()
  const bitmap = await createImageBitmap(blob)

  const sx = Math.max(0, Math.round(clipRect.x * clipRect.dpr))
  const sy = Math.max(0, Math.round(clipRect.y * clipRect.dpr))
  const sw = Math.max(1, Math.round(clipRect.width * clipRect.dpr))
  const sh = Math.max(1, Math.round(clipRect.height * clipRect.dpr))

  const boundedW = Math.min(sw, Math.max(1, bitmap.width - sx))
  const boundedH = Math.min(sh, Math.max(1, bitmap.height - sy))

  const canvas = new OffscreenCanvas(Math.max(1, boundedW), Math.max(1, boundedH))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.drawImage(bitmap, sx, sy, Math.max(1, boundedW), Math.max(1, boundedH), 0, 0, Math.max(1, boundedW), Math.max(1, boundedH))

  const croppedBlob = await canvas.convertToBlob({ type: 'image/png' })
  return await new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(String(reader.result ?? ''))
    reader.readAsDataURL(croppedBlob)
  })
}

const saveDataUrl = async (dataUrl: string, filename: string) => {
  await chrome.downloads.download({ url: dataUrl, filename, saveAs: false, conflictAction: 'uniquify' })
}

const isCaptureBundle = (value: unknown): value is CaptureBundleV0 => {
  if (!value || typeof value !== 'object') return false
  const capture = value as Partial<CaptureBundleV0>
  return capture.backend === 'cdp' && capture.version === '0' && typeof capture.seed === 'object'
}

const buildCaptureSeed = (
  requestId: string,
  tabId: number | undefined,
  payload: StoredPayload,
  clipRect?: ClipRect,
  actionTraceEvents?: ActionTraceEventV0[],
  mutationTraceEvents?: MutationTraceEventV0[],
): CaptureSeed => ({
  requestId,
  tabId,
  pageUrl: payload.url,
  pageTitle: payload.title,
  stableSelector:
    payload.element?.targetFingerprint?.promotedStableSelector ||
    payload.element?.targetFingerprint?.stableSelector ||
    payload.element?.selector,
  selectedSelector:
    payload.element?.targetFingerprint?.promotedSelectedSelector ||
    payload.element?.targetFingerprint?.selectedSelector ||
    payload.element?.selector,
  boundingBox: clipRect,
  elementHint: {
    tagName: payload.element?.tag,
    id: payload.element?.id,
    classList: payload.element?.classes,
    textPreview: payload.element?.text,
    kind: payload.element?.kind,
  },
  targetClassHint: payload.element?.targetFingerprint?.targetClassHint || payload.element?.targetClassHint,
  targetSubtypeHint: payload.element?.targetFingerprint?.targetSubtypeHint || payload.element?.targetSubtypeHint,
  targetClassReasons: payload.element?.targetFingerprint?.targetClassReasons || payload.element?.targetClassReasons,
  targetFingerprint: payload.element?.targetFingerprint,
  actionTraceEvents,
  mutationTraceEvents,
})

const saveSnapFiles = async (payload: StoredPayload) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  const tag = sanitize(payload.element?.tag || 'component')
  const folder = `component_snap/${timestamp}_${tag}`

  const portableHtml = payload.element?.html || '<!-- no html captured -->'
  const portableCss = payload.element?.css || '/* no css captured */'
  const freezeHtml = payload.element?.freezeHtml || portableHtml
  const js = payload.element?.js || "console.log('[component-snap] no js captured')"
  const fidelityExport = payload.exportDiagnostics?.fidelity
    ? buildFidelityExport(payload.exportDiagnostics.fidelity)
    : undefined
  const provenance = deriveProvenance(payload)
  const frame = deriveFrameState(payload, provenance)
  const metaPayload: StoredPayload = {
    ...payload,
    exportMode: payload.exportMode,
    exportTier: payload.exportTier || 'fallback',
    build: {
      commitSha: BUILD_COMMIT_SHA,
      timestamp: BUILD_TIMESTAMP,
      pipelineVersion: PIPELINE_VERSION,
    },
    provenance,
    frame,
    exportDiagnostics: {
      source: payload.exportDiagnostics?.source,
      targetClass: payload.exportDiagnostics?.targetClass,
      exportMode: payload.exportDiagnostics?.exportMode,
      warnings: payload.exportDiagnostics?.warnings || [],
      confidencePenalty: payload.exportDiagnostics?.confidencePenalty,
      confidence: payload.exportDiagnostics?.confidence,
      fidelity: payload.exportDiagnostics?.fidelity,
      cdpError: payload.exportDiagnostics?.cdpError,
    },
  }
  const meta = JSON.stringify(
    {
      ...metaPayload,
      fidelity: fidelityExport?.meta,
      reports: fidelityExport ? { fidelitySummary: './fidelity-report.txt' } : undefined,
    },
    null,
    2,
  )

  const htmlDoc = (htmlBody: string, cssPath: string, jsPath: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Component Snap Portable Fallback Preview</title>
    <link rel="stylesheet" href="${cssPath}" />
  </head>
  <body>
    <div id="component-snap-root">${htmlBody}</div>
    <script type="module" src="${jsPath}"></script>
  </body>
</html>`

  await saveDataUrl(toDataUrlFromText(htmlDoc(portableHtml, './component.css', './component.js'), 'text/html;charset=utf-8'), `${folder}/component.html`)
  await saveDataUrl(toDataUrlFromText(portableCss, 'text/css;charset=utf-8'), `${folder}/component.css`)
  await saveDataUrl(toDataUrlFromText(js, 'text/javascript;charset=utf-8'), `${folder}/component.js`)

  const freezeDoc = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Component Snap Freeze</title>
    <style>
      html, body { margin: 0; padding: 0; height: 100vh; display: flex; align-items: center; justify-content: center; background-color: #fff; }
      #freeze-root { display: inline-block; }
    </style>
  </head>
  <body>
    <div id="freeze-root">${freezeHtml}</div>
  </body>
</html>`
  await saveDataUrl(toDataUrlFromText(freezeDoc, 'text/html;charset=utf-8'), `${folder}/snapshot.html`)

  await saveDataUrl(toDataUrlFromText(meta, 'application/json;charset=utf-8'), `${folder}/meta.json`)
  if (fidelityExport) {
    await saveDataUrl(toDataUrlFromText(fidelityExport.report, 'text/plain;charset=utf-8'), `${folder}/fidelity-report.txt`)
  }

  if (payload.element?.screenshotDataUrl) {
    await saveDataUrl(payload.element.screenshotDataUrl, `${folder}/screenshot.png`)
  }

  return folder
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'REGISTER_ACTIVE_REQUEST') {
    activeRequests.set(message.requestId, message.tabId)
    log('register_active_request', 'info', message.requestId, `tabId: ${message.tabId}`)
    sendResponse({ ok: true })
    return true
  }

  if (message?.type === 'START_INSPECT_TAB') {
    const requestId = Math.random().toString(36).slice(2, 9)
    activeRequests.set(requestId, message.tabId)
    log('start_inspect_tab', 'info', requestId, `tabId: ${message.tabId}`)

    chrome.tabs.sendMessage(message.tabId, { type: 'START_INSPECT', requestId }, (response: any) => {
      if (chrome.runtime.lastError) {
        log('start_inspect_failed', 'error', requestId, chrome.runtime.lastError.message)
        sendResponse({ ok: false, error: chrome.runtime.lastError.message })
      } else {
        sendResponse({ ok: true, requestId, response })
      }
    })
    return true
  }

  if (message?.type === 'GET_LAST_SELECTION') {
    chrome.storage.local.get(['lastSelection'], (result) => {
      sendResponse({ ok: true, data: result.lastSelection })
    })
    return true
  }

  if (message?.type === 'GET_DEBUG_LOGS') {
    sendResponse({ ok: true, data: debugLog })
    return true
  }

  if (message?.type === 'FETCH_ASSET') {
    ;(async () => {
      try {
        const resp = await fetch(message.url)
        const blob = await resp.blob()
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result as string)
          reader.readAsDataURL(blob)
        })
        sendResponse({ ok: true, data: base64 })
      } catch (err) {
        sendResponse({ ok: false, error: String(err) })
      }
    })()
    return true
  }

  if (message?.type === 'ELEMENT_SELECTED') {
    ;(async () => {
      try {
        const tabId = activeRequests.get(message.requestId)

        const screenshot = await chrome.tabs.captureVisibleTab({ format: 'png' })
        const cropped = await cropDataUrl(screenshot, message.clipRect)
        if (cropped) message.payload.element.screenshotDataUrl = cropped

        let cdpCapture: unknown
        let cdpCaptureError: string | undefined
        if (tabId) {
          try {
            cdpCapture = await runCDPCapture(
              buildCaptureSeed(
                message.requestId,
                tabId,
                message.payload,
                message.clipRect,
                message.actionTraceEvents,
                message.mutationTraceEvents,
              ),
            )
            log('cdp_capture_done', 'info', message.requestId)
          } catch (error) {
            cdpCaptureError = String(error)
            log('cdp_capture_failed', 'error', message.requestId, cdpCaptureError)
          }
        }

        const fallbackWarnings = message.payload?.element?.portableFallback?.warnings || []
        const fallbackConfidencePenalty = message.payload?.element?.portableFallback?.confidencePenalty
        const fallbackConfidence = message.payload?.element?.portableFallback?.confidence
        const capsuleExtraction = extractPortableFromReplayCapsule(
          isCaptureBundle(cdpCapture) ? cdpCapture : undefined,
          message.payload?.element?.selector,
        )
        const fidelity = scoreCaptureFidelity({
          capture: isCaptureBundle(cdpCapture) ? cdpCapture : undefined,
          portableDiagnostics: capsuleExtraction.ok
            ? capsuleExtraction.diagnostics
            : {
                source: 'portable-fallback',
                targetClass: 'semantic-ui',
                exportMode: 'semantic-ui-portable',
                warnings: [...capsuleExtraction.warnings, ...fallbackWarnings],
                confidencePenalty: fallbackConfidencePenalty,
                confidence: fallbackConfidence,
              },
        })

        const enrichedPayload: StoredPayload = {
          ...message.payload,
          element: {
            ...message.payload?.element,
            ...(capsuleExtraction.ok
              ? {
                  html: capsuleExtraction.artifacts.html,
                  css: capsuleExtraction.artifacts.css,
                  freezeHtml: capsuleExtraction.artifacts.freezeHtml,
                  js: capsuleExtraction.artifacts.js,
                  selectedSelector: capsuleExtraction.artifacts.selectedSelector || message.payload?.element?.selectedSelector,
                }
              : {}),
          },
          cdpCapture,
          exportMode: capsuleExtraction.ok ? capsuleExtraction.diagnostics.exportMode : 'semantic-ui-portable',
          exportTier: capsuleExtraction.ok ? 'capsule' : 'fallback',
          exportDiagnostics: {
            source: capsuleExtraction.ok ? capsuleExtraction.diagnostics.source : 'portable-fallback',
            targetClass: capsuleExtraction.ok ? capsuleExtraction.diagnostics.targetClass : 'semantic-ui',
            exportMode: capsuleExtraction.ok ? capsuleExtraction.diagnostics.exportMode : 'semantic-ui-portable',
            warnings: capsuleExtraction.ok ? capsuleExtraction.diagnostics.warnings : [...capsuleExtraction.warnings, ...fallbackWarnings],
            confidencePenalty: capsuleExtraction.ok ? capsuleExtraction.diagnostics.confidencePenalty : fallbackConfidencePenalty,
            confidence: capsuleExtraction.ok ? capsuleExtraction.diagnostics.confidence : fallbackConfidence,
            fidelity,
            cdpError: cdpCaptureError,
          },
        }

        if (capsuleExtraction.ok) {
          log(
            'portable_capsule_export_used',
            'info',
            message.requestId,
            `${capsuleExtraction.diagnostics.warnings.join(', ')} | confidence=${capsuleExtraction.diagnostics.confidence.toFixed(2)}`,
          )
        } else if (enrichedPayload.exportDiagnostics?.warnings.length) {
          log(
            'portable_fallback_export_used',
            'info',
            message.requestId,
            `${capsuleExtraction.reason}; ${enrichedPayload.exportDiagnostics.warnings.join(', ')} | confidence=${String(enrichedPayload.exportDiagnostics.confidence ?? 'n/a')}`,
          )
        }

        const folder = await saveSnapFiles(enrichedPayload)
        
        await chrome.storage.local.clear()
        
        await chrome.storage.local.set({ 
          lastSelection: { 
            ...enrichedPayload, 
            snapFolder: folder, 
            requestId: message.requestId,
            snappedAt: new Date().toISOString()
          } 
        })

        log('capture_done', 'info', message.requestId)
        
        try {
          const tabId = activeRequests.get(message.requestId)
          if (tabId) {
            await chrome.tabs.sendMessage(tabId, { type: 'CAPTURE_DONE', requestId: message.requestId, folder })
            activeRequests.delete(message.requestId)
          }
        } catch {
          log('capture_done_no_listener', 'error', message.requestId)
        }
        
        sendResponse({ ok: true, folder, requestId: message.requestId })
      } catch (err) {
        log('capture_failed', 'error', message.requestId, String(err))
        sendResponse({ ok: false, error: String(err) })
      }
    })()
    return true
  }
})
