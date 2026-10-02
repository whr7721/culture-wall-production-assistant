import { describe, expect, it } from 'vitest'
import { isSupportedImage } from './imageValidation.ts'

describe('image signature validation', () => {
  it('accepts png, jpeg and webp signatures', () => {
    expect(isSupportedImage(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]))).toBe(true)
    expect(isSupportedImage(Buffer.from([255, 216, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(true)
    expect(isSupportedImage(Buffer.from('RIFF....WEBP', 'ascii'))).toBe(true)
  })

  it('rejects text pretending to be an image', () => {
    expect(isSupportedImage(Buffer.from('not an image', 'utf8'))).toBe(false)
  })
})
