import type { CaptureSeed, ReplayCapsuleV0 } from './types'

export type ReplayViewerMode = 'fit' | 'spotlight' | 'crop'

type ViewerRect = {
  x: number
  y: number
  width: number
  height: number
}

export interface ReplayViewerState {
  mode: ReplayViewerMode
  imageSrc?: string
  imageSource: 'clip' | 'full' | 'none'
  pageTitle: string
  pageUrl: string
  createdAt: string
  targetRect?: ViewerRect
  targetRectInImage?: ViewerRect
  cropRect?: ViewerRect
  screenshotWarnings: string[]
  debug: {
    timelineEventCount: number
    missingArtifacts: string[]
    mappingStrategy?: string
    mappingConfidence?: number
  }
}

export interface BuildReplayViewerStateInput {
  replayCapsule: ReplayCapsuleV0
  mode: ReplayViewerMode
  captureSeed?: CaptureSeed
}

const toRect = (value?: { x: number; y: number; width: number; height: number } | null): ViewerRect | undefined => {
  if (!value) return undefined
  const width = Number.isFinite(value.width) ? value.width : 0
  const height = Number.isFinite(value.height) ? value.height : 0
  if (width <= 0 || height <= 0) return undefined

  return {
    x: Number.isFinite(value.x) ? value.x : 0,
    y: Number.isFinite(value.y) ? value.y : 0,
    width,
    height,
  }
}

export const buildReplayViewerState = (input: BuildReplayViewerStateInput): ReplayViewerState => {
  const { replayCapsule, mode, captureSeed } = input
  const screenshot = replayCapsule.snapshot.screenshot
  const diagnostics = replayCapsule.diagnostics

  const clipRect = toRect(screenshot.clipRect)
  const seedRect = toRect(captureSeed?.boundingBox)
  const targetRect = clipRect || seedRect

  const imageSrc = screenshot.clipDataUrl || screenshot.fullPageDataUrl
  const imageSource: ReplayViewerState['imageSource'] = screenshot.clipDataUrl
    ? 'clip'
    : screenshot.fullPageDataUrl
      ? 'full'
      : 'none'

  const screenshotWarnings: string[] = []
  if (!imageSrc) screenshotWarnings.push('No screenshot available in replay capsule.')
  if (imageSource === 'full' && !targetRect) {
    screenshotWarnings.push('Target crop unavailable: missing clipRect/boundingBox.')
  }
  if (mode === 'spotlight' && imageSource === 'clip' && !screenshot.fullPageDataUrl) {
    screenshotWarnings.push('Spotlight context limited: only clipped screenshot is available.')
  }
  if (mode === 'crop' && imageSource === 'full' && !targetRect) {
    screenshotWarnings.push('Crop mode needs clipRect/boundingBox; showing full screenshot instead.')
  }

  return {
    mode,
    imageSrc,
    imageSource,
    pageTitle: replayCapsule.snapshot.page.title,
    pageUrl: replayCapsule.snapshot.page.url,
    createdAt: replayCapsule.createdAt,
    targetRect,
    targetRectInImage:
      imageSource === 'clip' && targetRect
        ? { x: 0, y: 0, width: targetRect.width, height: targetRect.height }
        : targetRect,
    cropRect: targetRect,
    screenshotWarnings,
    debug: {
      timelineEventCount: replayCapsule.timeline.events.length,
      missingArtifacts: diagnostics?.missingArtifacts || [],
      mappingStrategy: replayCapsule.snapshot.nodeMapping?.strategy,
      mappingConfidence: replayCapsule.snapshot.nodeMapping?.confidence,
    },
  }
}
