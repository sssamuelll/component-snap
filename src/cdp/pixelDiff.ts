import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

import type { PixelDiffMetricsV0 } from './types'

export interface ComparePixelDiffInput {
  baselineImage: Buffer | string
  candidateImage: Buffer | string
  threshold?: number
}

export interface ComparePixelDiffResult extends PixelDiffMetricsV0 {
  diffPngBuffer: Buffer
  diffDataUrl: string
}

const PNG_DATA_URL_PREFIX = 'data:image/png;base64,'

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))

const toPngBuffer = (value: Buffer | string): Buffer => {
  if (Buffer.isBuffer(value)) return value
  if (!value.startsWith(PNG_DATA_URL_PREFIX)) {
    throw new Error('Pixel diff currently supports PNG buffers or PNG data URLs only.')
  }

  return Buffer.from(value.slice(PNG_DATA_URL_PREFIX.length), 'base64')
}

const padImageToSize = (
  image: { data: Buffer; width: number; height: number },
  size: { width: number; height: number },
) => {
  if (image.width === size.width && image.height === size.height) return image

  const padded = new PNG({ width: size.width, height: size.height })
  image.data.copy(padded.data, 0, 0, image.data.length)
  return padded
}

export const comparePixelDiff = (input: ComparePixelDiffInput): ComparePixelDiffResult => {
  const baseline = PNG.sync.read(toPngBuffer(input.baselineImage))
  const candidate = PNG.sync.read(toPngBuffer(input.candidateImage))
  const comparedDimensions = {
    width: Math.max(baseline.width, candidate.width),
    height: Math.max(baseline.height, candidate.height),
  }
  const diff = new PNG(comparedDimensions)
  const mismatchPixels = pixelmatch(
    padImageToSize(baseline, comparedDimensions).data,
    padImageToSize(candidate, comparedDimensions).data,
    diff.data,
    comparedDimensions.width,
    comparedDimensions.height,
    { threshold: input.threshold ?? 0.1 },
  )
  const totalPixels = comparedDimensions.width * comparedDimensions.height
  const diffPngBuffer = PNG.sync.write(diff)

  return {
    mismatchPixels,
    mismatchRatio: totalPixels > 0 ? clamp(mismatchPixels / totalPixels) : 0,
    dimensionsMatch: baseline.width === candidate.width && baseline.height === candidate.height,
    comparedDimensions: {
      width: comparedDimensions.width,
      height: comparedDimensions.height,
    },
    baselineDimensions: { width: baseline.width, height: baseline.height },
    candidateDimensions: { width: candidate.width, height: candidate.height },
    diffPngBuffer,
    diffDataUrl: `${PNG_DATA_URL_PREFIX}${diffPngBuffer.toString('base64')}`,
  }
}
