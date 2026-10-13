import { useEffect, useRef, useState } from 'react'
import type { WallElement } from '../lib/projects'

type OcrItem = {
  id: string; index: number; text: string; score: number
  polygon: [number, number][]; rotation: number
  bbox: { x: number; y: number; w: number; h: number }
  fontSize: number; weight: number; color: string
}
type ImageElement = Extract<WallElement, { kind: 'image' }>

export function TextExtractor({ projectId, item, url, remaining, onAdd }: { projectId: string; item: ImageElement; url: string; remaining: number; onAdd: (elements: WallElement[]) => void }) {
  const [items, setItems] = useState<OcrItem[]>([])
  const [chosen, setChosen] = useState<string[]>([])
  const [sourceSize, setSourceSize] = useState({ width: 0, height: 0 })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])

  const recognize = async () => {
    if (!url) return
    setBusy(true); setMessage(''); controller.current = new AbortController()
    try {
      const response = await fetch(url, { signal: controller.current.signal })
      if (!response.ok) throw new Error('无法读取图片素材')
      const blob = await response.blob()
      const image = await createImageBitmap(blob)
      const { width, height } = image; image.close()
      const form = new FormData()
      form.set('action', 'ocr'); form.set('width', String(width)); form.set('height', String(height))
      form.set('source_image', blob, 'source-image.png')
      const result = await fetch(`/api/projects/${projectId}/ocr`, { method: 'POST', body: form, signal: controller.current.signal })
      const payload = await result.json()
      if (!result.ok) throw new Error(payload.error || '文字识别失败')
      const detected = payload.data.items as OcrItem[]
      setItems(detected); setChosen(detected.filter((line) => line.score >= .5).map((line) => line.id))
      setSourceSize({ width: payload.data.width, height: payload.data.height })
      setMessage(detected.length ? `本地识别到 ${detected.length} 个文字框。请逐字核对后加入画布。` : '这张图未检测到文字，可裁剪后重新尝试。')
    } catch (error) { if ((error as Error).name !== 'AbortError') setMessage(error instanceof Error ? error.message : '文字识别失败') }
    finally { setBusy(false) }
  }
  const update = (id: string, patch: Partial<OcrItem>) => setItems((old) => old.map((line) => line.id === id ? { ...line, ...patch } : line))
  const add = () => {
    const selected = items.filter((line) => chosen.includes(line.id) && line.text.trim())
    if (selected.length > remaining) { setMessage(`还可加入 ${remaining} 个对象，请减少勾选`); return }
    const scaleX = item.width / sourceSize.width, scaleY = item.height / sourceSize.height
    const elements: WallElement[] = selected.map((line) => ({
      id: crypto.randomUUID(), kind: 'text', text: line.text.trim(),
      x: item.x + line.bbox.x * scaleX, y: item.y + line.bbox.y * scaleY,
      width: Math.max(1, line.bbox.w * scaleX), height: Math.max(1, line.bbox.h * scaleY),
      fontSizeMm: Math.max(1, line.fontSize * scaleY), color: line.color,
      rotationDeg: line.rotation, fontWeight: line.weight, ocrScore: line.score, ocrPolygon: line.polygon,
    }))
    onAdd(elements)
    setMessage(`已加入 ${elements.length} 个文字对象。原图片还在下层，未擦除其中的旧文字；请保存并核对重叠位置。`)
  }

  return <div className="selected-editor text-extractor">
    <h3>OCR 文字识别与重建</h3>
    <p className="tiny-note">本地识别，无付费调用。颜色从文字框内采样；高置信度也可能有错字。原图片仍保留，旧字尚未擦除，请核对文字、颜色和位置。</p>
    <button type="button" disabled={busy} onClick={() => void recognize()}>{busy ? '正在识别…' : '识别这张图片的文字'}</button>
    {items.length > 0 && <><div className="ocr-preview"><img src={url} alt="OCR 原图与文字框"/><svg viewBox={`0 0 ${sourceSize.width} ${sourceSize.height}`} aria-label="文字识别位置预览">{items.map((line) => <g key={line.id}><polygon points={line.polygon.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke={chosen.includes(line.id) ? '#ff6b2b' : '#737373'} strokeWidth={Math.max(2, sourceSize.width / 500)}/><text x={line.bbox.x} y={Math.max(16, line.bbox.y)} fontSize={Math.max(14, sourceSize.width / 80)} fill="#ff6b2b">{line.index + 1}</text></g>)}</svg></div><div className="ocr-list">{items.map((line) => <div className="ocr-line" key={line.id}>
      <label className="check"><input type="checkbox" checked={chosen.includes(line.id)} onChange={(event) => setChosen(event.target.checked ? [...chosen, line.id] : chosen.filter((id) => id !== line.id))}/>使用 · 置信度 {Math.round(line.score * 100)}%</label>
      <textarea aria-label={`OCR文字${line.index + 1}`} rows={2} value={line.text} onChange={(event) => update(line.id, { text: event.target.value })}/>
      <label>取样颜色 <input aria-label={`OCR颜色${line.index + 1}`} type="color" value={line.color} onChange={(event) => update(line.id, { color: event.target.value })}/></label>
    </div>)}</div><button type="button" disabled={busy || chosen.length === 0} onClick={add}>加入选中文字对象（{chosen.length}）</button></>}
    {message && <p role="status">{message}</p>}
  </div>
}
