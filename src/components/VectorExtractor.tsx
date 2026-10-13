import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { importSvgPaths } from '../lib/importSvg'
import type { WallElement } from '../lib/projects'

type ImageElement = Extract<WallElement, { kind: 'image' }>
type Crop = { x: number; y: number; width: number; height: number }
type Layer = { id: string; color: string; svg: string; pathCount: number; background: boolean }
type Result = { layers: Layer[]; width: number; height: number; warnings: string[]; bounds: Crop }
const entire: Crop = { x: 0, y: 0, width: 1, height: 1 }
const imageUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

export function VectorExtractor({ item, url, remaining, onAdd }: { item: ImageElement; url: string; remaining: number; onAdd: (elements: WallElement[], keepSource: boolean) => void }) {
  const image = useRef<HTMLImageElement>(null)
  const drag = useRef<{ x: number; y: number; previous: Crop } | null>(null)
  const alive = useRef(true)
  const controller = useRef<AbortController | null>(null)
  const [crop, setCrop] = useState<Crop>(entire)
  const [mode, setMode] = useState<'layers' | 'color'>('layers')
  const [colors, setColors] = useState(6)
  const [color, setColor] = useState('#193c5a')
  const [tolerance, setTolerance] = useState(45)
  const [pickingColor, setPickingColor] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [keepSource, setKeepSource] = useState(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort() } }, [])
  const invalidate = () => { setResult(null); setSelected([]); setMessage('') }
  const position = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)), y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)) }
  }
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (busy || !image.current?.naturalWidth || event.button !== 0) return
    event.preventDefault()
    const point = position(event)
    invalidate()
    if (pickingColor) {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
      const context = canvas.getContext('2d')!
      context.drawImage(image.current, Math.min(image.current.naturalWidth - 1, Math.floor(point.x * image.current.naturalWidth)), Math.min(image.current.naturalHeight - 1, Math.floor(point.y * image.current.naturalHeight)), 1, 1, 0, 0, 1, 1)
      setColor('#' + [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)].map((value) => value.toString(16).padStart(2, '0')).join(''))
      setPickingColor(false); return
    }
    drag.current = { ...point, previous: crop }
    event.currentTarget.setPointerCapture(event.pointerId)
    setCrop({ ...point, width: 0, height: 0 })
  }
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    const point = position(event), start = drag.current
    setCrop({ x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) })
  }
  const pointerUp = () => {
    if (!drag.current) return
    if (crop.width < .005 || crop.height < .005) setCrop(drag.current.previous)
    drag.current = null
  }

  const generate = async () => {
    if (!image.current?.naturalWidth || crop.width < .005 || crop.height < .005) { setMessage('请先在图片上拖动框选范围'); return }
    setBusy(true); invalidate()
    controller.current = new AbortController()
    try {
      const original = image.current
      const sx = Math.floor(crop.x * original.naturalWidth), sy = Math.floor(crop.y * original.naturalHeight)
      const sw = Math.min(original.naturalWidth - sx, Math.max(1, Math.round(crop.width * original.naturalWidth)))
      const sh = Math.min(original.naturalHeight - sy, Math.max(1, Math.round(crop.height * original.naturalHeight)))
      const ratio = Math.min(1, 1536 / Math.max(sw, sh))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(sw * ratio)); canvas.height = Math.max(1, Math.round(sh * ratio))
      const context = canvas.getContext('2d', { willReadFrequently: true })!
      context.drawImage(original, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
      if (mode === 'color') {
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
        const rgb = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16))
        for (let i = 0; i < pixels.data.length; i += 4) {
          const included = pixels.data[i + 3] >= 128 && Math.max(...rgb.map((channel, j) => Math.abs(pixels.data[i + j] - channel))) <= tolerance
          pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = included ? 0 : 255; pixels.data[i + 3] = 255
        }
        context.putImageData(pixels, 0, 0)
      }
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('无法读取框选图片')), 'image/png'))
      if (blob.size > 2 * 1024 * 1024) throw new Error('框选区域过于复杂，请缩小范围')
      const form = new FormData(); form.append('mask', blob, 'selection.png'); form.append('colors', String(colors))
      const response = await fetch(`/api/vectorize/${mode === 'layers' ? 'layers' : 'mask'}`, { method: 'POST', body: form, signal: controller.current.signal })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '图片转换失败')
      if (!alive.current) return
      const layers: Layer[] = mode === 'layers' ? data.layers : [{ id: 'single', color, svg: data.svg.replaceAll('fill="#000000"', `fill="${color}"`), pathCount: data.pathCount, background: false }]
      const bounds = { x: item.x + item.width * sx / original.naturalWidth, y: item.y + item.height * sy / original.naturalHeight, width: item.width * sw / original.naturalWidth, height: item.height * sh / original.naturalHeight }
      setResult({ layers, width: data.width, height: data.height, bounds, warnings: data.warnings || [] })
      setSelected(layers.filter((layer) => !layer.background).map((layer) => layer.id))
      setMessage(`生成 ${layers.length} 个颜色层。单一路径的疑似背景默认不选；同色文字与背景可能混在一层，请对照原图后再加入。`)
    } catch (error) { if (alive.current) setMessage(error instanceof Error ? error.message : '转换失败') }
    finally { if (alive.current) setBusy(false) }
  }
  const add = async () => {
    if (!result || !selected.length) return
    setBusy(true)
    try {
      const elements: WallElement[] = []
      for (const layer of result.layers.filter((candidate) => selected.includes(candidate.id))) {
        const paths = await importSvgPaths(layer.svg, result.bounds.width)
        const yCorrection = (result.bounds.height / result.height) / (result.bounds.width / result.width)
        elements.push(...paths.map((path, index) => ({ ...path, x: result.bounds.x + path.x, y: result.bounds.y + path.y * yCorrection, height: path.height * yCorrection, label: `${layer.color} · 轮廓${index + 1}` })))
      }
      if (elements.length > remaining + (keepSource ? 0 : 1)) throw new Error(`剩余可添加 ${remaining} 个对象，请少选一些颜色层`)
      if (alive.current) onAdd(elements, keepSource)
    } catch (error) { if (alive.current) setMessage(error instanceof Error ? error.message : '无法加入画布') }
    finally { if (alive.current) setBusy(false) }
  }
  const chosen = result?.layers.filter((layer) => selected.includes(layer.id)) || []
  const combined = result ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${result.width} ${result.height}">${chosen.map((layer) => layer.svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')).join('')}</svg>` : ''

  return <div className="selected-editor vector-extractor">
    <h3>图片分层与 SVG 提取</h3>
    <p className="tiny-note">拖动框选要处理的区域，或直接处理整张图。颜色层可能同时包含背景和文字，请逐层预览；加入画布后的轮廓可单独移动、改色和下载。细小文字请对照原文检查。</p>
    <div className="button-pair"><label>转换方式<select value={mode} disabled={busy} onChange={(event) => { setMode(event.target.value as 'layers' | 'color'); setPickingColor(false); invalidate() }}><option value="layers">自动颜色分层</option><option value="color">指定单色提取</option></select></label>{mode === 'layers' ? <label>主要颜色数<select aria-label="主要颜色数" value={colors} disabled={busy} onChange={(event) => { setColors(Number(event.target.value)); invalidate() }}>{[2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n} 色</option>)}</select></label> : <><label>目标颜色<input type="color" value={color} disabled={busy} onChange={(event) => { setColor(event.target.value); invalidate() }}/></label><label>容差<input type="number" min="0" max="120" value={tolerance} disabled={busy} onChange={(event) => { setTolerance(Math.max(0, Math.min(120, Number(event.target.value)))); invalidate() }}/></label><button type="button" disabled={busy} onClick={() => setPickingColor(!pickingColor)}>{pickingColor ? '正在取色：点击下图' : '从原图取色'}</button></>}</div>
    <div className="vector-crop" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} aria-label="拖动框选图片区域">
      <img ref={image} src={url} alt="待分层原图" draggable={false}/>
      <div className="vector-crop-box" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }}/>
    </div>
    <div className="button-pair"><button type="button" disabled={busy} onClick={() => { setCrop(entire); invalidate() }}>重置为整图</button><span>区域约 {Math.round(item.width * crop.width)} × {Math.round(item.height * crop.height)} mm</span><button type="button" disabled={busy} onClick={() => void generate()}>{busy ? '处理中…' : '生成分层预览'}</button></div>
    {result && <><div className="vector-layer-list">{result.layers.map((layer) => <label key={layer.id} className="vector-layer"><input type="checkbox" aria-label={`保留颜色层${layer.color}`} checked={selected.includes(layer.id)} disabled={busy} onChange={(event) => setSelected(event.target.checked ? [...selected, layer.id] : selected.filter((id) => id !== layer.id))}/><img src={imageUrl(layer.svg)} alt={`${layer.color}颜色层预览`}/><span>{layer.color}{layer.background ? ' · 疑似背景' : ''}<small>{layer.pathCount} 个独立轮廓</small></span></label>)}</div><img className="vector-composite" src={imageUrl(combined)} alt="已选图层合成预览"/><label className="check"><input type="checkbox" checked={keepSource} disabled={busy} onChange={(event) => setKeepSource(event.target.checked)}/>保留原图对象作对照</label><button type="button" disabled={busy || !chosen.length} onClick={() => void add()}>加入选中图层（{chosen.reduce((count, layer) => count + layer.pathCount, 0)} 个轮廓）</button>{result.warnings.map((warning) => <p className="tiny-note" key={warning}>{warning}</p>)}</>}
    {message && <p role="status">{message}</p>}
  </div>
}
