import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const source = process.argv[2]
if (!source) {
  console.error('用法：tsx scripts/prepare-server-env.ts <已有中转站 JSON 配置路径>')
  process.exit(1)
}

const settings = JSON.parse(await readFile(path.resolve(source), 'utf8')) as Record<string, unknown>
const baseUrl = String(settings.base_url || '')
const key = String(settings.api_key || '')
if (!/^https:\/\/[^\s]+$/.test(baseUrl) || !key || /[\r\n]/.test(key)) {
  throw new Error('配置需包含有效的 HTTPS base_url 和 API Key')
}

const destination = path.resolve('data/deploy/culture-wall.env')
await mkdir(path.dirname(destination), { recursive: true })
const lines = [
  `IMAGE_API_BASE_URL=${baseUrl}`,
  `IMAGE_API_KEY=${key}`,
  'IMAGE_MODEL=gpt-image-2.5',
  'IMAGE_REQUEST_TIMEOUT_MS=300000',
  'PORT=8787',
  'REQUIRE_INVITES=1',
  'INVITES_FILE=/etc/culture-wall/invites.json',
  'USAGE_FILE=/var/lib/culture-wall/usage.json',
  'GENERATED_DIR=/var/lib/culture-wall/generated',
  'DAILY_GENERATION_LIMIT=5',
  'TOTAL_GENERATION_LIMIT=20',
  'MAX_CONCURRENT_GENERATIONS=1',
  'MIN_GENERATION_INTERVAL_MS=60000',
  'IMAGE_DOWNLOAD_HOSTS=',
]
await writeFile(destination, `${lines.join('\n')}\n`, { mode: 0o600 })
console.log(`服务器环境配置已生成：${destination}（内容不输出，且已被 Git 忽略）`)
