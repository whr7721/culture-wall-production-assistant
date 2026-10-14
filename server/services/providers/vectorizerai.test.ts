import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { config } from '../../config.ts'
import { vectorizeWithVectorizerAI, vectorizerOptionsSchema, vectorizerStatus } from './vectorizerai.ts'
const original = { vectorizerChannel: config.vectorizerChannel, vectorizer302ApiKey: config.vectorizer302ApiKey, vectorizerEnabled: config.vectorizerEnabled, vectorizerApiId: config.vectorizerApiId, vectorizerApiSecret: config.vectorizerApiSecret, vectorizerMode: config.vectorizerMode, vectorizerEndpoint: config.vectorizerEndpoint }
const sample = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><g fill="none" stroke="#1a2f7c" stroke-width="1"><circle cx="10" cy="10" r="5"/><path d="M25 5L35 15"/></g></svg>'
let png: Buffer
beforeEach(async () => {
  Object.assign(config, { vectorizerChannel: 'official', vectorizer302ApiKey: '', vectorizerEnabled: true, vectorizerApiId: 'test-id', vectorizerApiSecret: 'test-secret', vectorizerMode: 'test', vectorizerEndpoint: 'https://api.vectorizer.ai/api/v1/vectorize' })
  png = await sharp({ create: { width: 40, height: 20, channels: 4, background: '#ffffff' } }).png().toBuffer()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(sample, { headers: { 'Content-Type': 'image/svg+xml', 'X-Credits-Charged': '0' } })))
})
afterEach(() => { Object.assign(config, original); vi.unstubAllGlobals() })
describe('Vectorizer.AI adapter', () => {
  it('302 uses its documented endpoint and Bearer key, reusing SVG parameters and cleaning', async () => {
    Object.assign(config, { vectorizerChannel: '302', vectorizer302ApiKey: 'test-302-key', vectorizerMode: 'production', vectorizerApiId: '', vectorizerApiSecret: '' })
    const result = await vectorizeWithVectorizerAI(png, vectorizerOptionsSchema.parse({ 'output.group_by': 'parent' }))
    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toBe('https://api.302.ai/vectorizer/api/v1/vectorize')
    expect(options?.headers).toEqual({ Authorization: 'Bearer test-302-key' })
    expect((options?.body as FormData).get('output.group_by')).toBe('parent')
    expect((options?.body as FormData).get('mode')).toBe('production')
    expect(result).toMatchObject({ channel: '302', mode: 'production', pathCount: 2 })
    expect(vectorizerStatus().freeTest).toBe(false)
    expect(result.warnings.join()).not.toContain('免费')
  })
  it('302 requires its own key and production selection; never pretends relay test calls are free', async () => {
    config.vectorizerChannel = '302'
    expect(vectorizerStatus().available).toBe(false)
    config.vectorizer302ApiKey = 'test-302-key'
    expect(vectorizerStatus().available).toBe(false)
    await expect(vectorizeWithVectorizerAI(png, vectorizerOptionsSchema.parse({}))).rejects.toMatchObject({ status: 503 })
    expect(fetch).not.toHaveBeenCalled()
    config.vectorizerChannel = 'unknown'
    expect(vectorizerStatus().available).toBe(false)
  })
  it('does not accept JSON placeholder responses as a successful SVG', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({})))
    await expect(vectorizeWithVectorizerAI(png, vectorizerOptionsSchema.parse({}))).rejects.toThrow('上游返回JSON')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('sends official dotted parameters, Basic credentials, test mode and binary input', async () => {
    const result = await vectorizeWithVectorizerAI(png, vectorizerOptionsSchema.parse({ 'output.draw_style': 'stroke_edges', 'processing.palette': '#1a2f7c;#ffffff;', 'processing.max_colors': '2', 'output.group_by': 'parent' }))
    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toBe(config.vectorizerEndpoint)
    expect(options?.headers).toEqual({ Authorization: `Basic ${Buffer.from('test-id:test-secret').toString('base64')}` })
    expect(options?.redirect).toBe('error')
    const form = options?.body as FormData
    expect(form.get('mode')).toBe('test')
    expect(form.get('processing.max_colors')).toBe('2')
    expect(form.get('processing.palette')).toBe('#1a2f7c;#ffffff;')
    expect(form.get('output.draw_style')).toBe('stroke_edges')
    expect(form.get('output.group_by')).toBe('parent')
    expect(form.get('output.svg.adobe_compatibility_mode')).toBe('true')
    expect(form.get('output.parameterized_shapes.flatten')).toBe('false')
    expect(form.get('image')).toBeInstanceOf(Blob)
    expect(result).toMatchObject({ mode: 'test', pathCount: 2, width: 40, height: 20, chargedCredits: '0' })
    expect(result.svg).not.toContain('<circle')
    expect(result.svg).toContain('stroke="#1a2f7c"')
    expect(result.warnings.join()).toContain('水印')
  })
  it('stays disabled without flag or credentials; rejects unknown modes and insecure endpoints before sending', async () => {
    config.vectorizerEnabled = false
    expect(vectorizerStatus().available).toBe(false)
    await expect(vectorizeWithVectorizerAI(png, vectorizerOptionsSchema.parse({}))).rejects.toMatchObject({ status: 503 })
    config.vectorizerEnabled = true; config.vectorizerApiSecret = ''
    await expect(vectorizeWithVectorizerAI(png, vectorizerOptionsSchema.parse({}))).rejects.toMatchObject({ status: 503 })
    config.vectorizerApiSecret = 'test-secret'; config.vectorizerMode = 'preview'
    await expect(vectorizeWithVectorizerAI(png, vectorizerOptionsSchema.parse({}))).rejects.toMatchObject({ status: 503 })
    config.vectorizerMode = 'test'; config.vectorizerEndpoint = 'http://api.vectorizer.ai/api/v1/vectorize'
    await expect(vectorizeWithVectorizerAI(png, vectorizerOptionsSchema.parse({}))).rejects.toMatchObject({ status: 503 })
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each([402, 429])('exposes HTTP %s without retry or leaking upstream messages', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'private account detail' }, { status })))
    await expect(vectorizeWithVectorizerAI(png, vectorizerOptionsSchema.parse({}))).rejects.toMatchObject({ status, message: expect.stringContaining(`HTTP ${status}`) })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it.each(['<script>alert(1)</script>', '<image href="https://example.com/image.png"/>', '<path d="M0 0L10 10" onload="alert(1)"/>'])('rejects unsafe upstream SVG: %s', async body => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">${body}</svg>`)))
    await expect(vectorizeWithVectorizerAI(png, vectorizerOptionsSchema.parse({}))).rejects.toThrow('清洗')
  })
  it('does not accept browser mode or vendor-specific aliases; validates palette and colors', () => {
    for (const input of [{ mode: 'production' }, { vectorizerMaxColors: 2 }, { 'processing.max_colors': 257 }, { 'processing.max_colors': 1.5 }, { 'processing.palette': 'url(https://example.com)' }]) expect(vectorizerOptionsSchema.safeParse(input).success).toBe(false)
    expect(vectorizerOptionsSchema.parse({ 'processing.palette': '#00000000;' })['processing.palette']).toBe('#00000000;')
  })
  it('uses production only when explicitly configured on the server', async () => {
    config.vectorizerMode = 'production'
    await vectorizeWithVectorizerAI(png, vectorizerOptionsSchema.parse({}))
    expect((vi.mocked(fetch).mock.calls[0][1]?.body as FormData).get('mode')).toBe('production')
  })
})
