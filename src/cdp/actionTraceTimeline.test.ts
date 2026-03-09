import { describe, expect, it } from 'vitest'
import { buildActionTraceTimelineEvents } from './actionTraceTimeline'

describe('buildActionTraceTimelineEvents', () => {
  it('maps action traces to replay timeline events, sorted by time', () => {
    const events = buildActionTraceTimelineEvents([
      { type: 'click', atMs: 50.3, selector: '.btn', tagName: 'button' },
      { type: 'keyboard', atMs: 9.8, key: 'Enter', code: 'Enter' },
    ])

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      kind: 'action-trace',
      atMs: 10,
      label: 'Keyboard',
      action: { type: 'keyboard', atMs: 10, key: 'Enter', code: 'Enter' },
    })
    expect(events[1]).toMatchObject({
      kind: 'action-trace',
      atMs: 50,
      label: 'Click',
      action: { type: 'click', atMs: 50, selector: '.btn', tagName: 'button' },
    })
  })

  it('returns empty list for empty input', () => {
    expect(buildActionTraceTimelineEvents()).toEqual([])
    expect(buildActionTraceTimelineEvents([])).toEqual([])
  })
})
