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
  element?: {
    tag?: string
    id?: string
    classes?: string[]
    text?: string
    selector?: string
    html?: string
    css?: string
    freezeHtml?: string
    rawHtml?: string
    rawCss?: string
    js?: string
    kind?: string
    screenshotDataUrl?: string
  }
}

type DebugEvent = {
  at: string
  level: 'info' | 'error'
  requestId?: string
  event: string
  detail?: string
}

type RuntimeMessage =
  | { type: 'PING' }
  | { type: 'GET_LAST_SELECTION' }
  | { type: 'GET_DEBUG_LOGS' }
  | { type: 'START_INSPECT_TAB'; tabId: number }
  | { type: 'ELEMENT_SELECTED'; requestId: string; payload: StoredPayload; clipRect?: ClipRect }

const activeRequests = new Map<string, number>()
const debugLog: DebugEvent[] = []

const log = (event: string, level: 'info' | 'error' = 'info', requestId?: string, detail?: string) => {
  debugLog.unshift({ at: new Date().toISOString(), level, event, requestId, detail })
  if (debugLog.length > 120) debugLog.length = 120
}

const sanitize = (input: string) => input.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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

const saveSnapFiles = async (payload: StoredPayload) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  const tag = sanitize(payload.element?.tag || 'component')
  const folder = `component_snap/${timestamp}_${tag}`

  const portableHtml = payload.element?.html || '<!-- no html captured -->'
  const portableCss = payload.element?.css || '/* no css captured */'
  const freezeHtml = payload.element?.freezeHtml || portableHtml
  const rawComponentHtml = payload.element?.rawHtml || portableHtml
  const rawCss = payload.element?.rawCss || portableCss
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

  await saveDataUrl(toDataUrlFromText(htmlDoc(portableHtml, './component.css', './component.js'), 'text/html;charset=utf-8'), `${folder}/portable/component.html`)
  await saveDataUrl(toDataUrlFromText(portableCss, 'text/css;charset=utf-8'), `${folder}/portable/component.css`)
  await saveDataUrl(toDataUrlFromText(js, 'text/javascript;charset=utf-8'), `${folder}/portable/component.js`)

  const freezeDoc = `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Component Snap Freeze</title></head>
  <body style="margin:0;padding:0;display:inline-block;">${freezeHtml}</body>
</html>`
  await saveDataUrl(toDataUrlFromText(freezeDoc, 'text/html;charset=utf-8'), `${folder}/portable/snapshot.html`)

  await saveDataUrl(toDataUrlFromText(htmlDoc(rawComponentHtml, './component.css', './component.js'), 'text/html;charset=utf-8'), `${folder}/raw/component.html`)
  await saveDataUrl(toDataUrlFromText(rawCss, 'text/css;charset=utf-8'), `${folder}/raw/component.css`)
  await saveDataUrl(toDataUrlFromText(js, 'text/javascript;charset=utf-8'), `${folder}/raw/component.js`)

  await saveDataUrl(toDataUrlFromText(meta, 'application/json;charset=utf-8'), `${folder}/meta.json`)

  if (payload.element?.screenshotDataUrl) {
    await saveDataUrl(payload.element.screenshotDataUrl, `${folder}/screenshot.png`)
  }

  return folder
}

const startInspectWithRetry = async (tabId: number, requestId: string) => {
  const attempts = [0, 120, 260]
  let lastError = 'unknown'

  for (let i = 0; i < attempts.length; i++) {
    if (attempts[i] > 0) await sleep(attempts[i])

    try {
      await chrome.tabs.sendMessage(tabId, { type: 'START_INSPECT', requestId })
      return true
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      log('start_inspect_attempt_failed', 'error', requestId, `attempt=${i + 1} ${lastError}`)
    }
  }

  return { ok: false, error: lastError }
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  if (message?.type === 'PING') {
    sendResponse({ ok: true, from: 'background' })
    return
  }

  if (message?.type === 'GET_DEBUG_LOGS') {
    sendResponse({ ok: true, data: debugLog })
    return
  }

  if (message?.type === 'GET_LAST_SELECTION') {
    chrome.storage.local.get(['lastSelection'], (result) => {
      sendResponse({ ok: true, data: result.lastSelection ?? null })
    })
    return true
  }

  if (message?.type === 'START_INSPECT_TAB') {
    ;(async () => {
      const requestId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      activeRequests.set(requestId, message.tabId)
      log('start_inspect_requested', 'info', requestId, `tabId=${message.tabId}`)

      const started = await startInspectWithRetry(message.tabId, requestId)
      if (started === true) {
        log('start_inspect_ack', 'info', requestId)
        sendResponse({ ok: true, requestId })
      } else {
        activeRequests.delete(requestId)
        log('start_inspect_failed', 'error', requestId, started.error)
        sendResponse({ ok: false, requestId, error: started.error })
      }
    })()
    return true
  }

  if (message?.type === 'ELEMENT_SELECTED') {
    ;(async () => {
      const tabId = activeRequests.get(message.requestId) ?? sender.tab?.id
      if (!tabId) {
        log('element_selected_rejected', 'error', message.requestId, 'no tabId')
        sendResponse({ ok: false, error: 'No tab id for request' })
        return
      }

      log('element_selected', 'info', message.requestId)

      let payload: StoredPayload = {
        ...message.payload,
        requestId: message.requestId,
        snappedAt: new Date().toISOString(),
      }

      if (message.clipRect) {
        try {
          const screenshot = await chrome.tabs.captureVisibleTab({ format: 'png' })
          const cropped = await cropDataUrl(screenshot, message.clipRect)
          if (cropped) {
            payload = { ...payload, element: { ...payload.element, screenshotDataUrl: cropped } }
            log('screenshot_captured', 'info', message.requestId)
          }
        } catch (err) {
          log('screenshot_failed', 'error', message.requestId, err instanceof Error ? err.message : String(err))
        }
      }

      let folder = ''
      try {
        folder = await saveSnapFiles(payload)
        log('files_saved', 'info', message.requestId, folder)
      } catch (err) {
        folder = 'component_snap/unsaved'
        log('files_save_failed', 'error', message.requestId, err instanceof Error ? err.message : String(err))
      }

      const finalPayload = { ...payload, snapFolder: folder }
      chrome.storage.local.set({ lastSelection: finalPayload }, async () => {
        activeRequests.delete(message.requestId)
        try {
          await chrome.tabs.sendMessage(tabId, { type: 'CAPTURE_DONE', requestId: message.requestId, folder })
          log('capture_done_ack', 'info', message.requestId)
        } catch {
          log('capture_done_no_listener', 'error', message.requestId)
        }
        sendResponse({ ok: true, folder, requestId: message.requestId })
      })
    })()
    return true
  }
})
