import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { importSvgPaths } from '../lib/importSvg'
import type { WallElement } from '../lib/projects'
import type { VectorTaskView } from '../../shared/vectorTasks'
import { readVectorTask, waitVectorTask } from '../lib/vectorTasks'

type ImageElement = Extract<WallElement, { kind: 'image' }>
type Crop = { x: number; y: number; width: number; height: number }
type Layer = { id: string; color: string; svg: string; pathCount: number; background: boolean }
type Result = { layers: Layer[]; width: number; height: number; warnings: string[]; bounds: Crop; url?: string; provider?: string; mode?: string; editable?: boolean; previewUrl?: string }
const entire: Crop = { x: 0, y: 0, width: 1, height: 1 }
const imageUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

export function VectorExtractor({ projectId, item, url, remaining, onAdd }: { projectId: string; item: ImageElement; url: string; remaining: number; onAdd: (elements: WallElement[], keepSource: boolean) => void }) {
  const image = useRef<HTMLImageElement>(null)
  const drag = useRef<{ x: number; y: number; previous: Crop } | null>(null)
  const alive = useRef(true)
  const controller = useRef<AbortController | null>(null)
  const [crop, setCrop] = useState<Crop>(entire)
  const [mode, setMode] = useState<'layers' | 'color'>('layers')
  const [provider, setProvider] = useState<'local' | 'vectorizerai'>('local')
  const [cloudStatus, setCloudStatus] = useState<{ available: boolean; mode: string; reason: string; freeTest?: boolean } | null>(null)
  const [drawStyle, setDrawStyle] = useState('stroke_edges')
  const [palette, setPalette] = useState('')
  const [maxColors, setMaxColors] = useState(0)
  const [groupBy, setGroupBy] = useState('none')
  const [colors, setColors] = useState(6)
  const [color, setColor] = useState('#193c5a')
  const [tolerance, setTolerance] = useState(45)
  const [pickingColor, setPickingColor] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [keepSource, setKeepSource] = useState(true)
  const [tasks, setTasks] = useState<VectorTaskView[]>([])
  const [lastTask, setLastTask] = useState<VectorTaskView | null>(null)
  const [resultChanged, setResultChanged] = useState(false)
  const [forceNew, setForceNew] = useState(false)
  const [budget, setBudget] = useState<{ unit: string; estimatedPerCall: number; dailyReserved: number; totalReserved: number; dailyBudget: number; totalBudget: number; note: string } | null>(null)
  const refreshTasks = async (signal?: AbortSignal) => {
    const query = new URLSearchParams({ projectId, assetId: item.assetId })
    const response = await fetch(`/api/vectorize/tasks?${query}`, { signal })
    if (!response.ok) throw new Error('任务历史读取失败；不要为找回结果重新付费生成')
    const rows = await response.json()
    const budgetResponse = await fetch('/api/vectorize/budget', { signal })
    if (alive.current) { setTasks(rows); if (budgetResponse.ok) setBudget(await budgetResponse.json()) }
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort() } }, [])
  useEffect(() => {
    const abort = new AbortController()
    void fetch('/api/vectorize/providers', { signal: abort.signal }).then(async response => {
      if (!response.ok) throw new Error('无法读取描摹通道状态')
      const data = await response.json()
      setCloudStatus(data.vectorizerai)
    }).catch(() => { if (!abort.signal.aborted) setCloudStatus({ available: false, mode: 'test', reason: '无法读取高质量描摹状态，请刷新页面' }) })
    return () => abort.abort()
  }, [])
  useEffect(() => {
    const abort = new AbortController()
    void refreshTasks(abort.signal).catch(error => { if (!abort.signal.aborted && alive.current) setMessage(error instanceof Error ? error.message : '历史读取失败') })
    return () => abort.abort()
  }, [projectId, item.assetId])
  const invalidate = () => {
    setMessage('')
    if (result?.provider === 'vectorizerai') setResultChanged(true)
    else { setResult(null); setSelected([]) }
  }
  const adoptTask = (task: VectorTaskView, fallbackCrop = crop) => {
    setLastTask(task)
    if (task.status !== 'ready' || !task.width || !task.height) { setMessage(task.error || '任务仍在处理，结果保存在任务历史中'); return }
    const area = task.context?.crop || fallbackCrop
    const layer: Layer = { id: 'high-quality', color: '高质量描摹', svg: task.svg || '', pathCount: task.pathCount || 0, background: false }
    setResult({ layers: [layer], width: task.width, height: task.height, bounds: { x: item.x + item.width * area.x, y: item.y + item.height * area.y, width: item.width * area.width, height: item.height * area.height }, warnings: task.warnings || [], url: task.url, provider: task.provider, mode: task.mode, editable: task.editable, previewUrl: task.previewUrl })
    setSelected([layer.id]); setResultChanged(false)
    setMessage(`${task.cached ? '复用已保存结果，未再次调用上游。' : '已保存描摹结果。'}已生成 ${task.pathCount} 个矢量轮廓，可下载完整 SVG。${task.editable ? '可加入画布。' : '当前画布不能容纳此结果，仍可下载；无需重新描摹。'}`)
  }
  const restoreTask = async (task: VectorTaskView, reprocess = false) => {
    setBusy(true); controller.current = new AbortController()
    try {
      let restored: VectorTaskView
      if (reprocess) {
        const response = await fetch(`/api/vectorize/tasks/${task.id}/reprocess`, { method: 'POST', signal: controller.current.signal })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || '本地重处理未完成')
        restored = data
      } else restored = await waitVectorTask(await readVectorTask(task.id, controller.current.signal), controller.current.signal)
      if (alive.current) {
        const recovered = { ...restored, context: task.context || restored.context }
        if (recovered.context) setCrop(recovered.context.crop)
        if (recovered.options) { setDrawStyle(recovered.options['output.draw_style']); setPalette(recovered.options['processing.palette']); setMaxColors(recovered.options['processing.max_colors']); setGroupBy(recovered.options['output.group_by']) }
        setForceNew(false); adoptTask(recovered); await refreshTasks()
      }
    } catch (error) { if (alive.current) setMessage(error instanceof Error ? error.message : '恢复失败；未再次调用上游') }
    finally { if (alive.current) setBusy(false) }
  }
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
    if (provider === 'vectorizerai' && forceNew && !window.confirm('将放弃自动复用，重新向上游提交，可能再次扣费。确定吗？')) return
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
      if (provider === 'local' && mode === 'color') {
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
      const form = new FormData(); form.append('mask', blob, 'selection.png')
      if (provider === 'vectorizerai') {
        form.set('output.draw_style', drawStyle); form.set('processing.palette', palette)
        form.set('processing.max_colors', String(maxColors)); form.set('output.group_by', groupBy)
        form.set('context', JSON.stringify({ projectId, assetId: item.assetId, elementId: item.id, crop: { x: sx / original.naturalWidth, y: sy / original.naturalHeight, width: sw / original.naturalWidth, height: sh / original.naturalHeight } }))
        if (forceNew) form.set('force', '1')
      } else form.append('colors', String(colors))
      const response = await fetch(`/api/vectorize/${provider === 'vectorizerai' ? 'high-quality' : mode === 'layers' ? 'layers' : 'mask'}`, { method: 'POST', body: form, signal: controller.current.signal, ...(provider === 'vectorizerai' ? { headers: { Prefer: 'respond-async', ...(forceNew ? { 'X-Confirm-Paid-Retry': '1' } : {}) } } : {}) })
      const data = await response.json()
      if (provider === 'vectorizerai' && data.id) {
        if (alive.current) { setLastTask(data); setForceNew(false); await refreshTasks() }
        const task = await waitVectorTask(data, controller.current.signal)
        if (alive.current) { adoptTask(task); await refreshTasks() }
        return
      }
      if (!response.ok) throw new Error(data.error || '图片转换失败')
      if (!alive.current) return
      const layers: Layer[] = provider === 'vectorizerai' ? [{ id: 'high-quality', color: '高质量描摹', svg: data.svg, pathCount: data.pathCount, background: false }] : mode === 'layers' ? data.layers : [{ id: 'single', color, svg: data.svg.replaceAll('fill="#000000"', `fill="${color}"`), pathCount: data.pathCount, background: false }]
      const bounds = { x: item.x + item.width * sx / original.naturalWidth, y: item.y + item.height * sy / original.naturalHeight, width: item.width * sw / original.naturalWidth, height: item.height * sh / original.naturalHeight }
      setResult({ layers, width: data.width, height: data.height, bounds, warnings: data.warnings || [], url: data.url, provider: data.provider, mode: data.mode })
      setSelected(layers.filter((layer) => !layer.background).map((layer) => layer.id))
      setMessage(provider === 'vectorizerai' ? `已生成 ${data.pathCount} 个矢量轮廓，可下载完整 SVG 或展开为画布对象。${data.mode === 'test' ? '当前为带水印免费测试结果。' : ''}` : `生成 ${layers.length} 个颜色层。单一路径的疑似背景默认不选；同色文字与背景可能混在一层，请对照原图后再加入。`)
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
    <details className="vector-task-history"><summary>已保存的描摹任务（恢复／下载不调用收费接口） · {tasks.length}</summary>
      {budget && <p className="tiny-note">本站预算：今日预占 {budget.dailyReserved} / {budget.dailyBudget} {budget.unit}，总预占 {budget.totalReserved} / {budget.totalBudget} {budget.unit}。预计新调用 {budget.estimatedPerCall} {budget.unit}／次。{budget.note}</p>}
      {tasks.map(task => <div key={task.id} className="vector-task-row"><p>{new Date(task.createdAt).toLocaleString('zh-CN')} · {task.legacy ? '旧版结果' : ({ ready: '已保存', running: '上游处理中', processing: '本地处理中', needs_repair: '本地处理待修复', upstream_failed: '上游失败', unknown: '任务中断／费用待核实' } as const)[task.status]} · {task.id.slice(0, 8)}</p>
        {task.options && <p className="tiny-note">{task.input && `${task.input.width} × ${task.input.height}px · `}{task.options['output.draw_style']} · {task.options['processing.max_colors'] || '自动'}色 · 预计预占 {task.estimatedCost} {task.budgetUnit}，实际扣费未核实</p>}
        {!task.legacy && <button type="button" disabled={busy} onClick={() => void restoreTask(task)}>恢复结果／查看状态</button>}
        {task.rawComplete && !['running', 'processing'].includes(task.status) && <button type="button" disabled={busy} onClick={() => void restoreTask(task, true)}>免费本地重处理</button>}
        {task.url && <a href={task.url} download>下载已保存 SVG</a>}
        {task.rawUrl && <a href={task.rawUrl} download>原始响应 TXT（未验证，仅供修复）</a>}
        {task.error && <p className="tiny-note">{task.error}</p>}
      </div>)}
    </details>
    <label>描摹通道<select aria-label="描摹通道" value={provider} disabled={busy} onChange={event => { setProvider(event.target.value as 'local' | 'vectorizerai'); setPickingColor(false); invalidate() }}><option value="local">本地免费描摹</option><option value="vectorizerai">高质量描摹{cloudStatus?.freeTest ? '（免费测试）' : cloudStatus?.mode === 'production' ? '（按次计费）' : ''}</option></select></label>
    {provider === 'vectorizerai' ? <>
      <p className="tiny-note">{cloudStatus?.available ? cloudStatus.mode === 'test' ? '免费 test 模式，结果带水印。框选图片将提交给外部描摹服务。' : '生产模式会消耗描摹额度。框选图片将提交给外部描摹服务。' : cloudStatus?.reason || '正在读取通道状态…'}</p>
      {budget && budget.dailyBudget === 0 && <p role="alert">新增付费调用已暂停；历史下载、恢复和本地重处理仍可使用。</p>}
      <label className="check"><input type="checkbox" checked={forceNew} disabled={busy} onChange={event => setForceNew(event.target.checked)}/>不复用旧任务，重新付费提交（需再次确认）</label>
      <div className="button-pair"><button type="button" disabled={busy} onClick={() => { setDrawStyle('stroke_edges'); invalidate() }}>图标：描边</button><button type="button" disabled={busy} onClick={() => { setDrawStyle('fill_shapes'); invalidate() }}>色块：填充</button></div>
      <label>绘制方式（draw_style）<select aria-label="绘制方式" disabled={busy} value={drawStyle} onChange={event => { setDrawStyle(event.target.value); invalidate() }}><option value="stroke_edges">stroke_edges · 图标边缘描边</option><option value="fill_shapes">fill_shapes · 色块填充</option><option value="stroke_shapes">stroke_shapes · 形状描边</option></select></label>
      <label>锁色（processing.palette）<input aria-label="锁色色板" placeholder="#1a2f7c;#ffffff;" disabled={busy} value={palette} onChange={event => { setPalette(event.target.value); invalidate() }}/></label><p className="tiny-note">十六进制颜色以分号结束；#00000000; 表示透明。只填一个颜色可能让所有形状同色，图标可同时保留背景色。</p>
      <label>最大颜色数（max_colors）<input aria-label="最大颜色数" type="number" min="0" max="256" step="1" disabled={busy} value={maxColors} onChange={event => { setMaxColors(Number(event.target.value)); invalidate() }}/></label><p className="tiny-note">0 为自动；1 和 2 均为双色。锁色时仍需检查背景与细节。</p>
      <label>分组（group_by）<select aria-label="描摹分组" disabled={busy} value={groupBy} onChange={event => { setGroupBy(event.target.value); invalidate() }}>{['none', 'color', 'parent', 'layer'].map(value => <option key={value} value={value}>{value}</option>)}</select></label><p className="tiny-note">按颜色分组在描边模式下可能不产生分组。下载保留上游分组，加入画布时展开为独立路径。</p>
    </> : <div className="button-pair"><label>转换方式<select value={mode} disabled={busy} onChange={(event) => { setMode(event.target.value as 'layers' | 'color'); setPickingColor(false); invalidate() }}><option value="layers">自动颜色分层</option><option value="color">指定单色提取</option></select></label>{mode === 'layers' ? <label>主要颜色数<select aria-label="主要颜色数" value={colors} disabled={busy} onChange={(event) => { setColors(Number(event.target.value)); invalidate() }}>{[2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n} 色</option>)}</select></label> : <><label>目标颜色<input type="color" value={color} disabled={busy} onChange={(event) => { setColor(event.target.value); invalidate() }}/></label><label>容差<input type="number" min="0" max="120" value={tolerance} disabled={busy} onChange={(event) => { setTolerance(Math.max(0, Math.min(120, Number(event.target.value)))); invalidate() }}/></label><button type="button" disabled={busy} onClick={() => setPickingColor(!pickingColor)}>{pickingColor ? '正在取色：点击下图' : '从原图取色'}</button></>}</div>}
    <div className="vector-crop" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} aria-label="拖动框选图片区域">
      <img ref={image} src={url} alt="待分层原图" draggable={false}/>
      <div className="vector-crop-box" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }}/>
    </div>
    <div className="button-pair"><button type="button" disabled={busy} onClick={() => { setCrop(entire); invalidate() }}>重置为整图</button><span>区域约 {Math.round(item.width * crop.width)} × {Math.round(item.height * crop.height)} mm</span><button type="button" disabled={busy || (provider === 'vectorizerai' && !cloudStatus?.available)} onClick={() => void generate()}>{busy ? '处理中…' : provider === 'vectorizerai' ? '生成高质量 SVG' : '生成分层预览'}</button></div>
    {result?.url && <a href={result.url} download>下载完整 SVG{result.mode === 'test' ? '（测试水印）' : ''}</a>}
    {resultChanged && <p className="tiny-note">下面保留的是已保存结果；新参数或新框选不会改变旧文件。需要旧结果请直接下载或恢复，不要重新付费生成。</p>}
    {lastTask && lastTask.status !== 'ready' && <p role="status">任务 {lastTask.id.slice(0, 8)}：{lastTask.error || '后台处理中，可从任务历史恢复'}；未自动重试。</p>}
    {result && <><div className="vector-layer-list">{result.layers.map((layer) => <label key={layer.id} className="vector-layer"><input type="checkbox" aria-label={`保留颜色层${layer.color}`} checked={selected.includes(layer.id)} disabled={busy} onChange={(event) => setSelected(event.target.checked ? [...selected, layer.id] : selected.filter((id) => id !== layer.id))}/><img src={layer.svg ? imageUrl(layer.svg) : result.previewUrl} alt={`${layer.color}颜色层预览`}/><span>{layer.color}{layer.background ? ' · 疑似背景' : ''}<small>{layer.pathCount} 个独立轮廓</small></span></label>)}</div><img className="vector-composite" src={chosen.some(layer => layer.svg) ? imageUrl(combined) : chosen.length && result.previewUrl ? result.previewUrl : imageUrl(combined)} alt="已选图层合成预览"/><label className="check"><input type="checkbox" checked={keepSource} disabled={busy} onChange={(event) => setKeepSource(event.target.checked)}/>保留原图对象作对照</label><button type="button" disabled={busy || !chosen.length || result.editable === false || chosen.reduce((count, layer) => count + layer.pathCount, 0) > remaining + (keepSource ? 0 : 1)} onClick={() => void add()}>加入选中图层（{chosen.reduce((count, layer) => count + layer.pathCount, 0)} 个轮廓）</button>{result.warnings.map((warning) => <p className="tiny-note" key={warning}>{warning}</p>)}</>}
    {message && <p role="status">{message}</p>}
  </div>
}
