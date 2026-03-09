import type { ReplayTimelineEventV0 } from './types'

const orderKind = (kind: ReplayTimelineEventV0['kind']) => (kind === 'action-trace' ? 0 : 1)

export const mergeReplayTimelineEvents = (
  actionEvents: ReplayTimelineEventV0[],
  mutationEvents: ReplayTimelineEventV0[],
): ReplayTimelineEventV0[] =>
  [...actionEvents, ...mutationEvents].sort((a, b) => {
    const byTime = a.atMs - b.atMs
    if (byTime !== 0) return byTime
    return orderKind(a.kind) - orderKind(b.kind)
  })
