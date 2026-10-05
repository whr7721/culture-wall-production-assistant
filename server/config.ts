import 'dotenv/config'

function readPositiveNumber(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export const config = {
  port: readPositiveNumber('PORT', 8787),
  imageProvider: process.env.IMAGE_PROVIDER === 'alibaba' ? 'alibaba' as const : 'relay' as const,
  imageApiBaseUrl: (process.env.IMAGE_API_BASE_URL || 'https://api.itoo.me').replace(/\/$/, ''),
  imageApiKey: process.env.IMAGE_API_KEY || '',
  imageModel: process.env.IMAGE_MODEL || 'gpt-image-2.5',
  alibabaBaseUrl: (process.env.ALIBABA_IMAGE_BASE_URL || '').replace(/\/$/, ''),
  alibabaApiKey: process.env.ALIBABA_IMAGE_API_KEY || '',
  alibabaModel: process.env.ALIBABA_IMAGE_MODEL || 'qwen-image-3.0',
  alibabaDownloadHosts: (process.env.ALIBABA_IMAGE_DOWNLOAD_HOSTS || 'dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean),
  kamiBaseUrl: (process.env.KAMI_IMAGE_BASE_URL || 'https://www.kamiapi.top').replace(/\/$/, ''),
  kamiApiKey: process.env.KAMI_IMAGE_API_KEY || '',
  kamiBananaModel: process.env.KAMI_BANANA_MODEL || 'gemini-3.1-flash-image-preview',
  kamiBanana4kModel: process.env.KAMI_BANANA_4K_MODEL || 'gemini-3-pro-image-preview',
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
  projectsDir: process.env.PROJECTS_DIR || 'data/projects',
}
