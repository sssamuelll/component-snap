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
    js?: string
    kind?: string
    screenshotDataUrl?: string
  }
}

const log = (event: string, level: 'info' | 'error' = 'info', requestId?: string, detail?: string) => {
  console.log(`[${level}] ${event} ${requestId || ''}`, detail || '')
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
  if (message?.type === 'ELEMENT_SELECTED') {
    ;(async () => {
      try {
        const screenshot = await chrome.tabs.captureVisibleTab({ format: 'png' })
        const cropped = await cropDataUrl(screenshot, message.clipRect)
        if (cropped) message.payload.element.screenshotDataUrl = cropped

        const folder = await saveSnapFiles(message.payload)
        
        // CRITICAL FIX: Clear old storage to prevent quota errors
        await chrome.storage.local.clear()
        
        // Store metadata + folder, but keep payload for repro scripts (optional reduction here if needed)
        await chrome.storage.local.set({ 
          lastSelection: { 
            ...message.payload, 
            snapFolder: folder, 
            requestId: message.requestId,
            snappedAt: new Date().toISOString()
          } 
        })

        log('capture_done', 'info', message.requestId)
        
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
          if (tab.id) await chrome.tabs.sendMessage(tab.id, { type: 'CAPTURE_DONE', requestId: message.requestId, folder })
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
