import 'dotenv/config'

function readPositiveNumber(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export const config = {
  port: readPositiveNumber('PORT', 8787),
  imageApiBaseUrl: (process.env.IMAGE_API_BASE_URL || 'https://api.itoo.me').replace(/\/$/, ''),
  imageApiKey: process.env.IMAGE_API_KEY || '',
  imageModel: process.env.IMAGE_MODEL || 'gpt-image-2.5',
  requestTimeoutMs: readPositiveNumber('IMAGE_REQUEST_TIMEOUT_MS', 300_000),
}
