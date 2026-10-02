import { useMemo, useState } from 'react'
import { ReferenceUploader } from './components/ReferenceUploader'
import { ResultPanel } from './components/ResultPanel'
import { generateImage } from './lib/api'
import { loadHistory, saveHistory } from './lib/history'
import type { Aspect, GenerationResult, StylePreset } from './types'

const styles: Array<{ id: StylePreset; title: string; caption: string }> = [
  { id: 'brand', title: '品牌简约', caption: '克制留白 · 清晰层级' },
  { id: 'technology', title: '现代科技', caption: '灯光材质 · 空间感' },
  { id: 'humanistic', title: '人文党建', caption: '叙事展陈 · 稳重秩序' },
]

const aspects: Array<{ id: Aspect; title: string; caption: string }> = [
  { id: 'landscape', title: '横版', caption: '1536 × 1024' },
  { id: 'square', title: '方形', caption: '1024 × 1024' },
  { id: 'portrait', title: '竖版', caption: '1024 × 1536' },
]

export function App() {
  const [prompt, setPrompt] = useState('')
  const [style, setStyle] = useState<StylePreset>('brand')
  const [aspect, setAspect] = useState<Aspect>('landscape')
  const [references, setReferences] = useState<File[]>([])
  const [result, setResult] = useState<GenerationResult | null>(null)
  const [history, setHistory] = useState<GenerationResult[]>(loadHistory)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const canSubmit = useMemo(() => prompt.trim().length >= 10 && !isLoading, [prompt, isLoading])

  const submit = async () => {
    if (!canSubmit) return
    setError('')
    setIsLoading(true)
    try {
      const next = await generateImage({ prompt: prompt.trim(), style, aspect, references })
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
      const blob = await response.blob()
      const file = new File([blob], `generation-${item.id}.png`, { type: blob.type || 'image/png' })
      setReferences([file, ...references].slice(0, 3))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      setError('读取生成图片失败，请先下载后再上传。')
    }
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="墙绘工坊首页">
          <span className="brand-mark"><i /><i /><i /></span>
          <span><strong>墙绘工坊</strong><small>CULTURE WALL STUDIO</small></span>
        </a>
        <div className="header-note"><span>受邀试用版</span> · 上传素材会发送至第三方生图服务</div>
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
            </div>

            <ReferenceUploader files={references} onChange={setReferences} />

            <div className="field-group">
              <div className="field-heading"><div><span className="step-number">03</span><label>选择视觉方向</label></div></div>
              <div className="option-grid three">
                {styles.map((item) => (
                  <button key={item.id} className={`option-card ${style === item.id ? 'selected' : ''}`} type="button" onClick={() => setStyle(item.id)}>
                    <strong>{item.title}</strong><small>{item.caption}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="field-group compact">
              <div className="field-heading"><div><span className="step-number">04</span><label>画面方向</label></div></div>
              <div className="option-grid three">
                {aspects.map((item) => (
                  <button key={item.id} className={`aspect-card ${aspect === item.id ? 'selected' : ''}`} type="button" onClick={() => setAspect(item.id)}>
                    <i className={`ratio-icon ${item.id}`} /><span><strong>{item.title}</strong><small>{item.caption}</small></span>
                  </button>
                ))}
              </div>
            </div>

            <button className="generate-button" type="button" disabled={!canSubmit} onClick={submit}>
              <span>{isLoading ? '正在生成提案…' : '生成文化墙提案'}</span><b>↗</b>
            </button>
            {prompt.length > 0 && prompt.trim().length < 10 && <small className="validation-copy">请至少输入 10 个字，让 AI 更准确理解需求。</small>}
          </section>

          <ResultPanel result={result} isLoading={isLoading} error={error} onUseAsReference={useResultAsReference} />
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
      </main>

      <footer><span>墙绘工坊 MVP · 效果图用于方向沟通</span><span>生产深化能力正在真实案例中验证</span></footer>
    </div>
  )
}
