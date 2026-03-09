import type { CDPClient } from './client'

type DOMSnapshotResponse = {
  documents?: unknown[]
  strings?: string[]
}

export const captureDomSnapshot = async (client: CDPClient) => {
  const raw = await client.send<DOMSnapshotResponse>('DOMSnapshot.captureSnapshot', {
    computedStyles: [],
    includePaintOrder: true,
    includeDOMRects: true,
  })

  return {
    raw,
    stats: {
      documents: raw.documents?.length ?? 0,
      nodes: raw.strings?.length ?? 0,
    },
  }
}
