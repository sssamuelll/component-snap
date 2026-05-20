import { describe, expect, it, vi } from 'vitest'

import { buildDefines, resolveCommitSha } from './buildMetadata'

describe('resolveCommitSha', () => {
  it('returns the trimmed sha when git resolves a commit', () => {
    const exec = vi.fn().mockReturnValue('abc1234\n')
    expect(resolveCommitSha(exec)).toBe('abc1234')
    expect(exec).toHaveBeenCalledWith('git rev-parse --short HEAD')
  })

  it('returns "unknown" when the exec call throws (no git, not a repo, etc.)', () => {
    const exec = vi.fn(() => {
      throw new Error('not a git repository')
    })
    expect(resolveCommitSha(exec)).toBe('unknown')
  })

  it('returns "unknown" rather than an empty string when git outputs nothing', () => {
    expect(resolveCommitSha(() => '   \n')).toBe('unknown')
  })
})

describe('buildDefines', () => {
  it('JSON-stringifies metadata into a Vite-compatible define object', () => {
    expect(
      buildDefines({
        commitSha: 'abc1234',
        timestamp: '2026-05-20T12:00:00.000Z',
        pipelineVersion: '0.0.1',
      }),
    ).toEqual({
      __BUILD_COMMIT_SHA__: '"abc1234"',
      __BUILD_TIMESTAMP__: '"2026-05-20T12:00:00.000Z"',
      __PIPELINE_VERSION__: '"0.0.1"',
    })
  })

  it('still wraps "unknown" so the define is replaced as a string literal, not as an identifier', () => {
    const defines = buildDefines({ commitSha: 'unknown', timestamp: 'unknown', pipelineVersion: 'unknown' })
    expect(defines.__BUILD_COMMIT_SHA__).toBe('"unknown"')
    expect(defines.__BUILD_TIMESTAMP__).toBe('"unknown"')
    expect(defines.__PIPELINE_VERSION__).toBe('"unknown"')
  })
})
