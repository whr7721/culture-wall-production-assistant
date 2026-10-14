import 'dotenv/config'

function readPositiveNumber(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}
function readNonNegativeNumber(name: string, fallback: number): number {
  if (process.env[name] === undefined || process.env[name] === '') return fallback
  const value = Number(process.env[name])
  // Invalid financial limits fail closed instead of silently enabling spending.
  return Number.isFinite(value) && value >= 0 ? value : 0
}

export const config = {
  kimiApiKey: process.env.KIMI_API_KEY || '',
  kimiModel: process.env.KIMI_MODEL || 'kimi-k2.5',
  kimiEnabled: process.env.KIMI_ENABLED === '1',
  kimiTimeoutMs: readPositiveNumber('KIMI_TIMEOUT_MS', 90_000),
  plannerDailyLimit: readPositiveNumber('PLANNER_DAILY_LIMIT', 5),
  plannerTotalLimit: readPositiveNumber('PLANNER_TOTAL_LIMIT', 20),
  plannerUsageFile: process.env.PLANNER_USAGE_FILE || 'data/planner-usage.json',
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
  vectorizerEnabled: process.env.VECTORIZER_AI_ENABLED === '1',
  vectorizerChannel: process.env.VECTORIZER_AI_CHANNEL || 'official',
  vectorizer302ApiKey: process.env.VECTORIZER_302_API_KEY || '',
  vectorizerUseEnvProxy: process.env.VECTORIZER_AI_USE_ENV_PROXY === '1',
  vectorizerApiId: process.env.VECTORIZER_AI_API_ID || '',
  vectorizerApiSecret: process.env.VECTORIZER_AI_API_SECRET || '',
  vectorizerEndpoint: process.env.VECTORIZER_AI_ENDPOINT || 'https://api.vectorizer.ai/api/v1/vectorize',
  vectorizerMode: process.env.VECTORIZER_AI_MODE || 'test',
  vectorizerTimeoutMs: readPositiveNumber('VECTORIZER_AI_TIMEOUT_MS', 90_000),
  vectorizerResultsDir: process.env.VECTORIZER_AI_RESULTS_DIR || 'data/vectorizer-results',
  vectorizerDailyLimit: readNonNegativeNumber('VECTORIZER_DAILY_LIMIT', 3),
  vectorizerDailyBudget: readNonNegativeNumber('VECTORIZER_DAILY_BUDGET', 0.9),
  vectorizerTotalBudget: readNonNegativeNumber('VECTORIZER_TOTAL_BUDGET', 1),
  vectorizer302CostPtc: readPositiveNumber('VECTORIZER_302_ESTIMATED_COST_PTC', 0.3),
  vectorizerMinIntervalMs: readNonNegativeNumber('VECTORIZER_MIN_INTERVAL_MS', 15000),
  vectorizerStorageBudgetMb: readPositiveNumber('VECTORIZER_STORAGE_BUDGET_MB', 1024),
  vectorizerMinFreeMb: readPositiveNumber('VECTORIZER_MIN_FREE_MB', 128),
}
