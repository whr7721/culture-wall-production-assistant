import { useEffect, useRef, useState } from 'react'
import { Canvas, FabricImage, Rect, Textbox, Path } from 'fabric'
import { importSvgPaths } from '../lib/importSvg'
import { createProject, getProject, listProjects, saveProject, uploadAsset, type Project, type ProjectRow, type WallElement } from '../lib/projects'
import { downloadPreview, downloadPsd, downloadSvg, downloadElementSvg } from '../lib/exports'
import type { GenerationResult } from '../types'

const uid = () => crypto.randomUUID()
const number = (value: string, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback
const fields = ['x', 'y', 'width', 'height'] as const
const title = (item: WallElement) => item.kind === 'text' ? item.text.slice(0, 16) : item.label
type TraceMask = { blob: Blob; preview: string; sourceId: string; x: number; y: number; width: number; height: number }

async function prepareTraceMask(url: string, item: Extract<WallElement, { kind: 'image' }>, crop: number[], color: string, tolerance: number): Promise<TraceMask> {
  const image = new Image()
  image.src = url
  await image.decode()
  const [left, top, cropWidth, cropHeight] = crop
  if (left < 0 || top < 0 || cropWidth <= 0 || cropHeight <= 0 || left + cropWidth > 100 || top + cropHeight > 100) throw new Error('裁剪范围应在图片内，四个百分比之和不能越界')
  const sx = Math.round(image.naturalWidth * left / 100), sy = Math.round(image.naturalHeight * top / 100)
  const sw = Math.max(1, Math.round(image.naturalWidth * cropWidth / 100)), sh = Math.max(1, Math.round(image.naturalHeight * cropHeight / 100))
  const scale = Math.min(1, 1024 / Math.max(sw, sh))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sw * scale)); canvas.height = Math.max(1, Math.round(sh * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
  const red = parseInt(color.slice(1, 3), 16), green = parseInt(color.slice(3, 5), 16), blue = parseInt(color.slice(5, 7), 16)
  let selectedPixels = 0
  for (let i = 0; i < pixels.data.length; i += 4) {
    const match = Math.max(Math.abs(pixels.data[i] - red), Math.abs(pixels.data[i + 1] - green), Math.abs(pixels.data[i + 2] - blue)) <= tolerance
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = match ? 0 : 255
    pixels.data[i + 3] = 255
    if (match) selectedPixels++
  }
  if (selectedPixels < 16 || selectedPixels / (canvas.width * canvas.height) > .95) throw new Error('选中的目标颜色太少或太多，请调整颜色、容差或裁剪范围')
  context.putImageData(pixels, 0, 0)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('无法生成蒙版')), 'image/png'))
  return { blob, preview: canvas.toDataURL('image/png'), sourceId: item.id, x: item.x + item.width * left / 100, y: item.y + item.height * top / 100, width: item.width * cropWidth / 100, height: item.height * cropHeight / 100 }
}

