import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import sharp from 'sharp'
import { config } from '../config.ts'
import { requireInvite } from '../security/invites.ts'
import { vectorizeRouter } from './vectorize.ts'

const realFetch = globalThis.fetch
const original = { vectorizerChannel: config.vectorizerChannel, vectorizerEnabled: config.vectorizerEnabled, vectorizerApiId: config.vectorizerApiId, vectorizerApiSecret: config.vectorizerApiSecret, vectorizerMode: config.vectorizerMode, vectorizerResultsDir: config.vectorizerResultsDir, requireInvites: config.requireInvites }
let server: Server, base: string, temporary: string, png: Buffer
let upstreamStatus = 200
const safeSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20"><path fill="#1a2f7c" d="M1 1H29V19H1Z"/></svg>'
let upstreamSvg = safeSvg
const upstream = vi.fn(async () => upstreamStatus === 200 ? new Response(upstreamSvg, { headers: { 'x-credits-charged': '0' } }) : Response.json({ error: 'private' }, { status: upstreamStatus }))
beforeEach(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), 'wall-vectorizer-test-'))
  Object.assign(config, { vectorizerChannel: 'official', vectorizerEnabled: true, vectorizerApiId: 'test-id', vectorizerApiSecret: 'test-secret', vectorizerMode: 'test', vectorizerResultsDir: temporary, requireInvites: false })
  upstreamStatus = 200; upstreamSvg = safeSvg; upstream.mockClear()
  vi.stubGlobal('fetch', (url: Parameters<typeof fetch>[0], init?: RequestInit) => String(url).startsWith('https://api.vectorizer.ai/') ? upstream() : realFetch(url, init))
  png = await sharp({ create: { width: 30, height: 20, channels: 3, background: 'white' } }).png().toBuffer()
  const app = express(); app.use(requireInvite); app.use('/api/vectorize', vectorizeRouter)
  server = createServer(app)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/vectorize`
})
afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  await rm(temporary, { recursive: true, force: true })
  Object.assign(config, original); vi.unstubAllGlobals()
})
function form() { const f = new FormData(); f.set('mask', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'selection.png'); return f }
describe('high-quality vector HTTP boundary', () => {
  it('retains unsafe raw response privately and returns a recoverable task instead of losing the paid output', async () => {
    upstreamSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><script>alert(1)</script></svg>'
    const submitted = await fetch(`${base}/high-quality`, { method: 'POST', body: form() })
    expect(submitted.status).toBe(202)
    const task = await submitted.json()
    expect(task.status).toBe('needs_repair')
    const raw = await fetch(`${base}/tasks/${task.id}/raw`)
    expect(raw.headers.get('content-type')).toContain('application/octet-stream')
    expect(raw.headers.get('content-disposition')).toContain('.txt')
    expect(await raw.text()).toBe(upstreamSvg)
    expect((await fetch(`${base}/tasks/${task.id}/preview`)).status).toBe(404)
    const reprocessed = await (await fetch(`${base}/tasks/${task.id}/reprocess`, { method: 'POST' })).json()
    expect(reprocessed.status).toBe('needs_repair')
    const repeated = await (await fetch(`${base}/high-quality`, { method: 'POST', body: form() })).json()
    expect(repeated.id).toBe(task.id)
    expect(repeated.cached).toBe(true)
    expect(upstream).toHaveBeenCalledTimes(1)
  })
  it('shows saved task history and rejects an unconfirmed paid override', async () => {
    const task = await (await fetch(`${base}/high-quality`, { method: 'POST', body: form() })).json()
    expect(await (await fetch(`${base}/tasks`)).json()).toMatchObject([{ id: task.id, status: 'ready' }])
    expect((await (await fetch(`${base}/tasks/${task.id}`)).json()).svg).toContain('<path')
    const forced = form(); forced.set('force', '1')
    expect((await fetch(`${base}/high-quality`, { method: 'POST', body: forced })).status).toBe(400)
    expect(upstream).toHaveBeenCalledTimes(1)
  })
  it('processes upload, sanitizes and stores SVG and serves a protected download', async () => {
    const response = await fetch(`${base}/high-quality`, { method: 'POST', body: form() })
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result).toMatchObject({ provider: 'vectorizerai', mode: 'test', pathCount: 1, chargedCredits: '0' })
    const id = result.url.split('/').at(-1)
    expect(await readFile(path.join(temporary, 'local-dev', `${id}.svg`), 'utf8')).toBe(result.svg)
    const download = await fetch(`${base}/results/${id}`)
    expect(download.headers.get('content-disposition')).toContain('attachment')
    expect(await download.text()).toBe(result.svg)
    const foreignId = '11111111-1111-4111-8111-111111111111'
    await mkdir(path.join(temporary, 'other-user'))
    await writeFile(path.join(temporary, 'other-user', `${foreignId}.svg`), result.svg)
    expect((await fetch(`${base}/results/${foreignId}`)).status).toBe(404)
    config.requireInvites = true
    expect((await fetch(`${base}/results/${id}`)).status).toBe(401)
    expect((await fetch(`${base}/high-quality`, { method: 'POST', body: form() })).status).toBe(401)
    expect(upstream).toHaveBeenCalledTimes(1)
  })
  it('does not call upstream or count disabled requests', async () => {
    config.vectorizerEnabled = false
    const status = await (await fetch(`${base}/providers`)).json()
    expect(status.vectorizerai.available).toBe(false)
    expect(JSON.stringify(status)).not.toContain('test-secret')
    expect((await fetch(`${base}/high-quality`, { method: 'POST', body: form() })).status).toBe(503)
    expect(upstream).not.toHaveBeenCalled()
  })
  it('rejects mode override and invalid parameters before calling upstream', async () => {
    const invalid = form(); invalid.set('mode', 'production')
    expect((await fetch(`${base}/high-quality`, { method: 'POST', body: invalid })).status).toBe(400)
    expect(upstream).not.toHaveBeenCalled()
  })
  it.each([402, 429])('returns upstream %s clearly without automatic retry', async status => {
    upstreamStatus = status
    const response = await fetch(`${base}/high-quality`, { method: 'POST', body: form() })
    expect(response.status).toBe(status)
    expect((await response.json()).error).toContain(`HTTP ${status}`)
    expect(upstream).toHaveBeenCalledTimes(1)
  })
})
