import { describe, expect, it } from 'vitest'
import { PNG } from 'pngjs'

import { comparePixelDiff } from './pixelDiff'

const toPngDataUrl = (width: number, height: number, pixels: number[][]): string => {
  const png = new PNG({ width, height })

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (width * y + x) << 2
      const [r, g, b, a] = pixels[y * width + x]
      png.data[index] = r
      png.data[index + 1] = g
      png.data[index + 2] = b
      png.data[index + 3] = a
    }
  }

  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`
}

describe('comparePixelDiff', () => {
  it('returns zero mismatch for identical images', () => {
    const image = toPngDataUrl(2, 2, [
      [255, 0, 0, 255],
      [255, 0, 0, 255],
      [255, 0, 0, 255],
      [255, 0, 0, 255],
    ])

    const result = comparePixelDiff({ baselineImage: image, candidateImage: image })

    expect(result.mismatchPixels).toBe(0)
    expect(result.mismatchRatio).toBe(0)
    expect(result.dimensionsMatch).toBe(true)
    expect(result.comparedDimensions).toEqual({ width: 2, height: 2 })
  })

  it('reports mismatch metrics for changed pixels', () => {
    const baselineImage = toPngDataUrl(2, 2, [
      [255, 0, 0, 255],
      [255, 0, 0, 255],
      [255, 0, 0, 255],
      [255, 0, 0, 255],
    ])
    const candidateImage = toPngDataUrl(2, 2, [
      [255, 0, 0, 255],
      [0, 0, 255, 255],
      [255, 0, 0, 255],
      [255, 0, 0, 255],
    ])

    const result = comparePixelDiff({ baselineImage, candidateImage })

    expect(result.mismatchPixels).toBe(1)
    expect(result.mismatchRatio).toBe(0.25)
    expect(result.dimensionsMatch).toBe(true)
    expect(result.diffDataUrl.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('pads to the larger image when dimensions differ', () => {
    const baselineImage = toPngDataUrl(1, 1, [[255, 255, 255, 255]])
    const candidateImage = toPngDataUrl(2, 1, [
      [255, 255, 255, 255],
      [255, 255, 255, 255],
    ])

    const result = comparePixelDiff({ baselineImage, candidateImage })

    expect(result.dimensionsMatch).toBe(false)
    expect(result.baselineDimensions).toEqual({ width: 1, height: 1 })
    expect(result.candidateDimensions).toEqual({ width: 2, height: 1 })
    expect(result.comparedDimensions).toEqual({ width: 2, height: 1 })
    expect(result.mismatchPixels).toBe(1)
    expect(result.mismatchRatio).toBe(0.5)
  })
})
