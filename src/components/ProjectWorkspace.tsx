import { useEffect, useRef, useState } from 'react'
import { Canvas, FabricImage, Rect, Textbox, Path } from 'fabric'
import { importSvgPaths, svgPhysicalSize } from '../lib/importSvg'
import { archiveProject, createProject, getProject, listProjects, saveProject, uploadAsset, type Project, type ProjectRow, type WallElement } from '../lib/projects'
import { draftStore } from '../lib/projectDrafts'
import { textObject, fontFamilies } from '../lib/textLayout'
import { downloadPreview, downloadPsd, downloadSvg, downloadElementSvg } from '../lib/exports'
import type { GenerationResult } from '../types'
import { VectorExtractor } from './VectorExtractor'
import { TextExtractor } from './TextExtractor'

const uid = () => crypto.randomUUID()
const number = (value: string, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback
const fields = ['x', 'y', 'width', 'height'] as const
const title = (item: WallElement) => item.kind === 'text' ? item.text.slice(0, 16) : item.label

export function ProjectWorkspace({ importRequest }: { importRequest: { token: string; result: GenerationResult; widthMm: number; heightMm: number } | null }) {
  const [rows, setRows] = useState<ProjectRow[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [owner, setOwner] = useState('')
  const [dirty, setDirty] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [capacity, setCapacity] = useState(20)
  const [importTarget, setImportTarget] = useState('')
  const [svgImport, setSvgImport] = useState<{ source: string; width: number; height: number; ratio: number; locked: boolean } | null>(null)
  const undo = useRef<Project[]>([]), redo = useRef<Project[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const operationActive = useRef(false)
  const [zoom, setZoom] = useState(1)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('新文化墙项目')
  const canvasElement = useRef<HTMLCanvasElement>(null)
  const canvasRef = useRef<Canvas | null>(null)
  const currentProject = useRef<Project | null>(null)
  currentProject.current = project
  const importedToken = useRef('')
  useEffect(() => { void fetch('/api/projects/session').then(r => r.json()).then(data => setOwner(data.username)).catch(() => setMessage('无法读取账号，草稿保护尚未就绪')) }, [])
  useEffect(() => {
    if (!dirty || !project || !owner) return
    try { draftStore.write(owner, project) } catch { setMessage('浏览器草稿空间不足，请立即保存到服务器') }
  }, [project, dirty, owner])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const leave = () => {
    if (!dirty) return true
    if (project && owner) { try { draftStore.write(owner, project) } catch { setMessage('草稿保存失败，请先保存到服务器'); return false } }
    return window.confirm('当前修改尚未保存，已保留浏览器草稿。继续切换？')
  }
  const accept = (next: Project) => { setProject(next); currentProject.current = next; setDirty(false); undo.current = []; redo.current = []; setSelected(null) }

  useEffect(() => {
    if (!importRequest || !owner || importedToken.current === importRequest.token) return
    importedToken.current = importRequest.token
    if (!leave()) return
    void perform(async () => {
      const { result, widthMm, heightMm } = importRequest
      const response = await fetch(result.imageUrl)
      if (!response.ok) throw new Error('读取生成结果失败，未更改已有项目')
      const blob = await response.blob()
      let next = importTarget ? await getProject(importTarget) : await createProject(`${result.task === 'flat' ? '正视候选' : '空间效果'}-${new Date().toLocaleString('zh-CN')}`)
      // Appending to an existing project keeps its dimensions and previous elements.
      if (!importTarget) next = await saveProject({ ...next, widthMm, heightMm, copy: result.exactCopy || '', notes: result.prompt, measurementStatus: 'to_measure' })
      const uploaded = await uploadAsset(next, new File([blob], `生成结果-${result.id}.png`, { type: blob.type || 'image/png' }))
      next = uploaded.project
      const asset = next.assets.at(-1)!
      next = await saveProject({ ...next, status: 'draft', elements: [...next.elements, ...(result.task === 'flat' ? [{ id: uid(), kind: 'image' as const, assetId: asset.id, x: 0, y: 0, width: next.widthMm, height: next.heightMm, label: '正视候选整图（未分层）' }] : [])], concepts: [...next.concepts, { id: result.id, imageUrl: result.imageUrl, provider: result.provider || 'unknown', model: result.model || 'unknown', role: result.task === 'flat' ? 'flat' : 'space', createdAt: result.createdAt }] })
      accept(next); await refreshRows()
      setMessage(importTarget ? '已将结果追加到指定项目。' : '已带入图片、尺寸和文案并保存为新项目。')
    })
  }, [importRequest, owner])

  useEffect(() => { void refreshRows().catch((error) => setMessage(error.message)) }, [])
  const mutate = (patch: Partial<Project>) => {
    const old = currentProject.current
    if (!old || old.archived) return
    undo.current = [...undo.current.slice(-39), old]; redo.current = []
    const next = { ...old, ...patch, status: 'draft' as const }
    currentProject.current = next; setProject(next); setDirty(true)
  }
  const travel = (direction: 'undo' | 'redo') => {
    const source = direction === 'undo' ? undo : redo, target = direction === 'undo' ? redo : undo
    const next = source.current.pop(); if (!next || !project) return
    target.current.push(project); setProject({ ...next, revision: project.revision, status: 'draft' }); setDirty(true)
  }
  const refreshRows = async () => { setRows(await listProjects()); const response = await fetch('/api/projects/capacity'); if (response.ok) setCapacity((await response.json()).limit) }
  const perform = async (action: () => Promise<void>) => {
    if (operationActive.current) return
    operationActive.current = true
    setBusy(true); setMessage('')
    try { await action() } catch (error) { setMessage(error instanceof Error ? error.message : '操作失败') }
    finally { operationActive.current = false; setBusy(false) }
  }
  const save = async (candidate = project): Promise<Project> => {
    if (!candidate) throw new Error('请先创建项目')
    const saved = await saveProject(candidate)
    accept(saved); if (owner) draftStore.remove(owner, saved.id)
    await refreshRows()
    setMessage('已保存到服务器，可重新打开继续编辑。')
    return saved
  }
  const load = (id: string) => { if (id && leave()) void perform(async () => {
    const saved = await getProject(id), draft = owner ? draftStore.read(owner, id) : null
    accept(saved)
    if (draft && !saved.archived && window.confirm(draft.revision !== saved.revision ? '本机草稿与服务器新版本不同。恢复后保存将覆盖服务器设计内容，是否恢复草稿供核对？' : '发现此项目的本机草稿，是否恢复？')) {
      setProject({ ...draft, revision: saved.revision, assets: saved.assets }); setDirty(true)
      setMessage(draft.revision !== saved.revision ? '服务器已有新版本；已恢复草稿供比较，保存将覆盖设计内容，请核对。' : '已恢复未保存草稿。')
    }
  }) }
  const create = () => perform(async () => {
    const name = newName.trim()
    if (!name) return
    if (!leave()) return
    accept(await createProject(name)); await refreshRows(); setShowCreate(false)
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
      if (item.kind === 'path') object = new Path(item.d, { ...common, fill: item.fill === 'none' ? null : item.fill, fillRule: item.fillRule || 'nonzero', strokeLineCap: item.strokeLineCap || 'butt', strokeLineJoin: item.strokeLineJoin || 'miter', stroke: item.stroke === 'none' ? null : item.stroke, strokeWidth: item.strokeWidth, scaleX: item.width * scale / item.sourceWidth, scaleY: item.height * scale / item.sourceHeight })
      else if (item.kind === 'rect') object = new Rect({ ...common, width: item.width * scale, height: item.height * scale, fill: item.fill })
      else if (item.kind === 'text') { object = textObject(item); object.set({ ...common, scaleX: scale, scaleY: scale, editable: false, lockScalingY: true }) }
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
      mutate({ elements: latest.elements.map((item) => item.id === id ? { ...item, x, y, width, height: item.kind === 'text' ? item.height : height } : item) })
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
      <select aria-label="选择项目" disabled={busy || !owner} value={project?.id || ''} onChange={(event) => void load(event.target.value)}>
        <option value="">选择已有项目</option>{rows.filter(row => showArchived || !row.archived || row.id === project?.id).map((row) => <option key={row.id} value={row.id}>{row.title} · {row.archived ? '已归档' : row.status === 'approved' ? '已确认' : '草稿'}</option>)}
      </select>
      <button type="button" onClick={() => { setShowCreate(true); setMessage('') }} disabled={busy}>新建项目</button>
      {project && <button type="button" onClick={() => void perform(async () => { await save() })} disabled={busy || project.archived}>保存项目</button>}
      <label className="check"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)}/>显示归档</label>
      <span>{rows.filter(row => !row.archived).length}/{capacity} 使用中 · {dirty ? '未保存（本机草稿）' : '已保存'}</span>
      {project && <><button type="button" disabled={busy} onClick={() => { if (!leave() || !window.confirm(project.archived ? '恢复此项目？' : '归档此项目？所有素材会保留，可随时恢复。')) return; void perform(async () => { accept(await archiveProject(project, !project.archived)); await refreshRows() }) }}>{project.archived ? '恢复项目' : '归档项目'}</button><button type="button" disabled={busy || !undo.current.length || project.archived} onClick={() => travel('undo')}>撤销</button><button type="button" disabled={busy || !redo.current.length || project.archived} onClick={() => travel('redo')}>重做</button></>}
      <label>上方结果带入<select aria-label="生成结果目标项目" value={importTarget} onChange={e => setImportTarget(e.target.value)}><option value="">新建项目</option>{rows.filter(row => !row.archived).map(row => <option key={row.id} value={row.id}>{row.title}</option>)}</select></label>
    </div>
    {showCreate && <form className="project-toolbar" onSubmit={(event) => { event.preventDefault(); void create() }}>
      <label>新项目名称<input aria-label="新项目名称" autoFocus value={newName} maxLength={80} onChange={(event) => setNewName(event.target.value)} /></label>
      <button type="submit" disabled={busy || !newName.trim()}>创建项目</button>
      <button type="button" disabled={busy} onClick={() => setShowCreate(false)}>取消</button>
    </form>}
    {project && <fieldset className="project-layout" disabled={busy || project.archived} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
      <div className="project-controls">
        <label>项目名<input value={project.title} maxLength={80} onChange={(event) => mutate({ title: event.target.value })}/></label>
        <div className="inline-fields"><label>墙宽 mm<input type="number" min="1" value={project.widthMm} onChange={(event) => mutate({ widthMm: number(event.target.value, project.widthMm) })}/></label><label>墙高 mm<input type="number" min="1" value={project.heightMm} onChange={(event) => mutate({ heightMm: number(event.target.value, project.heightMm) })}/></label></div>
        <label className="check"><input type="checkbox" checked={project.measurementStatus === 'confirmed'} onChange={(event) => mutate({ measurementStatus: event.target.checked ? 'confirmed' : 'to_measure' })}/>尺寸已现场复尺</label>
        <details>
          <summary>原始需求与文案</summary>
          <p className="tiny-note">上方生成结果带入时自动留存，供查看、复制和核对；修改这里不会改变画布或重新生图。</p>
          <label>客户原始文案<textarea rows={4} value={project.copy} onChange={(event) => mutate({ copy: event.target.value })}/></label>
          <label>生成时的设计要求<textarea rows={3} value={project.notes} onChange={(event) => mutate({ notes: event.target.value })}/></label>
        </details>
        <h3>墙体障碍物</h3>
        {project.obstacles.map((item) => <div key={item.id} className="element-row"><input aria-label="障碍物名称" value={item.label} onChange={(event) => mutate({ obstacles: project.obstacles.map((o) => o.id === item.id ? { ...o, label: event.target.value } : o) })}/>{fields.map((field) => <input key={field} aria-label={field} type="number" title={field} value={item[field]} onChange={(event) => mutate({ obstacles: project.obstacles.map((o) => o.id === item.id ? { ...o, [field]: number(event.target.value, o[field]) } : o) })}/>)}<button type="button" onClick={() => mutate({ obstacles: project.obstacles.filter((o) => o.id !== item.id) })}>×</button></div>)}
        <button type="button" onClick={() => mutate({ obstacles: [...project.obstacles, { id: uid(), label: '门/缺口', x: 100, y: 100, width: 500, height: 800 }] })}>添加门／缺口</button>
        <h3>素材（图片会保存在服务器）</h3>
        <label>导入 SVG 矢量路径<input aria-label="导入SVG独立路径" type="file" accept=".svg,image/svg+xml" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void perform(async () => { if (file.size > 1_000_000) throw new Error('SVG需小于1MB'); const source = await file.text(), size = svgPhysicalSize(source); setSvgImport({ source, ...size, ratio: size.width / size.height, locked: true }) }); event.target.value = '' }}/></label>
        {svgImport && <div className="svg-import-size"><label>导入宽 mm<input type="number" value={svgImport.width} onChange={e => { const width = Number(e.target.value); setSvgImport({ ...svgImport, width, height: svgImport.locked ? width / svgImport.ratio : svgImport.height }) }}/></label><label>导入高 mm<input type="number" value={svgImport.height} onChange={e => { const height = Number(e.target.value); setSvgImport({ ...svgImport, height, width: svgImport.locked ? height * svgImport.ratio : svgImport.width }) }}/></label><label className="check"><input type="checkbox" checked={svgImport.locked} onChange={e => setSvgImport({ ...svgImport, locked: e.target.checked })}/>保持比例</label><button type="button" onClick={() => void perform(async () => { if (!(svgImport.width > 0 && svgImport.height > 0)) throw new Error('请输入有效尺寸'); const elements = await importSvgPaths(svgImport.source, svgImport.width); const correction = svgImport.height / (svgImport.width / svgImport.ratio); if (project.elements.length + elements.length > 120) throw new Error('项目最多120个对象'); mutate({ elements: [...project.elements, ...elements.map(item => ({ ...item, y: item.y * correction, height: item.height * correction }))] }); setSvgImport(null); setSelected(elements[0].id) })}>确认导入尺寸</button></div>}
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void perform(async () => { const saved = await save(project); const result = await uploadAsset(saved, file); setProject(result.project); setMessage('素材已上传，只有此受邀账号可读取。') }); event.target.value = '' }}/>
        {project.assets.map((asset) => <div key={asset.id} className="asset-row"><img src={asset.url} alt="素材缩略图"/><span>{asset.name}</span></div>)}
      </div>
      <div className="project-editor">
        <div className="concept-strip">{project.concepts.map((item) => <div key={item.id}><img src={item.imageUrl} alt={item.role === 'space' ? '空间概念' : '正视候选'}/><small>{item.role === 'space' ? '空间概念' : '正视候选'}</small></div>)}</div>
        <h3>可编辑正视图 <small>以 mm 定位；拖动或拉角调整后保存</small></h3>
        <div className="button-pair" aria-label="画布缩放"><button type="button" onClick={() => setZoom((value) => Math.max(0.5, Math.round((value - 0.25) * 100) / 100))}>缩小</button><button type="button" onClick={() => setZoom(1)}>适合窗口</button><button type="button" onClick={() => setZoom((value) => Math.min(3, Math.round((value + 0.25) * 100) / 100))}>放大</button><span>{Math.round(zoom * 100)}%</span></div>
        <div className="wall-scroll" style={{ pointerEvents: busy || project.archived ? 'none' : undefined }}><canvas ref={canvasElement}/></div>
        <div className="button-pair">
          <button type="button" onClick={() => addElement({ id: uid(), kind: 'rect', x: 100, y: 100, width: 500, height: 250, fill: '#1e4561', label: '装饰' })}>添加色块</button>
          <button type="button" onClick={() => addElement({ id: uid(), kind: 'text', x: 100, y: 100, width: 900, height: 150, fontSizeMm: 90, text: '准确文案', color: '#183d58' })}>添加文字</button>
          <select aria-label="添加图片素材" value="" onChange={(event) => { const asset = project.assets.find(a => a.id === event.target.value); if (asset) void perform(async () => { const image = new Image(); image.src = asset.url; await image.decode(); const width = Math.min(500, project.widthMm), height = width * image.naturalHeight / image.naturalWidth; addElement({ id: uid(), kind: 'image', assetId: asset.id, x: 0, y: 0, width, height, label: asset.name }) }) }}><option value="">添加图片素材…</option>{project.assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select>
        </div>
        <div className="element-picks">{project.elements.map((item) => <button type="button" key={item.id} onClick={() => setSelected(item.id)} className={selected === item.id ? 'selected' : ''}>{item.kind === 'text' ? '文字' : item.kind === 'image' ? '图片' : item.kind === 'path' ? '矢量路径' : '色块'} · {title(item)}</button>)}</div>
        {picked && <div className="selected-editor"><h3>选中：{title(picked)}</h3><div className="inline-fields">{fields.map((field) => <label key={field}>{field} mm<input type="number" min="0" value={picked[field]} onChange={(event) => changeElement({ [field]: number(event.target.value, picked[field]) })}/></label>)}</div>{picked.kind === 'text' && <><label>文字<textarea value={picked.text} onChange={(event) => changeElement({ text: event.target.value })}/></label><label>字号 mm<input type="number" value={picked.fontSizeMm} onChange={(event) => changeElement({ fontSizeMm: number(event.target.value, picked.fontSizeMm) })}/></label><label>旋转角度 °<input type="number" min="-180" max="180" value={picked.rotationDeg || 0} onChange={(event) => changeElement({ rotationDeg: number(event.target.value, picked.rotationDeg || 0) })}/></label>{picked.ocrScore !== undefined && <p className="tiny-note">OCR 置信度 {Math.round(picked.ocrScore * 100)}%；已识别文字请人工核对。</p>}</>}{picked.kind !== 'image' && <label>{picked.kind === 'path' && picked.fill === 'none' ? '描边颜色' : '颜色'}<input type="color" value={picked.kind === 'text' ? picked.color : picked.kind === 'path' && picked.fill === 'none' ? picked.stroke === 'none' ? '#000000' : picked.stroke : picked.fill} onChange={(event) => changeElement(picked.kind === 'text' ? { color: event.target.value } : picked.kind === 'path' && picked.fill === 'none' ? { stroke: event.target.value } : { fill: event.target.value })}/></label>}<div className="button-pair"><button type="button" disabled={project.elements[0]?.id === picked.id} onClick={() => moveLayer(-1)}>下移一层</button><button type="button" disabled={project.elements.at(-1)?.id === picked.id} onClick={() => moveLayer(1)}>上移一层</button><button type="button" onClick={() => { mutate({ elements: project.elements.filter((item) => item.id !== picked.id) }); setSelected(null) }}>删除此元素</button></div></div>}
        {picked?.kind === 'image' && <><TextExtractor key={`ocr:${project.id}:${picked.id}`} projectId={project.id} item={picked} url={project.assets.find((asset) => asset.id === picked.assetId)?.url || ''} remaining={120 - project.elements.length} onAdd={(elements) => { mutate({ elements: [...project.elements, ...elements] }); setSelected(elements[0]?.id || null); setMessage(`已加入 ${elements.length} 个可编辑文字对象，请逐字核对并保存。原图片仍含旧文字。`) }}/><VectorExtractor key={[project.id, picked.id, picked.x, picked.y, picked.width, picked.height].join(':')} projectId={project.id} item={picked} url={project.assets.find((asset) => asset.id === picked.assetId)?.url || ''} remaining={120 - project.elements.length} onAdd={(elements, keepSource) => { mutate({ elements: [...project.elements.filter((item) => keepSource || item.id !== picked.id), ...elements] }); setSelected(elements[0]?.id || null); setMessage(`已加入 ${elements.length} 个可编辑轮廓，请保存项目。可分别移动、改色、下载 SVG。`) }}/></>}
        {picked?.kind === 'text' && <label>字体<select value={picked.fontFamily || 'Microsoft YaHei'} onChange={e => changeElement({ fontFamily: e.target.value })}>{fontFamilies.map(font => <option key={font}>{font}</option>)}</select></label>}
        {picked && <div className="button-pair"><button type="button" disabled={busy || picked.kind === 'image'} onClick={() => void perform(async () => { downloadElementSvg(picked); setMessage('已导出独立SVG。') })}>下载选中元素 SVG</button></div>}
        <div className="button-pair"><button type="button" disabled={busy || project.elements.length === 0} onClick={() => void perform(async () => { if (project.measurementStatus !== 'confirmed') throw new Error('请先勾选“尺寸已现场复尺”，再确认平面稿'); await save({ ...project, status: 'approved' }); setMessage('平面稿已确认，可以导出。') })}>确认平面稿</button><button type="button" disabled={busy} onClick={() => void exportFile('svg')}>下载 SVG</button><button type="button" disabled={busy} onClick={() => void exportFile('psd')}>下载分层 PSD</button><button type="button" disabled={busy} onClick={() => void exportFile('png')}>下载 PNG</button></div>
        <details><summary>导出说明</summary><p>SVG保留文字和路径，位图仍为图片；目标软件需安装所选字体，PSD文字为位图层，PNG/PSD最长边1600px。</p><p>尺寸、轮廓、材料与工艺需生产前复核。</p></details>
      </div>
    </fieldset>}
    {message && <p role="status" className="workspace-message">{message}</p>}
  </section>
}
