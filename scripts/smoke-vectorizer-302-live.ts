// Exactly one real call. A saved receipt prevents accidental reruns with this small test budget.
import { mkdir, writeFile, access, readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { config } from '../server/config.ts'

const afterNetworkFix = process.argv.includes('--after-network-fix')
const afterSvgFix = process.argv.includes('--after-svg-fix')
if (afterSvgFix) {
  const previous = JSON.parse(await readFile('output/vectorizerai-live-20261014-network-fixed/report.json', 'utf8'))
  if (previous.status !== 'failed' || !String(previous.error).includes('SVG')) throw new Error('上次不是SVG兼容性问题，不追加调用')
}
if (afterNetworkFix) {
  const previous = JSON.parse(await readFile('output/vectorizerai-live-20261014/report.json', 'utf8'))
  if (previous.status !== 'failed' || previous.httpStatus !== 502 || !String(previous.error).includes('连接失败或超时')) throw new Error('上次结果不是连接故障，不再追加调用')
}
const output = path.resolve(afterSvgFix ? 'output/vectorizerai-live-20261014-svg-fixed' : afterNetworkFix ? 'output/vectorizerai-live-20261014-network-fixed' : 'output/vectorizerai-live-20261014')
const receipt = path.join(output, 'report.json')
if (config.vectorizerChannel !== '302' || config.vectorizerMode !== 'production' || !config.vectorizerEnabled || !config.vectorizer302ApiKey) throw new Error('302描摹配置尚未就绪')
await mkdir(output, { recursive: true })
try { await access(receipt); throw new Error('本轮真实测试已尝试过；为避免重复扣费，此脚本不再次调用') }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
const input = await sharp('D:/zcode1/ziheng-research/runtime-vectorize/compare-icons.png').extract({ left: 548, top: 18, width: 100, height: 102 }).png().toBuffer()
await writeFile(path.join(output, 'input-heart.png'), input)
const parameters = { 'output.draw_style': 'stroke_edges', 'processing.palette': '#11147d;#ffffff;', 'processing.max_colors': '2', 'output.group_by': 'parent' }
const report = { channel: '302', mode: 'production', plannedCalls: 1, automaticRetries: 0, indicativePricePtc: 0.3, parameters, startedAt: new Date().toISOString() }
await writeFile(receipt, JSON.stringify({ ...report, status: 'request-starting' }, null, 2), { flag: 'wx' })
const form = new FormData(); form.set('mask', new Blob([new Uint8Array(input)], { type: 'image/png' }), 'heart.png')
for (const [key, value] of Object.entries(parameters)) form.set(key, value)
const response = await fetch('http://127.0.0.1:8787/api/vectorize/high-quality', { method: 'POST', body: form, signal: AbortSignal.timeout(config.vectorizerTimeoutMs + 15000) })
const result = await response.json()
if (!response.ok) {
  await writeFile(receipt, JSON.stringify({ ...report, status: 'failed', httpStatus: response.status, error: result.error, completedAt: new Date().toISOString() }, null, 2))
  throw new Error(`HTTP ${response.status}: ${result.error}`)
}
await writeFile(path.join(output, 'result.svg'), result.svg)
await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2))
const downloaded = await fetch(`http://127.0.0.1:8787${result.url}`)
if (!downloaded.ok || await downloaded.text() !== result.svg) throw new Error('生成成功，但本站下载验证失败')
await sharp(Buffer.from(result.svg)).resize(600, 612).png().toFile(path.join(output, 'result-preview.png'))
await writeFile(receipt, JSON.stringify({ ...report, status: 'passed', pathCount: result.pathCount, width: result.width, height: result.height, chargedCredits: result.chargedCredits, downloadUrl: result.url, completedAt: new Date().toISOString() }, null, 2))
console.log(JSON.stringify({ status: 'passed', pathCount: result.pathCount, width: result.width, height: result.height, downloadUrl: result.url, chargedCredits: result.chargedCredits, automaticRetries: 0 }))
