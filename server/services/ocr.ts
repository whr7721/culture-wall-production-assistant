import { Worker } from 'node:worker_threads'
import sharp from 'sharp'

export type OcrItem = {
  id: string; index: number; text: string; score: number
  polygon: [number, number][]; rotation: number
  bbox: { x: number; y: number; w: number; h: number }
  x: number; y: number; w: number; h: number
  fontSize: number; weight: number; color: string
}
export type OcrResult = { ok: true; data: { items: OcrItem[]; engine: 'RapidOCR'; width: number; height: number } }
type RawLine = { text: string; score: number; polygon: number[][] }

function distance(a: number[], b: number[]) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) }
function bucket(data: Buffer, index: number) { return [0, 1, 2].map((channel) => Math.min(255, Math.round(data[index + channel] / 16) * 16)) }
function key(color: number[]) { return color.join(',') }

// Estimate the dominant foreground colour inside the OCR box. The border mode
// is used as a local background estimate, not a hard-coded dark text colour.
export function sampleTextColor(data: Buffer, width: number, height: number, box: { x: number; y: number; w: number; h: number }): string {
  const x0 = Math.max(0, Math.floor(box.x)), y0 = Math.max(0, Math.floor(box.y))
  const x1 = Math.min(width, Math.ceil(box.x + box.w)), y1 = Math.min(height, Math.ceil(box.y + box.h))
  const border = new Map<string, number>(), inside = new Map<string, number>()
  const step = Math.max(1, Math.floor(Math.max(x1 - x0, y1 - y0) / 300))
  const rim = Math.max(2, Math.min(6, Math.floor(Math.min(x1 - x0, y1 - y0) * .12)))
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) {
    const offset = (y * width + x) * 4
    if (data[offset + 3] < 128) continue
    const color = key(bucket(data, offset))
    const edge = x < x0 + rim || x >= x1 - rim || y < y0 + rim || y >= y1 - rim
    const target = edge ? border : inside
    target.set(color, (target.get(color) || 0) + 1)
  }
  const dominant = (counts: Map<string, number>) => [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]
  const bg = dominant(border) || dominant(inside)
  if (!bg) return '#111827'
  const background = bg.split(',').map(Number)
  const foreground = [...inside].filter(([color]) => distance(color.split(',').map(Number), background) >= 48).sort((a, b) => b[1] - a[1])[0]?.[0]
  const chosen = (foreground || bg).split(',').map(Number)
  return '#' + chosen.map((value) => value.toString(16).padStart(2, '0')).join('')
}

function runWorker(input: Buffer): Promise<RawLine[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./ocrWorker.cjs', import.meta.url), { workerData: { input } })
    let settled = false
    const finish = (error?: Error, lines?: RawLine[]) => {
      if (settled) return
      settled = true; clearTimeout(timeout); void worker.terminate()
      if (error) reject(error); else resolve(lines || [])
    }
    const timeout = setTimeout(() => finish(new Error('本地 OCR 超过90秒，请裁剪或缩小图片')), 90_000)
    worker.once('message', (message: { lines?: RawLine[]; error?: string }) => finish(message.error ? new Error(message.error) : undefined, message.lines))
    worker.once('error', (error) => finish(error))
    worker.once('exit', (code) => { if (code !== 0) finish(new Error('本地 OCR 已停止，请稍后重试')) })
  })
}

export async function recognizeText(input: Buffer): Promise<OcrResult> {
  const metadata = await sharp(input, { limitInputPixels: 16_000_000 }).metadata()
  if (!metadata.width || !metadata.height || metadata.width > 6000 || metadata.height > 6000) throw new Error('OCR 图片单边须不超过 6000 像素')
  const sideways = [5, 6, 7, 8].includes(metadata.orientation || 1)
  const originalWidth = sideways ? metadata.height : metadata.width
  const originalHeight = sideways ? metadata.width : metadata.height
  const normalized = await sharp(input).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).png().toBuffer()
  const { data, info } = await sharp(normalized).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const lines = await runWorker(normalized)
  const scaleX = originalWidth / info.width, scaleY = originalHeight / info.height
  const items: OcrItem[] = lines.filter((line) => line.text?.trim() && Number.isFinite(line.score) && line.polygon?.length === 4).slice(0, 100).map((line, index) => {
    const polygon = line.polygon.map(([x, y]) => [Math.max(0, Math.min(originalWidth, x * scaleX)), Math.max(0, Math.min(originalHeight, y * scaleY))] as [number, number])
    const xs = polygon.map((point) => point[0]), ys = polygon.map((point) => point[1])
    const bbox = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
    const smallBox = { x: bbox.x / scaleX, y: bbox.y / scaleY, w: bbox.w / scaleX, h: bbox.h / scaleY }
    return {
      id: `ocr-${index + 1}`, index, text: line.text.trim(), score: Math.max(0, Math.min(1, line.score)), polygon,
      bbox, x: bbox.x / originalWidth * 100, y: bbox.y / originalHeight * 100, w: bbox.w / originalWidth * 100, h: bbox.h / originalHeight * 100,
      rotation: Math.atan2(polygon[1][1] - polygon[0][1], polygon[1][0] - polygon[0][0]) * 180 / Math.PI,
      fontSize: Math.max(1, Math.round(Math.hypot(polygon[3][0] - polygon[0][0], polygon[3][1] - polygon[0][1]) * .82)),
      weight: 700, color: sampleTextColor(data, info.width, info.height, smallBox),
    }
  }).filter((item) => item.bbox.w > 1 && item.bbox.h > 1)
  return { ok: true, data: { items, engine: 'RapidOCR', width: originalWidth, height: originalHeight } }
}

// Reserved upgrade seam. No Baidu credentials, client, or outbound request is configured.
export type OcrProvider = 'rapidocr' | 'baidu'
export async function recognizeWithProvider(input: Buffer, provider: OcrProvider = 'rapidocr') {
  if (provider !== 'rapidocr') throw new Error('百度 OCR 尚未配置')
  return recognizeText(input)
}