export function ProjectWorkspace({ importRequest }: { importRequest: { token: string; result: GenerationResult; widthMm: number; heightMm: number } | null }) {
  const [rows, setRows] = useState<ProjectRow[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedAssets, setSelectedAssets] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [showCreate, setShowCreate] = useState(false)
  const [traceCrop, setTraceCrop] = useState([0, 0, 100, 100])
  const [traceColor, setTraceColor] = useState('#193c5a')
  const [traceTolerance, setTraceTolerance] = useState(45)
  const [traceMask, setTraceMask] = useState<TraceMask | null>(null)
  const [newName, setNewName] = useState('新文化墙项目')
  const canvasElement = useRef<HTMLCanvasElement>(null)
  const canvasRef = useRef<Canvas | null>(null)
  const currentProject = useRef<Project | null>(null)
  currentProject.current = project
  const importedToken = useRef('')

  useEffect(() => {
    if (!importRequest || importedToken.current === importRequest.token) return
    importedToken.current = importRequest.token
    void perform(async () => {
      const { result, widthMm, heightMm } = importRequest
      const response = await fetch(result.imageUrl)
      if (!response.ok) throw new Error('读取生成结果失败，未更改已有项目')
      const blob = await response.blob()
      let next = await createProject(`${result.task === 'flat' ? '正视候选' : '空间效果'}-${new Date().toLocaleString('zh-CN')}`)
      // A new project never overwrites the currently open project or existing assets.
      next = await saveProject({ ...next, widthMm, heightMm, copy: result.exactCopy || '', notes: result.prompt, measurementStatus: 'to_measure' })
      const uploaded = await uploadAsset(next, new File([blob], `生成结果-${result.id}.png`, { type: blob.type || 'image/png' }))
      next = uploaded.project
      const asset = next.assets.at(-1)!
      next = await saveProject({ ...next, elements: result.task === 'flat' ? [{ id: uid(), kind: 'image', assetId: asset.id, x: 0, y: 0, width: widthMm, height: heightMm, label: '正视候选整图（未分层）' }] : [], concepts: [{ id: result.id, imageUrl: result.imageUrl, provider: result.provider || 'unknown', model: result.model || 'unknown', role: result.task === 'flat' ? 'flat' : 'space', createdAt: result.createdAt }] })
      setProject(next); setSelected(null); setSelectedAssets([]); await refreshRows()
      setMessage('已带入图片、尺寸和文案并保存为新项目，没有再次生图。整图尚未分层，图片内部文字和图形不能独立编辑。')
    })
  }, [importRequest])

  useEffect(() => { listProjects().then(setRows).catch((error) => setMessage(error.message)) }, [])
  const mutate = (patch: Partial<Project>) => setProject((old) => old ? { ...old, ...patch, status: 'draft' } : old)
  const refreshRows = () => listProjects().then(setRows)
  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setMessage('')
    try { await action() } catch (error) { setMessage(error instanceof Error ? error.message : '操作失败') }
    finally { setBusy(false) }
  }
  const save = async (candidate = project): Promise<Project> => {
    if (!candidate) throw new Error('请先创建项目')
    const saved = await saveProject(candidate)
    setProject(saved)
    await refreshRows()
    setMessage('已保存到服务器，可重新打开继续编辑。')
    return saved
  }
  const load = (id: string) => { if (id) void perform(async () => { setProject(await getProject(id)); setSelected(null); setSelectedAssets([]) }) }
  const create = () => perform(async () => {
    const name = newName.trim()
    if (!name) return
    setProject(await createProject(name)); await refreshRows(); setSelected(null); setSelectedAssets([]); setShowCreate(false)
  })
  const addElement = (element: WallElement) => { if (!project) return; mutate({ elements: [...project.elements, element] }); setSelected(element.id) }
  const changeElement = (patch: Partial<WallElement>) => {
    if (!project || !selected) return
    mutate({ elements: project.elements.map((item) => item.id === selected ? { ...item, ...patch } as WallElement : item) })
  }
  const moveLayer = (direction: -1 | 1) => {
    if (!project || !selected) return
    const index = project.elements.findIndex((item) => item.id === selected)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= project.elements.length) return
    const elements = [...project.elements]
    ;[elements[index], elements[nextIndex]] = [elements[nextIndex], elements[index]]
    mutate({ elements })
  }
  const picked = project?.elements.find((item) => item.id === selected)

  const previewTrace = () => perform(async () => {
    if (!project || !picked || picked.kind !== 'image') return
    const asset = project.assets.find((item) => item.id === picked.assetId)
    if (!asset) throw new Error('原图素材不存在')
    const mask = await prepareTraceMask(asset.url, picked, traceCrop, traceColor, traceTolerance)
    setTraceMask(mask)
    setMessage('黑色为将被描摹的部分。请先检查预览，错误时调整范围、颜色或容差。')
  })
  const confirmTrace = () => perform(async () => {
    if (!project || !picked || picked.kind !== 'image' || !traceMask || traceMask.sourceId !== picked.id) throw new Error('请先预览当前图片的提取蒙版')
    const body = new FormData(); body.append('mask', traceMask.blob, 'selection.png')
    const response = await fetch('/api/vectorize/mask', { method: 'POST', body })
    const result = await response.json() as { svg?: string; pathCount?: number; error?: string }
    if (!response.ok || !result.svg) throw new Error(result.error || '矢量化失败')
    const paths = await importSvgPaths(result.svg, traceMask.width)
    if (project.elements.length + paths.length > 120) throw new Error('项目元素数量超限')
    const placed = paths.map((item, index) => ({ ...item, x: item.x + traceMask.x, y: item.y + traceMask.y, fill: traceColor, label: `提取轮廓${index + 1}` }))
    mutate({ elements: [...project.elements, ...placed] })
    setSelected(placed[0].id); setTraceMask(null)
    setMessage(`已生成 ${placed.length} 条独立 SVG 路径。原图仍保留；请检查细节、保存项目，并在 Illustrator 中验证。`)
  })

  useEffect(() => {
    if (!canvasElement || !canvasElement.current || !project) return
    const scale = Math.min(840 / project.widthMm, 560 / project.heightMm) * zoom
    const width = Math.max(1, Math.round(project.widthMm * scale))
    const height = Math.max(1, Math.round(project.heightMm * scale))
    const board = new Canvas(canvasElement.current, { width, height, backgroundColor: '#ffffff', selection: false })
    canvasRef.current = board
    for (const obstacle of project.obstacles) board.add(new Rect({
      left: obstacle.x * scale, top: obstacle.y * scale, width: obstacle.width * scale,
      height: obstacle.height * scale, fill: 'rgba(224,72,54,.12)', stroke: '#d54a36',
      originX: 'left', originY: 'top',
      strokeDashArray: [6, 4], selectable: false, evented: false,
    }))
    let cancelled = false
    const add = async (item: WallElement) => {
      const common = { left: item.x * scale, top: item.y * scale, originX: 'left' as const, originY: 'top' as const, selectable: true, lockRotation: true }
      let object: Rect | Textbox | FabricImage | Path
      if (item.kind === 'path') object = new Path(item.d, { ...common, fill: item.fill, stroke: item.stroke === 'none' ? null : item.stroke, strokeWidth: item.strokeWidth, scaleX: item.width * scale / item.sourceWidth, scaleY: item.height * scale / item.sourceHeight })
      else if (item.kind === 'rect') object = new Rect({ ...common, width: item.width * scale, height: item.height * scale, fill: item.fill })
      else if (item.kind === 'text') object = new Textbox(item.text || '文字', { ...common, width: item.width * scale, fontSize: item.fontSizeMm * scale, fill: item.color, fontFamily: 'Arial', editable: false, lockScalingY: true })
      else {
        const asset = project.assets.find((asset) => asset.id === item.assetId)
        if (!asset) return
        try {
          object = await FabricImage.fromURL(asset.url)
          object.set({ ...common, scaleX: item.width * scale / object.width, scaleY: item.height * scale / object.height })
        } catch { return }
      }
      if (cancelled) return
      object.set('name', item.id)
      board.add(object)
      board.requestRenderAll()
    }
    void (async () => { for (const item of project.elements) await add(item) })()
    board.on('selection:created', (event) => setSelected((event.selected?.[0] as { name?: string })?.name || null))
    board.on('selection:updated', (event) => setSelected((event.selected?.[0] as { name?: string })?.name || null))
    board.on('object:modified', (event) => {
      const id = (event.target as { name?: string })?.name
      const latest = currentProject.current
      if (!id || !latest) return
      const x = Math.max(0, Math.round((event.target.left || 0) / scale))
      const y = Math.max(0, Math.round((event.target.top || 0) / scale))
      const width = Math.max(1, Math.round(event.target.getScaledWidth() / scale))
      const height = Math.max(1, Math.round(event.target.getScaledHeight() / scale))
      setProject({ ...latest, elements: latest.elements.map((item) => item.id === id ? { ...item, x, y, width, height: item.kind === 'text' ? item.height : height } : item), status: 'draft' })
    })
    return () => { cancelled = true; board.dispose(); canvasRef.current = null }
  }, [project?.id, project?.widthMm, project?.heightMm, project?.obstacles, project?.elements, project?.assets, zoom])

  const exportFile = (kind: 'svg' | 'psd' | 'png') => perform(async () => {
    if (!project) return
    if (kind === 'svg') await downloadSvg(project)
    if (kind === 'psd') await downloadPsd(project)
    if (kind === 'png') await downloadPreview(project)
    setMessage('设计中间稿已下载。生产前仍需在目标软件和工艺流程复核。')
  })

  return <section className="project-workspace" id="projects">
    <div className="section-heading"><div><span className="eyebrow">EDITABLE WORKSPACE</span><h2>正视平面稿工作台</h2></div><span>概念图探索 → 按实测尺寸重建 → 可编辑导出</span></div>
    <div className="project-toolbar">
      <select aria-label="选择项目" value={project?.id || ''} onChange={(event) => void load(event.target.value)}>
        <option value="">选择已有项目</option>{rows.map((row) => <option key={row.id} value={row.id}>{row.title} · {row.status === 'approved' ? '已确认' : '草稿'}</option>)}
      </select>
      <button type="button" onClick={() => { setShowCreate(true); setMessage('') }} disabled={busy}>新建项目</button>
      {project && <button type="button" onClick={() => void perform(async () => { await save() })} disabled={busy}>保存项目</button>}
    </div>
    {showCreate && <form className="project-toolbar" onSubmit={(event) => { event.preventDefault(); void create() }}>
      <label>新项目名称<input aria-label="新项目名称" autoFocus value={newName} maxLength={80} onChange={(event) => setNewName(event.target.value)} /></label>
      <button type="submit" disabled={busy || !newName.trim()}>创建项目</button>
      <button type="button" disabled={busy} onClick={() => setShowCreate(false)}>取消</button>
    </form>}
    {project && <div className="project-layout">
      <div className="project-controls">
        <label>项目名<input value={project.title} maxLength={80} onChange={(event) => mutate({ title: event.target.value })}/></label>
        <div className="inline-fields"><label>墙宽 mm<input type="number" min="1" value={project.widthMm} onChange={(event) => mutate({ widthMm: number(event.target.value, project.widthMm) })}/></label><label>墙高 mm<input type="number" min="1" value={project.heightMm} onChange={(event) => mutate({ heightMm: number(event.target.value, project.heightMm) })}/></label></div>
        <label className="check"><input type="checkbox" checked={project.measurementStatus === 'confirmed'} onChange={(event) => mutate({ measurementStatus: event.target.checked ? 'confirmed' : 'to_measure' })}/>尺寸已现场复尺</label>
        <label>准确文案<textarea rows={4} value={project.copy} onChange={(event) => mutate({ copy: event.target.value })}/></label>
        <label>设计要求<textarea rows={3} value={project.notes} onChange={(event) => mutate({ notes: event.target.value })}/></label>
        <h3>墙体障碍物</h3>
        {project.obstacles.map((item) => <div key={item.id} className="element-row"><input aria-label="障碍物名称" value={item.label} onChange={(event) => mutate({ obstacles: project.obstacles.map((o) => o.id === item.id ? { ...o, label: event.target.value } : o) })}/>{fields.map((field) => <input key={field} aria-label={field} type="number" title={field} value={item[field]} onChange={(event) => mutate({ obstacles: project.obstacles.map((o) => o.id === item.id ? { ...o, [field]: number(event.target.value, o[field]) } : o) })}/>)}<button type="button" onClick={() => mutate({ obstacles: project.obstacles.filter((o) => o.id !== item.id) })}>×</button></div>)}
        <button type="button" onClick={() => mutate({ obstacles: [...project.obstacles, { id: uid(), label: '门/缺口', x: 100, y: 100, width: 500, height: 800 }] })}>添加门／缺口</button>
        <h3>素材（图片会保存在服务器）</h3>
        <label>导入SVG独立路径（实验）<input aria-label="导入SVG独立路径" type="file" accept=".svg,image/svg+xml" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void perform(async () => { if (file.size > 100000) throw new Error('SVG需小于100KB'); const elements = await importSvgPaths(await file.text(), Math.min(1000, project.widthMm)); if (!elements.length) throw new Error('SVG没有可导入路径'); if (project.elements.length + elements.length > 120) throw new Error('项目元素数量超限'); mutate({ elements: [...project.elements, ...elements] }); setSelected(elements[0].id); setMessage(`导入${elements.length}个独立路径，可分别移动、缩放、改色和导出；请保存项目。`) }); event.target.value = '' }}/></label>
        <p className="tiny-note">首轮仅支持带viewBox的纯色path；不支持变换、渐变、图片或文本，请先在原软件展开。默认导入总宽1000mm，可逐对象调整；暂不支持节点编辑或分组。</p>
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void perform(async () => { const saved = await save(project); const result = await uploadAsset(saved, file); setProject(result.project); setMessage('素材已上传，只有此受邀账号可读取。') }); event.target.value = '' }}/>
        {project.assets.map((asset) => <label key={asset.id} className="asset-row"><input type="checkbox" checked={selectedAssets.includes(asset.id)} onChange={(event) => setSelectedAssets(event.target.checked ? [...selectedAssets, asset.id].slice(0, 3) : selectedAssets.filter((id) => id !== asset.id))}/><img src={asset.url} alt="素材缩略图"/><span>{asset.name}</span></label>)}
        <p className="tiny-note">工作台不重复调用生图。请在上方生成并通过“进入工作台”带入结果；素材在此用于添加图片对象。</p>
      </div>
      <div className="project-editor">
        <div className="concept-strip">{project.concepts.map((item) => <div key={item.id}><img src={item.imageUrl} alt={item.role === 'space' ? '空间概念' : '正视候选'}/><small>{item.role === 'space' ? '空间概念' : '正视候选'}</small></div>)}</div>
        <h3>可编辑正视图 <small>以 mm 定位；拖动或拉角调整后保存</small></h3>
        <div className="button-pair" aria-label="画布缩放"><button type="button" onClick={() => setZoom((value) => Math.max(0.5, Math.round((value - 0.25) * 100) / 100))}>缩小</button><button type="button" onClick={() => setZoom(1)}>适合窗口</button><button type="button" onClick={() => setZoom((value) => Math.min(3, Math.round((value + 0.25) * 100) / 100))}>放大</button><span>{Math.round(zoom * 100)}%</span></div>
        <div className="wall-scroll"><canvas ref={canvasElement}/></div>
        <div className="button-pair">
          <button type="button" onClick={() => addElement({ id: uid(), kind: 'rect', x: 100, y: 100, width: 500, height: 250, fill: '#1e4561', label: '装饰' })}>添加色块</button>
          <button type="button" onClick={() => addElement({ id: uid(), kind: 'text', x: 100, y: 100, width: 900, height: 150, fontSizeMm: 90, text: '准确文案', color: '#183d58' })}>添加文字</button>
          <select aria-label="添加图片素材" value="" onChange={(event) => { if (event.target.value) addElement({ id: uid(), kind: 'image', assetId: event.target.value, x: 100, y: 100, width: 500, height: 400, label: '图片' }) }}><option value="">添加图片素材…</option>{project.assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select>
        </div>
        <div className="element-picks">{project.elements.map((item) => <button type="button" key={item.id} onClick={() => setSelected(item.id)} className={selected === item.id ? 'selected' : ''}>{item.kind === 'text' ? '文字' : item.kind === 'image' ? '图片' : item.kind === 'path' ? '矢量路径' : '色块'} · {title(item)}</button>)}</div>
        {picked && <div className="selected-editor"><h3>选中：{title(picked)}</h3><div className="inline-fields">{fields.map((field) => <label key={field}>{field} mm<input type="number" min="0" value={picked[field]} onChange={(event) => changeElement({ [field]: number(event.target.value, picked[field]) })}/></label>)}</div>{picked.kind === 'text' && <><label>文字<textarea value={picked.text} onChange={(event) => changeElement({ text: event.target.value })}/></label><label>字号 mm<input type="number" value={picked.fontSizeMm} onChange={(event) => changeElement({ fontSizeMm: number(event.target.value, picked.fontSizeMm) })}/></label></>}{picked.kind !== 'image' && <label>颜色<input type="color" value={picked.kind === 'text' ? picked.color : picked.fill} onChange={(event) => changeElement(picked.kind === 'text' ? { color: event.target.value } : { fill: event.target.value })}/></label>}<div className="button-pair"><button type="button" disabled={project.elements[0]?.id === picked.id} onClick={() => moveLayer(-1)}>下移一层</button><button type="button" disabled={project.elements.at(-1)?.id === picked.id} onClick={() => moveLayer(1)}>上移一层</button><button type="button" onClick={() => { mutate({ elements: project.elements.filter((item) => item.id !== picked.id) }); setSelected(null) }}>删除此元素</button></div></div>}
        {picked?.kind === 'image' && <div className="selected-editor"><h3>从选中图片提取纯色 SVG（实验）</h3><p className="tiny-note">只适合简单色块或装饰轮廓。可点击下图取色；裁剪范围按图片自身的百分比填写：左、上、宽、高。不会自动识别 Logo 或恢复文字。</p><img className="trace-source-preview" src={project.assets.find((asset) => asset.id === picked.assetId)?.url} alt="点击原图选取目标颜色" onClick={(event) => { const image = event.currentTarget; const rect = image.getBoundingClientRect(); const x = Math.min(image.naturalWidth - 1, Math.max(0, Math.floor((event.clientX - rect.left) / rect.width * image.naturalWidth))); const y = Math.min(image.naturalHeight - 1, Math.max(0, Math.floor((event.clientY - rect.top) / rect.height * image.naturalHeight))); const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const context = canvas.getContext('2d')!; context.drawImage(image, x, y, 1, 1, 0, 0, 1, 1); const pixel = context.getImageData(0, 0, 1, 1).data; setTraceColor(`#${Array.from(pixel.slice(0, 3)).map((value) => value.toString(16).padStart(2, '0')).join('')}`); setTraceMask(null) }}/><div className="inline-fields">{['左 %', '上 %', '宽 %', '高 %'].map((label, index) => <label key={label}>{label}<input type="number" min="0" max="100" value={traceCrop[index]} onChange={(event) => { const next = [...traceCrop]; next[index] = Number(event.target.value); setTraceCrop(next); setTraceMask(null) }}/></label>)}</div><div className="inline-fields"><label>目标颜色<input type="color" value={traceColor} onChange={(event) => { setTraceColor(event.target.value); setTraceMask(null) }}/></label><label>容差（0–120）<input type="number" min="0" max="120" value={traceTolerance} onChange={(event) => { setTraceTolerance(Math.min(120, Math.max(0, Number(event.target.value)))); setTraceMask(null) }}/></label></div><div className="button-pair"><button type="button" disabled={busy} onClick={() => void previewTrace()}>预览提取蒙版</button><button type="button" disabled={busy || !traceMask || traceMask.sourceId !== picked.id} onClick={() => void confirmTrace()}>确认生成独立路径</button></div>{traceMask?.sourceId === picked.id && <img className="trace-mask-preview" src={traceMask.preview} alt="黑色区域会被描摹成矢量路径"/>}</div>}
        <div className="project-warnings">{project.warnings?.map((warning) => <p key={warning}>⚠ {warning}</p>)}</div>
        {picked && <div className="button-pair"><button type="button" disabled={busy || picked.kind === 'image'} onClick={() => void perform(async () => { downloadElementSvg(picked); setMessage('选中元素已导出为独立设计资产；文字未转曲，图片未自动矢量化。') })}>下载选中元素 SVG</button><small>实验功能：支持独立文字、色块和已导入的矢量路径；路径可在矢量软件继续编辑，但尺寸及轮廓须复核。图片不能直接导出为真矢量。</small></div>}
        <div className="button-pair"><button type="button" disabled={busy || project.elements.length === 0} onClick={() => void perform(async () => { const saved = await saveProject({ ...project, status: 'approved' }); setProject(saved); await refreshRows(); setMessage('平面稿已确认。导出仍只是设计中间稿。') })}>确认平面稿</button><button type="button" disabled={busy || project.status !== 'approved'} onClick={() => void exportFile('svg')}>下载 SVG</button><button type="button" disabled={busy || project.status !== 'approved'} onClick={() => void exportFile('psd')}>下载分层 PSD</button><button type="button" disabled={busy || project.status !== 'approved'} onClick={() => void exportFile('png')}>下载 PNG</button></div>
        <p className="tiny-note">SVG 保留文字对象和色块；PSD 为分层位图，文字原文保存在本站项目内，PSD 文字层本身不保证可编辑。尺寸、材质、出血、刀线、字体及生产工艺仍需人工复核。</p>
      </div>
    </div>}
    {message && <p role="status" className="workspace-message">{message}</p>}
  </section>
}
