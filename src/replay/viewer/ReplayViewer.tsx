import { useMemo, useState } from 'react'
import type { CaptureSeed, ReplayCapsuleV0 } from '../../cdp/types'
import { buildReplayViewerState, type ReplayViewerMode } from '../../cdp/replayViewerState'
import './ReplayViewer.css'

export interface ReplayViewerProps {
  replayCapsule: ReplayCapsuleV0
  captureSeed?: CaptureSeed
  initialMode?: ReplayViewerMode
  maxWidth?: number
}

const MODES: ReplayViewerMode[] = ['fit', 'spotlight', 'crop']

const formatNumber = (value: number | undefined) => (typeof value === 'number' ? value.toFixed(2) : 'n/a')

export const ReplayViewer = ({ replayCapsule, captureSeed, initialMode = 'spotlight', maxWidth = 320 }: ReplayViewerProps) => {
  const [mode, setMode] = useState<ReplayViewerMode>(initialMode)
  const viewerState = useMemo(
    () => buildReplayViewerState({ replayCapsule, captureSeed, mode }),
    [captureSeed, mode, replayCapsule],
  )

  const viewportWidth = replayCapsule.snapshot.page.viewport.width || maxWidth
  const scale = Math.min(1, maxWidth / Math.max(1, viewportWidth))

  const targetRect = viewerState.targetRectInImage
  const cropRect = mode === 'crop' && viewerState.imageSource === 'full' ? viewerState.cropRect : undefined

  const frameWidth = cropRect
    ? Math.max(1, Math.round(cropRect.width * scale))
    : Math.max(1, Math.round(viewportWidth * scale))
  const frameHeight = cropRect
    ? Math.max(1, Math.round(cropRect.height * scale))
    : Math.max(1, Math.round(replayCapsule.snapshot.page.viewport.height * scale))

  return (
    <section className="replay-viewer" data-testid="replay-viewer">
      <div className="replay-viewer-head">
        <h3>Replay viewer</h3>
        <small>{viewerState.createdAt}</small>
      </div>

      <div className="replay-viewer-controls" role="group" aria-label="Replay modes">
        {MODES.map((item) => (
          <button
            key={item}
            type="button"
            className={item === mode ? 'is-active' : ''}
            aria-pressed={item === mode}
            onClick={() => setMode(item)}
          >
            {item}
          </button>
        ))}
      </div>

      {!viewerState.imageSrc && <p className="replay-viewer-empty">No screenshot artifact available.</p>}

      {viewerState.imageSrc && (
        <div
          className={`replay-stage mode-${mode}`}
          style={{ width: frameWidth, height: frameHeight }}
          data-testid="replay-stage"
        >
          <img
            src={viewerState.imageSrc}
            alt="Replay snapshot"
            className="replay-image"
            data-testid="replay-image"
            style={
              cropRect
                ? {
                    width: Math.max(1, Math.round(viewportWidth * scale)),
                    transform: `translate(${-Math.round(cropRect.x * scale)}px, ${-Math.round(
                      cropRect.y * scale,
                    )}px)`,
                  }
                : { width: Math.max(1, Math.round(viewportWidth * scale)) }
            }
          />

          {mode === 'spotlight' && targetRect && (
            <div
              className="replay-spotlight"
              data-testid="replay-spotlight"
              style={{
                left: Math.round(targetRect.x * scale),
                top: Math.round(targetRect.y * scale),
                width: Math.max(1, Math.round(targetRect.width * scale)),
                height: Math.max(1, Math.round(targetRect.height * scale)),
              }}
            />
          )}
        </div>
      )}

      {viewerState.screenshotWarnings.length > 0 && (
        <ul className="replay-warnings" data-testid="replay-warnings">
          {viewerState.screenshotWarnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      <div className="replay-metadata" data-testid="replay-metadata">
        <small>
          <strong>page:</strong> {viewerState.pageTitle || 'Untitled'}
        </small>
        <small>
          <strong>url:</strong> {viewerState.pageUrl}
        </small>
        <small>
          <strong>image:</strong> {viewerState.imageSource}
        </small>
        <small>
          <strong>events:</strong> {viewerState.debug.timelineEventCount}
        </small>
        <small>
          <strong>mapping:</strong> {viewerState.debug.mappingStrategy || 'n/a'} ({formatNumber(viewerState.debug.mappingConfidence)})
        </small>
        {viewerState.debug.missingArtifacts.length > 0 && (
          <small>
            <strong>missing:</strong> {viewerState.debug.missingArtifacts.join(', ')}
          </small>
        )}
      </div>
    </section>
  )
}

export default ReplayViewer
