import { useState } from 'react'
import type { CaptureBundleV0 } from './cdp/types'
import ReplayViewer from './replay/viewer/ReplayViewer'
import './App.css'

type SnapData = {
  title: string
  url: string
  selection: string
  snapFolder?: string
  exportMode?: string
  exportTier?: string
  exportDiagnostics?: {
    warnings?: string[]
    confidencePenalty?: number
    confidence?: number
  }
  cdpCapture?: CaptureBundleV0
  element?: {
    tag: string
    id: string
    classes: string[]
    text: string
    selector: string
    kind?: string
    screenshotDataUrl?: string
    portableFallback?: {
      tier: 'portable-fallback'
      confidence: number
      confidencePenalty: number
      warnings: string[]
    }
  }
}

type DebugEvent = {
  at: string
  level: 'info' | 'error'
  requestId?: string
  event: string
  detail?: string
}

function App() {
  const [status, setStatus] = useState('Ready')
  const [snap, setSnap] = useState<SnapData | null>(null)
  const [debug, setDebug] = useState<DebugEvent[]>([])

  const getActiveTab = async () => {
    const tabs = await chrome.tabs.query({ lastFocusedWindow: true })

    const normalActive = tabs.find(
      (tab) => tab.active && tab.id && tab.url && !tab.url.startsWith('chrome-extension://'),
    )

    if (normalActive) return normalActive

    return tabs.find((tab) => tab.id && tab.url && !tab.url.startsWith('chrome-extension://'))
  }

  const startInspector = async () => {
    const tab = await getActiveTab()
    if (!tab?.id) {
      setStatus('No active tab found')
      return
    }

    try {
      const result = await chrome.runtime.sendMessage({ type: 'START_INSPECT_TAB', tabId: tab.id })
      if (!result?.ok) throw new Error('start failed')
      setStatus(`Picker active [${result.requestId}]. Hover + click element. ESC cancels.`)
    } catch {
      setStatus('Refresh target page and retry')
    }
  }

  const loadLastSnap = async () => {
    const response = await chrome.runtime.sendMessage({ type: 'GET_LAST_SELECTION' })
    if (response?.ok && response?.data) {
      setSnap(response.data as SnapData)
      setStatus('Loaded last snap')
    } else {
      setStatus('No snap captured yet')
    }
  }

  const loadDebug = async () => {
    const response = await chrome.runtime.sendMessage({ type: 'GET_DEBUG_LOGS' })
    if (response?.ok) setDebug((response.data as DebugEvent[]) || [])
  }

  return (
    <main className="popup">
      <header>
        <h1>Component Snap</h1>
        <p>DevTools-style picker with interaction lock + screenshot crop.</p>
      </header>

      <div className="actions">
        <button onClick={startInspector}>Start picker</button>
        <button onClick={loadLastSnap} className="secondary">
          Load last snap
        </button>
        <button onClick={loadDebug} className="secondary">
          Debug log
        </button>
      </div>

      <small>{status}</small>

      {snap && (
        <section>
          <h2>{snap.title || 'Untitled page'}</h2>
          <a href={snap.url} target="_blank" rel="noreferrer">
            {snap.url}
          </a>

          {snap.snapFolder && <small>Saved in Downloads/{snap.snapFolder}</small>}

          {snap.element && (
            <ul>
              <li>
                <strong>tag:</strong> {snap.element.tag}
              </li>
              <li>
                <strong>id:</strong> {snap.element.id || '(none)'}
              </li>
              <li>
                <strong>classes:</strong> {snap.element.classes.join(' ') || '(none)'}
              </li>
              <li>
                <strong>selector:</strong> {snap.element.selector}
              </li>
              <li>
                <strong>kind:</strong> {snap.element.kind || 'unknown'}
              </li>
              {snap.element.portableFallback && (
                <>
                  <li>
                    <strong>portable tier:</strong> {snap.element.portableFallback.tier} (lower-tier fallback)
                  </li>
                  <li>
                    <strong>portable confidence:</strong> {snap.element.portableFallback.confidence.toFixed(2)} (penalty{' '}
                    {snap.element.portableFallback.confidencePenalty.toFixed(2)})
                  </li>
                </>
              )}
            </ul>
          )}

          {snap.element?.screenshotDataUrl && (
            <img src={snap.element.screenshotDataUrl} alt="Captured component" className="snap-image" />
          )}

          <pre>{snap.element?.text || snap.selection || 'No text found.'}</pre>

          {snap.cdpCapture?.replayCapsule && (
            <ReplayViewer replayCapsule={snap.cdpCapture.replayCapsule} captureSeed={snap.cdpCapture.seed} />
          )}
        </section>
      )}

      {debug.length > 0 && (
        <section>
          <h2>Debug</h2>
          <pre>
            {debug
              .slice(0, 12)
              .map((d) => `${d.at} [${d.level}] ${d.requestId || '-'} ${d.event}${d.detail ? ` - ${d.detail}` : ''}`)
              .join('\n')}
          </pre>
        </section>
      )}
    </main>
  )
}

export default App
