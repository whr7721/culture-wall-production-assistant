export function detectedImageMime(buffer: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (buffer.length < 12) return null
  const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  const webp = buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
  return png ? 'image/png' : jpeg ? 'image/jpeg' : webp ? 'image/webp' : null
}

export function isSupportedImage(buffer: Buffer): boolean {
  return detectedImageMime(buffer) !== null
}
