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
  requireInvites: process.env.REQUIRE_INVITES === '1',
  invitesFile: process.env.INVITES_FILE || 'data/invites.json',
  usageFile: process.env.USAGE_FILE || 'data/usage.json',
  dailyGenerationLimit: readPositiveNumber('DAILY_GENERATION_LIMIT', 5),
  totalGenerationLimit: readPositiveNumber('TOTAL_GENERATION_LIMIT', 20),
  maxConcurrentGenerations: readPositiveNumber('MAX_CONCURRENT_GENERATIONS', 1),
  minGenerationIntervalMs: readPositiveNumber('MIN_GENERATION_INTERVAL_MS', 60_000),
  imageDownloadHosts: (process.env.IMAGE_DOWNLOAD_HOSTS || '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean),
  generatedDir: process.env.GENERATED_DIR || 'generated',
}
