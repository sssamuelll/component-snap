import type { CDPClient } from './client'
import type { CaptureBoundingBox } from './types'

const toDataUrl = (base64: string) => `data:image/png;base64,${base64}`

type CaptureScreenshotResponse = { data: string }

export const captureScreenshots = async (client: CDPClient, clipRect?: CaptureBoundingBox) => {
  const full = await client.send<CaptureScreenshotResponse>('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
  })

  let clipDataUrl: string | undefined
  if (clipRect) {
    const clip = await client.send<CaptureScreenshotResponse>('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      clip: {
        x: clipRect.x,
        y: clipRect.y,
        width: Math.max(1, clipRect.width),
        height: Math.max(1, clipRect.height),
        scale: 1,
      },
    })
    clipDataUrl = toDataUrl(clip.data)
  }

  return {
    fullPageDataUrl: toDataUrl(full.data),
    clipDataUrl,
    clipRect,
  }
}
