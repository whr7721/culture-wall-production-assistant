import { useEffect, useState } from 'react'
import type { PlannerResult } from '../../shared/planner'

export function RequirementPlanner({ brief, references, exactCopy, onApply, disabled }: { brief: string; references: File[]; exactCopy: string; onApply: (prompt: string, exactCopy: string, widthMm: number, heightMm: number) => void; disabled: boolean }) {
  const [available, setAvailable] = useState(false)
  const [widthMm, setWidthMm] = useState('')
  const [heightMm, setHeightMm] = useState('')
  const [authorized, setAuthorized] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<PlannerResult | null>(null)
  const [resultReferences, setResultReferences] = useState<File[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    void fetch('/api/planner/status').then(async (response) => {
      if (!response.ok) throw new Error('status')
      const status = await response.json() as { available: boolean }
      setAvailable(status.available)
    }).catch(() => setError('需求整理服务状态读取失败。'))
  }, [])
  const valid = brief.trim().length >= 10 && Number(widthMm) > 0 && Number(widthMm) <= 100000 && Number(heightMm) > 0 && Number(heightMm) <= 100000
  const changed = result && (result.source.brief !== brief.trim() || result.source.exactCopy !== exactCopy || result.source.widthMm !== Number(widthMm) || result.source.heightMm !== Number(heightMm) || references.length !== resultReferences.length || references.some((file, index) => file !== resultReferences[index]))
  const plan = async () => {
    setBusy(true); setError(''); setResult(null)
    try {
      const form = new FormData()
      form.set('brief', brief.trim()); form.set('exactCopy', exactCopy)
      form.set('authorized', '1')
      form.set('widthMm', widthMm); form.set('heightMm', heightMm)
      references.forEach((file) => form.append('references', file))
      const response = await fetch('/api/planner', { method: 'POST', body: form })
      const body = await response.json() as PlannerResult & { error?: string }
      if (!response.ok) throw new Error(body.error || '需求整理失败。')
      setResult(body)
      setResultReferences([...references])
    } catch (reason) { setError(reason instanceof Error ? reason.message : '需求整理失败。') }
    finally { setBusy(false) }
  }
  return <details className="field-group planner-panel">
    <summary>先用 Kimi 整理需求（可选）</summary>
    <p className="field-help">读取上方需求和参考图，给出分区、疑点与提示词；不自动生图，不保证准确排版。尺寸是客户输入，尚未核验。</p>
    <div className="custom-size-fields">
      <label>墙宽 mm<input aria-label="整理需求墙宽" type="number" min="1" max="100000" value={widthMm} onChange={(event) => setWidthMm(event.target.value)} /></label>
      <label>墙高 mm<input aria-label="整理需求墙高" type="number" min="1" max="100000" value={heightMm} onChange={(event) => setHeightMm(event.target.value)} /></label>
    </div>
    <p className="field-help">直接使用上方“上墙文字”原文，无需重复填写；若文案仅在参考截图中，请核对识别结果后补入原文。</p>
    <label><input type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} />我有权将这些文案和参考图片发送至 Kimi 官方服务，知悉本次整理独立计费。</label>
    {!available && <p className="field-help">管理员尚未启用 Kimi；现有生图仍可使用。</p>}
    <button type="button" disabled={!available || !authorized || !valid || busy || disabled} onClick={() => void plan()}>{busy ? '正在整理…' : '整理需求与提示词'}</button>
    {error && <p role="alert">{error}</p>}
    {result && <div aria-live="polite">
      <p>{result.summary}</p>
      <h4>建议分区</h4>
      {result.zones.map((zone, index) => <p key={index}><strong>{zone.title}</strong>：{zone.content}</p>)}
      <h4>待确认与风险</h4>
      {[...result.questions, ...result.warnings].map((item, index) => <p key={index}>· {item}</p>)}
      <label htmlFor="planner-output">生图提示词建议</label>
      <textarea id="planner-output" readOnly value={result.imagePrompt} />
      {changed && <p role="alert">输入已改变，请重新整理或核对旧建议。</p>}
      <button type="button" disabled={disabled || Boolean(changed)} onClick={() => onApply(result.imagePrompt, result.source.exactCopy, result.source.widthMm, result.source.heightMm)}>已核对，填入上方需求（不会自动生成）</button>
      <button type="button" onClick={() => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }))
        const link = document.createElement('a'); link.href = url; link.download = '文化墙需求整理.json'; link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }}>下载整理记录与原文</button>
      <small className="field-help">应用建议会同步提示词、文案原件和客户输入的墙面尺寸至生图表单；请在05确认尺寸。尺寸尚未复尺，也不会自动修改已有工作台项目。</small>
    </div>}
  </details>
}
