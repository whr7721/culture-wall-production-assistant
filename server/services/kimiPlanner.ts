import { readFile } from 'node:fs/promises'
import { config } from '../config.ts'
import { detectedImageMime } from '../security/imageValidation.ts'
import { plannerSuggestionSchema, type PlannerInput, type PlannerResult } from '../../shared/planner.ts'

export async function planWithKimi(input: PlannerInput, references: Express.Multer.File[]): Promise<PlannerResult> {
  const instructions = await readFile(new URL('../prompts/culture-wall-planner.md', import.meta.url), 'utf8')
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: JSON.stringify(input) }]
  for (const file of references) {
    const mime = detectedImageMime(file.buffer)
    if (!mime) throw new Error('INVALID_REFERENCE')
    content.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${file.buffer.toString('base64')}` } })
  }
  // 固定官方国内端点；不自动重试，不接受浏览器指定供应商或密钥。
  const response = await fetch('https://api.moonshot.cn/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.kimiApiKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(config.kimiTimeoutMs),
    body: JSON.stringify({ model: config.kimiModel, messages: [{ role: 'system', content: instructions }, { role: 'user', content }], ...(config.kimiModel === 'kimi-k3' ? { reasoning_effort: 'low' } : { thinking: { type: 'disabled' }, temperature: 0.6 }), max_completion_tokens: 4000, response_format: { type: 'json_object' } }),
  })
  if (!response.ok) throw new Error(`KIMI_HTTP_${response.status}`)
  const payload = await response.json() as { choices?: Array<{ finish_reason?: string; message?: { content?: string } }> }
  const choice = payload.choices?.[0]
  if (choice?.finish_reason !== 'stop' || typeof choice.message?.content !== 'string') throw new Error('KIMI_INCOMPLETE')
  const suggestion = plannerSuggestionSchema.parse(JSON.parse(choice.message.content))
  // 原始文字与尺寸由本程序回填，不信任模型改写。
  return { ...suggestion, source: input, model: config.kimiModel, instructionVersion: 'culture-wall-planner-v1' }
}
