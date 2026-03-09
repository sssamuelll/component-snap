import { describe, expect, it } from 'vitest'
import { mergeReplayTimelineEvents } from './replayTimeline'
import type { ReplayTimelineEventV0 } from './types'

describe('mergeReplayTimelineEvents', () => {
  it('merges action and mutation events in timeline order', () => {
    const actionEvents: ReplayTimelineEventV0[] = [
      {
        kind: 'action-trace',
        atMs: 15,
        label: 'Input',
        action: { type: 'input', atMs: 15, selector: 'input.name', tagName: 'input', value: 'sam' },
      },
      {
        kind: 'action-trace',
        atMs: 35,
        label: 'Click',
        action: { type: 'click', atMs: 35, selector: '.save', tagName: 'button' },
      },
    ]

    const mutationEvents: ReplayTimelineEventV0[] = [
      {
        kind: 'mutation',
        atMs: 15,
        label: 'Mutation (input sync)',
        mutation: { type: 'attributes', atMs: 15, attributeName: 'value', selector: 'input.name', tagName: 'input' },
      },
      {
        kind: 'mutation',
        atMs: 22,
        label: 'Mutation (content)',
        mutation: { type: 'characterData', atMs: 22, selector: '.preview', tagName: 'div', valuePreview: 'sam' },
      },
    ]

    expect(mergeReplayTimelineEvents(actionEvents, mutationEvents)).toEqual([
      actionEvents[0],
      mutationEvents[0],
      mutationEvents[1],
      actionEvents[1],
    ])
  })
})
