import { useEffect, useRef, useState } from 'react'
import { Canvas, FabricImage, Rect, Textbox } from 'fabric'
import { generateImage } from '../lib/api'
import { createProject, getProject, listProjects, saveProject, uploadAsset, type Project, type ProjectRow, type WallElement } from '../lib/projects'
import { downloadPreview, downloadPsd, downloadSvg } from '../lib/exports'
import type { Aspect, ImageModelChoice } from '../types'

const uid = () => crypto.randomUUID()
const number = (value: string, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback
const fields = ['x', 'y', 'width', 'height'] as const
const title = (item: WallElement) => item.kind === 'text' ? item.text.slice(0, 16) : item.label

export function ProjectWorkspace({ modelChoice, modelLabel }: { modelChoice: ImageModelChoice; modelLabel: string }) {
  const [rows, setRows] = useState<ProjectRow[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedAssets, setSelectedAssets] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const canvasElement = useRef<HTMLCanvasElement>(null)
  const canvasRef = useRef<Canvas | null>(null)
  const currentProject = useRef<Project | null>(null)
  currentProject.current = project

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
  const load = (id: string) => perform(async () => { setProject(await getProject(id)); setSelected(null); setSelectedAssets([]) })
  const create = () => perform(async () => {
    const name = window.prompt('项目名称', '新文化墙项目')?.trim()
    if (!name) return
    setProject(await createProject(name)); await refreshRows(); setSelected(null)
  })
  const addElement = (element: WallElement) => { if (!project) return; mutate({ elements: [...project.elements, element] }); setSelected(element.id) }
  const changeElement = (patch: Partial<WallElement>) => {
    if (!project || !selected) return
    mutate({ elements: project.elements.map((item) => item.id === selected ? { ...item, ...patch } as WallElement : item) })
  }
  const picked = project?.elements.find((item) => item.id === selected)

  useEffect(() => {
    if (!canvasElement || !canvasElement.current || !project) return
    const scale = Math.min(840 / project.widthMm, 560 / project.heightMm)
    const width = Math.max(1, Math.round(project.widthMm * scale))
    const height = Math.max(1, Math.round(project.heightMm * scale))
    const board = new Canvas(canvasElement.current, { width, height, backgroundColor: '#ffffff', selection: false })
    canvasRef.current = board
    for (const obstacle of project.obstacles) board.add(new Rect({
      left: obstacle.x * scale, top: obstacle.y * scale, width: obstacle.width * scale,
      height: obstacle.height * scale, fill: 'rgba(224,72,54,.12)', stroke: '#d54a36',
      strokeDashArray: [6, 4], selectable: false, evented: false,
    }))
    let cancelled = false
    const add = async (item: WallElement) => {
      const common = { left: item.x * scale, top: item.y * scale, selectable: true, lockScalingX: true, lockScalingY: true, lockRotation: true }
      let object: Rect | Textbox | FabricImage
      if (item.kind === 'rect') object = new Rect({ ...common, width: item.width * scale, height: item.height * scale, fill: item.fill })
      else if (item.kind === 'text') object = new Textbox(item.text || '文字', { ...common, width: item.width * scale, fontSize: item.fontSizeMm * scale, fill: item.color, fontFamily: 'Arial', editable: false })
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
      setProject({ ...latest, elements: latest.elements.map((item) => item.id === id ? { ...item, x, y } : item), status: 'draft' })
    })
    return () => { cancelled = true; board.dispose(); canvasRef.current = null }
  }, [project?.id, project?.widthMm, project?.heightMm, project?.obstacles, project?.elements, project?.assets])

  const makeConcept = (role: 'space' | 'flat') => perform(async () => {
    if (!project) return
    const saved = await save(project)
    const urls = selectedAssets.slice(0, role === 'flat' ? 2 : 3).map((id) => saved.assets.find((item) => item.id === id)?.url).filter((url): url is string => Boolean(url))
    if (role === 'flat') {
      const prior = [...saved.concepts].reverse().find((item) => item.role === 'space')
      if (prior) urls.push(prior.imageUrl)
    }
    const references = await Promise.all(urls.slice(0, 3).map(async (url, index) => {
      const response = await fetch(url)
      if (!response.ok) throw new Error('参考图读取失败')
      const blob = await response.blob()
      return new File([blob], `reference-${index}.png`, { type: blob.type })
    }))
    const prompt = [
      role === 'space' ? '生成文化墙空间概念效果图；仅用于视觉探索，不作为文字、尺寸或施工依据。' : '生成正视视觉候选图；保持墙体大致比例，不包含透视；准确尺寸和文案将由设计师在可编辑画布重建。',
      `墙体宽 ${saved.widthMm} 毫米、高 ${saved.heightMm} 毫米。`,
      `障碍物：${saved.obstacles.map((item) => `${item.label}，距左 ${item.x}、距上 ${item.y}、宽 ${item.width}、高 ${item.height} 毫米`).join('；') || '无'}。`,
      `设计要求：${saved.notes || '简洁清晰'}。`,
      `需呈现的文案（图中如有错字，后续以可编辑平面稿为准）：${saved.copy || '无'}。`,
    ].join('\n').slice(0, 1200)
    const aspect: Aspect = saved.widthMm / saved.heightMm > 1.2 ? 'landscape' : saved.heightMm / saved.widthMm > 1.2 ? 'portrait' : 'square'
    const result = await generateImage({ prompt, style: 'brand', aspect, references, modelChoice })
    const next = await saveProject({ ...saved, concepts: [...saved.concepts, { id: result.id, imageUrl: result.imageUrl, provider: result.provider || 'unknown', model: result.model || 'unknown', role, createdAt: result.createdAt }] })
    setProject(next); await refreshRows()
    setMessage('概念图已生成并保存。请在平面稿中重新输入准确文字和坐标。')
  })
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
      <button type="button" onClick={create} disabled={busy}>新建项目</button>
      {project && <button type="button" onClick={() => void perform(async () => { await save() })} disabled={busy}>保存项目</button>}
    </div>
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
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void perform(async () => { const saved = await save(project); const result = await uploadAsset(saved, file); setProject(result.project); setMessage('素材已上传，只有此受邀账号可读取。') }); event.target.value = '' }}/>
        {project.assets.map((asset) => <label key={asset.id} className="asset-row"><input type="checkbox" checked={selectedAssets.includes(asset.id)} onChange={(event) => setSelectedAssets(event.target.checked ? [...selectedAssets, asset.id].slice(0, 3) : selectedAssets.filter((id) => id !== asset.id))}/><img src={asset.url} alt="素材缩略图"/><span>{asset.name}</span></label>)}
        <p className="tiny-note">勾选素材才会在点击生成时发送给当前生图服务。请先确认素材使用授权。</p>
        <p className="tiny-note">概念图使用上方所选模型：{modelLabel || '正在读取…'}</p>
        <div className="button-pair"><button type="button" disabled={busy || !modelLabel} onClick={() => void makeConcept('space')}>生成空间概念</button><button type="button" disabled={busy || !modelLabel} onClick={() => void makeConcept('flat')}>生成正视候选</button></div>
      </div>
      <div className="project-editor">
        <div className="concept-strip">{project.concepts.map((item) => <div key={item.id}><img src={item.imageUrl} alt={item.role === 'space' ? '空间概念' : '正视候选'}/><small>{item.role === 'space' ? '空间概念' : '正视候选'}</small></div>)}</div>
        <h3>可编辑正视图 <small>以 mm 定位；拖动元素后保存</small></h3>
        <div className="wall-scroll"><canvas ref={canvasElement}/></div>
        <div className="button-pair">
          <button type="button" onClick={() => addElement({ id: uid(), kind: 'rect', x: 100, y: 100, width: 500, height: 250, fill: '#1e4561', label: '装饰' })}>添加色块</button>
          <button type="button" onClick={() => addElement({ id: uid(), kind: 'text', x: 100, y: 100, width: 900, height: 150, fontSizeMm: 90, text: '准确文案', color: '#183d58' })}>添加文字</button>
          <select aria-label="添加图片素材" value="" onChange={(event) => { if (event.target.value) addElement({ id: uid(), kind: 'image', assetId: event.target.value, x: 100, y: 100, width: 500, height: 400, label: '图片' }) }}><option value="">添加图片素材…</option>{project.assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select>
        </div>
        <div className="element-picks">{project.elements.map((item) => <button type="button" key={item.id} onClick={() => setSelected(item.id)} className={selected === item.id ? 'selected' : ''}>{item.kind === 'text' ? '文字' : item.kind === 'image' ? '图片' : '色块'} · {title(item)}</button>)}</div>
        {picked && <div className="selected-editor"><h3>选中：{title(picked)}</h3><div className="inline-fields">{fields.map((field) => <label key={field}>{field} mm<input type="number" min="0" value={picked[field]} onChange={(event) => changeElement({ [field]: number(event.target.value, picked[field]) })}/></label>)}</div>{picked.kind === 'text' && <><label>文字<textarea value={picked.text} onChange={(event) => changeElement({ text: event.target.value })}/></label><label>字号 mm<input type="number" value={picked.fontSizeMm} onChange={(event) => changeElement({ fontSizeMm: number(event.target.value, picked.fontSizeMm) })}/></label></>}{picked.kind !== 'image' && <label>颜色<input type="color" value={picked.kind === 'text' ? picked.color : picked.fill} onChange={(event) => changeElement(picked.kind === 'text' ? { color: event.target.value } : { fill: event.target.value })}/></label>}<button type="button" onClick={() => { mutate({ elements: project.elements.filter((item) => item.id !== picked.id) }); setSelected(null) }}>删除此元素</button></div>}
        <div className="project-warnings">{project.warnings?.map((warning) => <p key={warning}>⚠ {warning}</p>)}</div>
        <div className="button-pair"><button type="button" disabled={busy || project.elements.length === 0} onClick={() => void perform(async () => { const saved = await saveProject({ ...project, status: 'approved' }); setProject(saved); await refreshRows(); setMessage('平面稿已确认。导出仍只是设计中间稿。') })}>确认平面稿</button><button type="button" disabled={busy || project.status !== 'approved'} onClick={() => void exportFile('svg')}>下载 SVG</button><button type="button" disabled={busy || project.status !== 'approved'} onClick={() => void exportFile('psd')}>下载分层 PSD</button><button type="button" disabled={busy || project.status !== 'approved'} onClick={() => void exportFile('png')}>下载 PNG</button></div>
        <p className="tiny-note">SVG 保留文字对象和色块；PSD 为分层位图，文字原文保存在本站项目内，PSD 文字层本身不保证可编辑。尺寸、材质、出血、刀线、字体及生产工艺仍需人工复核。</p>
      </div>
    </div>}
    {message && <p role="status" className="workspace-message">{message}</p>}
  </section>
}
