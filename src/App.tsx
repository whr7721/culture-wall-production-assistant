import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { ReferenceUploader } from './components/ReferenceUploader'
import { ResultPanel } from './components/ResultPanel'
import { RequirementPlanner } from './components/RequirementPlanner'
import { generateImage, getImageModels } from './lib/api'
import { loadHistory, saveHistory } from './lib/history'
import { imageSizeForWall } from '../shared/imageSize'
import type { Aspect, GenerationResult, ImageModelChoice, ImageModelOption, StylePreset } from './types'

const styles: Array<{ id: StylePreset; title: string; caption: string }> = [
  { id: 'brand', title: '品牌简约', caption: '克制留白 · 清晰层级' },
  { id: 'technology', title: '现代科技', caption: '灯光材质 · 空间感' },
  { id: 'humanistic', title: '人文党建', caption: '叙事展陈 · 稳重秩序' },
]

const ProjectWorkspace = lazy(() => import('./components/ProjectWorkspace').then((module) => ({ default: module.ProjectWorkspace })))

export function App() {
  const [prompt, setPrompt] = useState('')
  const [style, setStyle] = useState<StylePreset>('brand')
  const [wallWidth, setWallWidth] = useState('')
  const [wallHeight, setWallHeight] = useState('')
  const [shortTitle, setShortTitle] = useState('')
  const [task, setTask] = useState<'space' | 'flat'>('space')
  const [exactCopy, setExactCopy] = useState('')
  const [references, setReferences] = useState<File[]>([])
  const [result, setResult] = useState<GenerationResult | null>(null)
  const [history, setHistory] = useState<GenerationResult[]>(loadHistory)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [modelChoice, setModelChoice] = useState<ImageModelChoice>('default')
  const [modelOptions, setModelOptions] = useState<ImageModelOption[]>([])
  const [workspaceImport, setWorkspaceImport] = useState<{ token: string; result: GenerationResult; widthMm: number; heightMm: number } | null>(null)

  useEffect(() => {
    let disposed = false
    let retry: ReturnType<typeof setTimeout> | undefined
    const loadModels = async () => {
      try {
        const models = await getImageModels()
        if (disposed) return
        setModelOptions(models)
        setError((message) => message === '模型列表暂时不可用，正在自动重试。' ? '' : message)
      } catch {
        if (disposed) return
        setError((message) => message || '模型列表暂时不可用，正在自动重试。')
        retry = setTimeout(() => void loadModels(), 5000)
      }
    }
    void loadModels()
    return () => { disposed = true; if (retry) clearTimeout(retry) }
  }, [])

  const customSize = imageSizeForWall(Number(wallWidth), Number(wallHeight))
  const ratio = Number(wallWidth) / Number(wallHeight)
  const isBanana = modelChoice.startsWith('kami-')
  const aspect: Aspect = isBanana ? Math.abs(Math.log(ratio)) <= Math.min(Math.abs(Math.log(ratio / 1.5)), Math.abs(Math.log(ratio / (2 / 3)))) ? 'square' : ratio > 1 ? 'landscape' : 'portrait' : 'custom'
  const selectedModel = modelOptions.find((item) => item.id === modelChoice)
  const canSubmit = useMemo(() => prompt.trim().length >= 10 && !isLoading && Boolean(selectedModel?.available) && Boolean(customSize), [prompt, isLoading, selectedModel, customSize])

  const submit = async () => {
    if (!canSubmit) return
    setError('')
    setIsLoading(true)
    try {
      if (task === 'flat' && references.length === 0) throw new Error('请上传原效果图作为第一张参考图。')
      const next = await generateImage({ prompt: prompt.trim(), style, aspect, references, size: aspect === 'custom' ? customSize || undefined : undefined, shortTitle: shortTitle.trim(), modelChoice, task, exactCopy, wallWidthMm: Number(wallWidth), wallHeightMm: Number(wallHeight) })
      const nextHistory = [next, ...history.filter((item) => item.id !== next.id)].slice(0, 8)
      setResult(next)
      setHistory(nextHistory)
      saveHistory(nextHistory)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '生成过程中出现未知错误')
    } finally {
      setIsLoading(false)
    }
  }

  const useResultAsReference = async (item: GenerationResult) => {
    try {
      const response = await fetch(item.imageUrl)
      if (!response.ok) throw new Error('读取图片失败')
      const blob = await response.blob()
      const file = new File([blob], `generation-${item.id}.png`, { type: blob.type || 'image/png' })
      setReferences([file, ...references].slice(0, 3))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      setError('读取生成图片失败，请先下载后再上传。')
    }
  }

  const prepareFlat = async (item: GenerationResult) => {
    try {
      const response = await fetch(item.imageUrl)
      if (!response.ok) throw new Error('读取原效果图失败')
      const blob = await response.blob()
      setReferences([new File([blob], `source-${item.id}.png`, { type: blob.type || 'image/png' })])
      setTask('flat')
      setPrompt(`保持原效果图构图、图形和文字，仅转换为二维正视平面候选。原需求：${item.prompt}`.slice(0, 1200))
      setExactCopy(item.exactCopy || '')
      if (item.wallWidthMm && item.wallHeightMm) {
        setWallWidth(String(item.wallWidthMm)); setWallHeight(String(item.wallHeightMm))
      }
      setError('')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch { setError('读取原效果图失败，请下载后手动上传。') }
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="墙绘工坊首页">
          <span className="brand-mark"><i /><i /><i /></span>
          <span><strong>墙绘工坊</strong><small>CULTURE WALL STUDIO</small></span>
        </a>
        <div className="header-note"><span>受邀试用版</span> · 点击生成时参考图会发送至第三方生图服务</div>
      </header>

      <main id="top">
        <section className="intro">
          <div>
            <span className="eyebrow">AI CONCEPT WORKSPACE</span>
            <h1>把一面空墙，<br />变成能沟通的视觉提案。</h1>
          </div>
          <p>上传现场与品牌素材，用一段自然语言快速生成文化墙效果图。先验证方向，再进入准确排版和生产深化。</p>
        </section>

        <div className="workspace-grid">
          <section className="control-panel">
            <div className="field-group">
              <label htmlFor="generation-task">生成任务</label>
              <select id="generation-task" className="model-select" value={task} onChange={(event) => setTask(event.target.value as 'space' | 'flat')}>
                <option value="space">生成上墙空间效果图（包含文案）</option>
                <option value="flat">效果图转二维正视候选（保留图形和文字）</option>
              </select>
              <small className="field-help">转换时第一张参考图必须是原效果图。准备转换不会立即扣费，确认后再点击生成。</small>
            </div>
            <div className="field-group">
              <div className="field-heading">
                <div><span className="step-number">01</span><label htmlFor="prompt">描述你的文化墙</label></div>
                <span>{prompt.length}/1200</span>
              </div>
              <textarea
                id="prompt"
                value={prompt}
                maxLength={1200}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="例如：为科技园区大厅设计一面 8 米宽的企业文化墙，深蓝与银灰配色，左侧品牌故事，中部发展历程，右侧核心价值观……"
              />
              <div className="prompt-tips"><span>建议包含</span><b>墙体结构</b><b>行业</b><b>主要内容</b><b>材质/色彩</b></div>
              <label className="short-title-field" htmlFor="short-title">重点标题（可不填，不限制其他文案）</label>
              <input id="short-title" value={shortTitle} maxLength={16} onChange={(event) => setShortTitle(event.target.value)} placeholder="例如：创新引领未来" />
              <label htmlFor="exact-copy">上墙文字（可选，提供原文更准确）</label>
              <textarea id="exact-copy" value={exactCopy} maxLength={6000} onChange={(event) => setExactCopy(event.target.value)} placeholder="公司名称、时间线、品牌故事等逐字粘贴在这里。图形和文字一起生成，不自动改写原文。" />
              <small className="field-help">{exactCopy.length}/6000 · 全部文案直接传给生图模型，不再默认无字。长段中文、Logo和复杂图形仍可能出错，请核对。</small>
            </div>

            <ReferenceUploader files={references} onChange={setReferences} />
            <RequirementPlanner brief={prompt} references={references} exactCopy={exactCopy} onApply={(nextPrompt, copy, width, height) => { setPrompt(nextPrompt); setExactCopy(copy); setWallWidth(String(width)); setWallHeight(String(height)) }} disabled={isLoading} />

            <div className="field-group compact">
              <div className="field-heading"><div><span className="step-number">03</span><label htmlFor="image-model">生图模型</label></div></div>
              <select id="image-model" className="model-select" value={modelChoice} onChange={(event) => setModelChoice(event.target.value as ImageModelChoice)}>
                {modelOptions.map((item) => <option key={item.id} value={item.id} disabled={!item.available}>{item.label}{item.available ? '' : ' · 待配置'}</option>)}
              </select>
              <small className="field-help">{selectedModel?.detail || '正在读取可用模型…'}。4K 指模型输出档位，不代表墙体实际制作尺寸；不同模型费用可能不同。</small>
            </div>

            <div className="field-group">
              <div className="field-heading"><div><span className="step-number">04</span><label>选择视觉方向</label></div></div>
              <div className="option-grid three">
                {styles.map((item) => (
                  <button key={item.id} className={`option-card ${style === item.id ? 'selected' : ''}`} type="button" onClick={() => setStyle(item.id)}>
                    <strong>{item.title}</strong><small>{item.caption}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="field-group compact">
              <div className="field-heading"><div><span className="step-number">05</span><label>画面方向</label></div></div>
              <div className="custom-size-fields">
                <label>墙面宽度 mm<input aria-label="墙面宽度" type="number" min="1" max="100000" value={wallWidth} onChange={(event) => setWallWidth(event.target.value)}/></label>
                <span>×</span>
                <label>墙面高度 mm<input aria-label="墙面高度" type="number" min="1" max="100000" value={wallHeight} onChange={(event) => setWallHeight(event.target.value)}/></label>
              </div>
              <small className={customSize ? 'field-help' : 'validation-copy'}>{customSize ? `目标比例 ${ratio.toFixed(3)}:1；系统自动选择${isBanana ? '最接近的模型预设比例' : `${customSize} px`}。毫米尺寸会保留，像素比例有取整误差，不代表施工精度。` : '应用Kimi整理结果自动填入，或手动填写墙面宽、高（毫米）；目前支持宽高比1:3至3:1。'}</small>
              {isBanana && customSize && <small className="validation-copy">此模型目前只能按最接近的1:1、3:2或2:3生成，不能严格匹配墙面比例；如需贴近比例请选Image模型。</small>}
            </div>

            <button className="generate-button" type="button" disabled={!canSubmit} onClick={submit}>
              <span>{isLoading ? '正在生成提案…' : task === 'flat' ? '生成二维正视候选' : '生成文化墙提案'}</span><b>↗</b>
            </button>
            {prompt.length > 0 && prompt.trim().length < 10 && <small className="validation-copy">请至少输入 10 个字，让 AI 更准确理解需求。</small>}
          </section>

          <ResultPanel result={result} isLoading={isLoading} error={error} onUseAsReference={useResultAsReference} onFlatten={prepareFlat} onOpenWorkspace={(item) => {
            const width = item.wallWidthMm || Number(wallWidth)
            const height = item.wallHeightMm || Number(wallHeight)
            if (!(width > 0 && width <= 50000 && height > 0 && height <= 20000)) { setError('请先在05确认墙面尺寸；工作台最大宽50000mm、高20000mm。'); return }
            setWorkspaceImport({ token: crypto.randomUUID(), result: item, widthMm: width, heightMm: height })
            document.querySelector('#projects')?.scrollIntoView({ behavior: 'smooth' })
          }} />
        </div>

        {history.length > 0 && (
          <section className="history-section">
            <div className="section-heading"><div><span className="eyebrow">RECENT</span><h2>最近方案</h2></div><span>仅保存在此浏览器</span></div>
            <div className="history-grid">
              {history.map((item) => (
                <button type="button" key={item.id} onClick={() => setResult(item)}>
                  <img src={item.imageUrl} alt="历史文化墙方案" />
                  <span>{new Date(item.createdAt).toLocaleString('zh-CN')}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        <Suspense fallback={<p>正在载入可编辑工作台…</p>}><ProjectWorkspace importRequest={workspaceImport} /></Suspense>
      </main>

      <footer><span>墙绘工坊 MVP · 效果图用于方向沟通</span><span>生产深化能力正在真实案例中验证</span></footer>
    </div>
  )
}
