import type { RuntimeEnvironmentCapture } from './types'
import { RuntimeCaptureError } from './errors'
import type { CDPClient } from './client'

type RuntimeEvalResult = {
  result?: {
    value?: RuntimeEnvironmentCapture
  }
}

export const captureRuntimeEnvironment = async (client: CDPClient): Promise<RuntimeEnvironmentCapture> => {
  const expression = `(() => ({
    url: location.href,
    title: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    scroll: { x: window.scrollX, y: window.scrollY },
    dpr: window.devicePixelRatio || 1,
    userAgent: navigator.userAgent,
    colorScheme: (getComputedStyle(document.documentElement).colorScheme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') || 'unknown'),
    language: document.documentElement.lang || navigator.language || undefined,
    runtimeHints: {
      shadowDomPresent: !!document.querySelector('*') && Array.from(document.querySelectorAll('*')).some(el => !!el.shadowRoot),
      iframePresent: document.querySelectorAll('iframe').length > 0,
      canvasPresent: document.querySelectorAll('canvas').length > 0,
      webglPresent: Array.from(document.querySelectorAll('canvas')).some(c => !!c.getContext('webgl') || !!c.getContext('webgl2')),
    },
  }))()`

  const response = await client.send<RuntimeEvalResult>('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: false,
  })

  const value = response.result?.value
  if (!value) throw new RuntimeCaptureError('Runtime.evaluate returned no capture payload')
  return value
}
