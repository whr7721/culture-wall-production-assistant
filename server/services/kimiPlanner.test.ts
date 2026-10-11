import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../config.ts'
import { planWithKimi } from './kimiPlanner.ts'
import { plannerInputSchema } from '../../shared/planner.ts'

const input = { brief: '设计专颜媄肤医疗文化墙，保留品牌故事和承诺', exactCopy: '专颜媄肤\n我们的承诺Our Prosime', widthMm: 3500, heightMm: 2300 }
const suggestion = { summary: '建议两栏布局', zones: [{ title: '品牌故事', content: '保留原文' }], questions: ['Our Prosime 是否需要纠正？'], warnings: ['效果图汉字须复核'], imagePrompt: '生成米白深蓝文化墙正视候选图，保持品牌素材。' }
const originalKey = config.kimiApiKey
beforeEach(() => {
  config.kimiApiKey = 'test-only-secret'
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(suggestion) } }] })))
})
afterEach(() => { config.kimiApiKey = originalKey; vi.unstubAllGlobals() })

describe('Kimi requirement planner', () => {
  it('calls official API once, with instructions and typed image content', async () => {
    const reference = { buffer: Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]), mimetype: 'image/jpeg' } as Express.Multer.File
    const result = await planWithKimi(input, [reference])
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://api.moonshot.cn/v1/chat/completions')
    const body = JSON.parse(String(options?.body))
    expect(body.model).toBe(config.kimiModel)
    expect(body.messages[0].content).toContain('不可改写')
    expect(body.messages[1].content[1].image_url.url).toMatch(/^data:image\/png;base64,/)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(result.source).toEqual(input)
    expect(JSON.stringify(result)).not.toContain('test-only-secret')
  })
  it('ignores model attempts to overwrite original copy and dimensions', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ ...suggestion, source: { widthMm: 999, exactCopy: '改字' } }) } }] }))
    expect((await planWithKimi(input, [])).source).toEqual(input)
  })
  it('rejects invalid JSON, missing fields, oversized prompts and truncated output', async () => {
    for (const content of ['not-json', '{}', JSON.stringify({ ...suggestion, imagePrompt: '长'.repeat(1201) })]) {
      vi.mocked(fetch).mockResolvedValue(Response.json({ choices: [{ finish_reason: 'stop', message: { content } }] }))
      await expect(planWithKimi(input, [])).rejects.toThrow()
    }
    vi.mocked(fetch).mockResolvedValue(Response.json({ choices: [{ finish_reason: 'length', message: { content: JSON.stringify(suggestion) } }] }))
    await expect(planWithKimi(input, [])).rejects.toThrow('KIMI_INCOMPLETE')
  })
  it('does not retry upstream failures or expose their response bodies', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('secret upstream body', { status: 429 }))
    await expect(planWithKimi(input, [])).rejects.toThrow('KIMI_HTTP_429')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('rejects fake images before making an API request', async () => {
    await expect(planWithKimi(input, [{ buffer: Buffer.from('fake') } as Express.Multer.File])).rejects.toThrow('INVALID_REFERENCE')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('validates positive dimensions and input length', () => {
    expect(plannerInputSchema.safeParse(input).success).toBe(true)
    for (const invalid of [{ widthMm: 0 }, { heightMm: NaN }, { brief: '短' }, { exactCopy: '字'.repeat(6001) }]) {
      expect(plannerInputSchema.safeParse({ ...input, ...invalid }).success).toBe(false)
    }
  })
  it('normalizes multipart CRLF without changing characters or layout lines', () => {
    expect(plannerInputSchema.parse({ ...input, exactCopy: '专颜媄肤\r\nOur Prosime' }).exactCopy).toBe('专颜媄肤\nOur Prosime')
  })
  it('uses K3 reasoning effort instead of K2 thinking parameters', async () => {
    const previous = config.kimiModel
    try {
      config.kimiModel = 'kimi-k3'
      await planWithKimi(input, [])
      const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))
      expect(body.reasoning_effort).toBe('low')
      expect(body.thinking).toBeUndefined()
    } finally { config.kimiModel = previous }
  })
})
