import { describe, expect, it } from 'vitest'
import { scoreToConfidence } from './nodeResolverRuntime'

describe('scoreToConfidence', () => {
  it('clamps to minimum floor', () => {
    expect(scoreToConfidence({ score: 0, scoreDelta: 0, penaltyPoints: 0, ambiguousCount: 1 })).toBeGreaterThanOrEqual(0.05)
  })

  it('increases with higher score', () => {
    expect(scoreToConfidence({ score: 110, scoreDelta: 20, penaltyPoints: 0, ambiguousCount: 1 })).toBeGreaterThan(
      scoreToConfidence({ score: 35, scoreDelta: 4, penaltyPoints: 0, ambiguousCount: 1 }),
    )
  })

  it('penalizes ambiguity and drift', () => {
    expect(scoreToConfidence({ score: 90, scoreDelta: 9, penaltyPoints: 14, ambiguousCount: 3 })).toBeLessThan(
      scoreToConfidence({ score: 90, scoreDelta: 18, penaltyPoints: 0, ambiguousCount: 1 }),
    )
  })
})
