import type { CDPClient } from './client'

type DomSnapshotDocument = { nodes?: { parentIndex?: unknown[] } }

type DOMSnapshotResponse = {
  documents?: DomSnapshotDocument[]
  strings?: string[]
}

export const captureDomSnapshot = async (client: CDPClient) => {
  const raw = await client.send<DOMSnapshotResponse>('DOMSnapshot.captureSnapshot', {
    computedStyles: [],
    includePaintOrder: true,
    includeDOMRects: true,
  })

  const firstDoc = raw.documents?.[0]
  const nodeCount = Array.isArray(firstDoc?.nodes?.parentIndex)
    ? firstDoc.nodes.parentIndex.length
    : 0

  return {
    raw,
    stats: {
      documents: raw.documents?.length ?? 0,
      nodes: nodeCount,
    },
  }
}
