import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
if (process.env.ALLOW_PAID_IMAGE_TEST !== '1') throw new Error('需明确批准一次付费生图测试')
const directory = 'output/2026-10-11-flow'
await mkdir(directory, { recursive: true })
const cache = `${directory}/generation.json`
if (existsSync(cache)) { console.log('已有真实生成记录，不重复付费。'); process.exit(0) }
const plan = JSON.parse(await readFile('output/kimi-live/需求整理.json', 'utf8'))
const form = new FormData()
form.set('prompt', plan.imagePrompt)
form.set('style', 'brand'); form.set('aspect', 'custom'); form.set('size', '1120x736'); form.set('modelChoice', 'default')
// 一次请求，精确35:23像素比例；拒绝后停止，不自动改尺寸付费重试。
const response = await fetch('http://127.0.0.1:8787/api/generations', { method: 'POST', body: form, signal: AbortSignal.timeout(310000) })
const result = await response.json()
if (!response.ok) throw new Error(`生成失败 HTTP ${response.status}: ${result.error}`)
await writeFile(cache, JSON.stringify({ ...result, sourcePlan: plan, testNote: '未提供现场照片或原始Logo；无字概念测试，非生产稿。' }, null, 2))
const image = await fetch(`http://127.0.0.1:8787${result.imageUrl}`)
if (!image.ok) throw new Error('图片访问失败')
const extension = image.headers.get('content-type')?.includes('jpeg') ? 'jpg' : image.headers.get('content-type')?.includes('webp') ? 'webp' : 'png'
await writeFile(`${directory}/concept.${extension}`, Buffer.from(await image.arrayBuffer()))
console.log(JSON.stringify({ success: true, id: result.id, provider: result.provider, model: result.model, requestedSize: result.requestedSize, imageUrl: result.imageUrl, saved: `${directory}/concept.${extension}` }))
