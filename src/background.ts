import { runCDPCapture } from './cdp/orchestrator'
import type { ActionTraceEventV0, CaptureSeed, MutationTraceEventV0 } from './cdp/types'
import type { TargetFingerprint } from './cdp/nodeMappingTypes'

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
    targetFingerprint?: TargetFingerprint
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

const log = (event: string, level: 'info' | 'error' = 'info', requestId?: string, detail?: string) => {
  console.log(`[${level}] ${event} ${requestId || ''}`, detail || '')
  debugLog.unshift({ at: new Date().toISOString(), level, event, requestId, detail })
  if (debugLog.length > 120) debugLog.length = 120
}

const sanitize = (input: string) => input.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60)

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
  stableSelector: payload.element?.targetFingerprint?.stableSelector || payload.element?.selector,
  selectedSelector: payload.element?.targetFingerprint?.selectedSelector || payload.element?.selector,
  boundingBox: clipRect,
  elementHint: {
    tagName: payload.element?.tag,
    id: payload.element?.id,
    classList: payload.element?.classes,
    textPreview: payload.element?.text,
    kind: payload.element?.kind,
  },
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
  const meta = JSON.stringify(payload, null, 2)

  const htmlDoc = (htmlBody: string, cssPath: string, jsPath: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Component Snap Preview</title>
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

  if (payload.element?.screenshotDataUrl) {
    await saveDataUrl(payload.element.screenshotDataUrl, `${folder}/screenshot.png`)
  }

  return folder
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
            log('cdp_capture_failed', 'error', message.requestId, String(error))
          }
        }

        const enrichedPayload = {
          ...message.payload,
          cdpCapture,
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
