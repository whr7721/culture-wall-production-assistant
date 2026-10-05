import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../../config.ts'
import { generateWithAlibaba } from './alibaba.ts'
import { generateWithRelay } from './relay.ts'
import { generateWithKami } from './kami.ts'
import { imageModelOptions, resolveImageModelChoice } from '../imageModels.ts'

const original = { relayKey: config.imageApiKey, alibabaKey: config.alibabaApiKey, alibabaBaseUrl: config.alibabaBaseUrl, kamiKey: config.kamiApiKey }
const input = { prompt: '文化墙概念图测试', size: '1024x1024', references: [] as Express.Multer.File[] }
const reference = { mimetype: 'image/png', buffer: Buffer.from('aabb'), size: 4, originalname: 'wall.png' } as Express.Multer.File

beforeEach(() => {
  config.imageApiKey = 'test-relay-key'
  config.alibabaApiKey = 'test-alibaba-key'
  config.alibabaBaseUrl = 'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
  config.kamiApiKey = 'test-kami-key'
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ url: 'https://example.com/result.png' }] })))
})
afterEach(() => {
  config.imageApiKey = original.relayKey
  config.alibabaApiKey = original.alibabaKey
  config.alibabaBaseUrl = original.alibabaBaseUrl
  config.kamiApiKey = original.kamiKey
  vi.unstubAllGlobals()
})

describe('provider adapters', () => {
  it('relay uses separate generation and multipart edit endpoints', async () => {
    await generateWithRelay(input)
    await generateWithRelay({ ...input, references: [reference] })
    const calls = vi.mocked(fetch).mock.calls
    expect(String(calls[0][0])).toContain('/v1/images/generations')
    expect(String(calls[1][0])).toContain('/v1/images/edits')
    expect(calls[1][1]?.body).toBeInstanceOf(FormData)
  })

  it('alibaba uses generations JSON for text and reference editing', async () => {
    await generateWithAlibaba(input)
    await generateWithAlibaba({ ...input, references: [reference] })
    const calls = vi.mocked(fetch).mock.calls
    expect(String(calls[0][0])).toContain('/images/generations')
    expect(String(calls[1][0])).toContain('/images/generations')
    const first = JSON.parse(String(calls[0][1]?.body)) as Record<string, unknown>
    const second = JSON.parse(String(calls[1][1]?.body)) as { image: string[] }
    expect(first.image).toBeUndefined()
    expect(second.image[0]).toMatch(/^data:image\/png;base64,/)
    expect(calls[1][1]?.headers).toMatchObject({ 'Content-Type': 'application/json' })
  })

  it('only accepts configured model choices', () => {
    expect(resolveImageModelChoice('kami-banana-4k')).toBe('kami-banana-4k')
    expect(resolveImageModelChoice('arbitrary-expensive-model')).toBeNull()
    expect(imageModelOptions()).toHaveLength(3)
    config.kamiApiKey = ''
    expect(resolveImageModelChoice('kami-banana')).toBeNull()
  })

  it('Kami uses Gemini-native 4K image config and inline references', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ candidates: [{ content: { parts: [{ inlineData: { data: 'aGVsbG8=' } }] } }] })))
    const output = await generateWithKami({ ...input, size: '1536x1024', references: [reference] }, 'gemini-3-pro-image-preview', '4K')
    expect(output).toMatchObject({ provider: 'kami', image: { b64_json: 'aGVsbG8=' } })
    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/v1beta/models/gemini-3-pro-image-preview:generateContent')
    const body = JSON.parse(String(options?.body)) as { contents: Array<{ parts: Array<{ inlineData?: { data: string } }> }>; generationConfig: { imageConfig: { imageSize: string; aspectRatio: string } } }
    expect(body.generationConfig.imageConfig).toEqual({ imageSize: '4K', aspectRatio: '3:2' })
    expect(body.contents[0].parts[1].inlineData?.data).toBe(reference.buffer.toString('base64'))
  })
})
