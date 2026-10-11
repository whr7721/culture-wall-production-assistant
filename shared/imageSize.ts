export const standardImageSizes = {
  landscape: '1536x1024',
  square: '1024x1024',
  portrait: '1024x1536',
} as const

export type ImageAspect = keyof typeof standardImageSizes | 'custom'

// Physical dimensions stay in mm; only the ratio is used for the raster request.
export function imageSizeForWall(widthMm: number, heightMm: number): string | null {
  if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm) || widthMm <= 0 || heightMm <= 0 || widthMm > 100000 || heightMm > 100000) return null
  const ratio = widthMm / heightMm
  if (ratio > 3 || ratio < 1 / 3) return null
  let best: { size: string; score: number } | undefined
  for (let width = 512; width <= 2048; width += 16) {
    const height = Math.round(width / ratio / 16) * 16
    const size = validateCustomImageSize(width, height)
    if (!size || width * height > 2_000_000) continue
    const score = Math.abs(Math.log(width / height / ratio)) + 0.0001 * Math.abs(Math.log(width * height / 1_500_000))
    if (!best || score < best.score) best = { size, score }
  }
  return best?.size || null
}

// Conservative overlap for the currently configured image routes. A provider can
// still reject a custom size; the relay's gpt-image-2.5 alias is not an official model ID.
export function validateCustomImageSize(width: number, height: number): string | null {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null
  if (width < 512 || height < 512 || width > 2048 || height > 2048) return null
  if (width % 16 !== 0 || height % 16 !== 0) return null
  if (Math.max(width, height) / Math.min(width, height) > 3) return null
  const pixels = width * height
  if (pixels < 655_360 || pixels > 4_194_304) return null
  return `${width}x${height}`
}

export function resolveImageSize(aspect: string, customSize?: string): string | null {
  if (aspect !== 'custom') return standardImageSizes[aspect as keyof typeof standardImageSizes] || null
  const match = /^(\d{3,4})x(\d{3,4})$/.exec(customSize || '')
  if (!match) return null
  return validateCustomImageSize(Number(match[1]), Number(match[2]))
}
