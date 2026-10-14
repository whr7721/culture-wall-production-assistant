import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import sharp from 'sharp'
import { config } from '../config.ts'
import * as provider from './providers/vectorizerai.ts'
import { submitVectorTask, getVectorTask, listVectorTasks, reprocessVectorTask, vectorBudget } from './vectorTasks.ts'
const original = { ...config }
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#11147d" d="M1 1H99V99H1Z"/></svg>'
let root: string, png: Buffer
const options = () => provider.vectorizerOptionsSchema.parse({})
const response = () => new Response(svg, { headers: { 'x-credits-charged': '1.000000', 'x-request-id': 'upstream-test-123' } })
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'wall-vector-tasks-'))
  Object.assign(config, { vectorizerResultsDir: root, vectorizerChannel: '302', vectorizerMode: 'production', vectorizerEnabled: true, vectorizer302ApiKey: 'not-a-real-key', vectorizerDailyLimit: 3, vectorizerDailyBudget: .9, vectorizerTotalBudget: 1, vectorizerMinIntervalMs: 0 })
  png = await sharp({ create: { width: 30, height: 20, channels: 3, background: 'white' } }).png().toBuffer()
  vi.stubGlobal('fetch', vi.fn(async () => response()))
})
afterEach(async () => { Object.assign(config, original); vi.restoreAllMocks(); vi.unstubAllGlobals(); await rm(root, { recursive: true, force: true }) })
describe('persistent vector tasks and spending guard', () => {
  it('saves raw response before cleaning and records estimated cost separately from engine credits', async () => {
    const task = await submitVectorTask('alice', png, options(), undefined, false, true)
    expect(task).toMatchObject({ status: 'ready', estimatedCost: .3, budgetUnit: 'PTC', actualCostKnown: false, chargedCredits: '1.000000', upstreamRequestId: 'upstream-test-123' })
    expect(await readFile(path.join(root, 'alice', 'tasks', task.id, 'response.txt'), 'utf8')).toBe(svg)
    const persisted = await readFile(path.join(root, 'alice', 'tasks', task.id, 'task.json'), 'utf8')
    expect(persisted).not.toContain('not-a-real-key')
    expect(await vectorBudget('alice')).toMatchObject({ dailyReserved: .3, totalReserved: .3, paidCallsToday: 1 })
  })
  it('reuses identical input and normalized options without a second paid request, even with budget paused', async () => {
    const first = await submitVectorTask('alice', png, options(), undefined, false, true)
    config.vectorizerDailyBudget = 0; config.vectorizerEnabled = false
    const reused = await submitVectorTask('alice', png, options(), undefined, false, true)
    expect(reused).toMatchObject({ id: first.id, status: 'ready', cached: true })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect((await listVectorTasks('alice')).length).toBe(1)
  })
  it('deduplicates concurrent submissions while the first request is in flight', async () => {
    let release!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { release = resolve })))
    const first = await submitVectorTask('alice', png, options())
    const duplicate = await submitVectorTask('alice', png, options())
    expect(duplicate).toMatchObject({ id: first.id, cached: true, status: 'running' })
    expect(fetch).toHaveBeenCalledTimes(1)
    release(response())
    const done = await submitVectorTask('alice', png, options(), undefined, false, true)
    expect(done.status).toBe('ready')
    expect((await vectorBudget('alice')).totalReserved).toBe(.3)
  })
  it('retains unsafe raw SVG as needs_repair and never exposes it as a clean preview or download', async () => {
    const unsafe = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><script>alert(1)</script></svg>'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(unsafe)))
    const task = await submitVectorTask('alice', png, options(), undefined, false, true)
    expect(task).toMatchObject({ status: 'needs_repair', rawComplete: true })
    expect(task.url).toBeUndefined(); expect(task.previewUrl).toBeUndefined(); expect(task.svg).toBeUndefined()
    expect(await readFile(path.join(root, 'alice', 'tasks', task.id, 'response.txt'), 'utf8')).toBe(unsafe)
    await reprocessVectorTask('alice', task.id)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect((await vectorBudget('alice')).totalReserved).toBe(.3)
    expect(await getVectorTask('bob', task.id)).toBeNull()
  })
  it('recovers a local processing failure using the captured response without another upstream call', async () => {
    const spy = vi.spyOn(provider, 'vectorizeWithVectorizerAI').mockImplementation(async (_input, _options, capture) => {
      await capture!(Buffer.from(svg), { httpStatus: 200, rawComplete: true, byteLength: Buffer.byteLength(svg), chargedCredits: '1' })
      throw new provider.VectorizerError('模拟本地处理失败')
    })
    const task = await submitVectorTask('alice', png, options(), undefined, false, true)
    expect(task.status).toBe('needs_repair')
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
    const recovered = await reprocessVectorTask('alice', task.id)
    expect(recovered.status).toBe('ready')
    expect(fetch).not.toHaveBeenCalled()
    expect((await vectorBudget('alice')).totalReserved).toBe(.3)
  })
  it('keeps SVG larger than 1MB downloadable instead of discarding a paid result', async () => {
    const large = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#11147d" d="${'M1 1h1v1h-1z '.repeat(90000)}"/></svg>`
    vi.stubGlobal('fetch', vi.fn(async () => new Response(large)))
    const task = await submitVectorTask('alice', png, options(), undefined, false, true)
    expect(task).toMatchObject({ status: 'ready', editable: false, rawComplete: true })
    expect(task.url).toBeTruthy(); expect(task.previewUrl).toBeTruthy(); expect(task.svg).toBeUndefined()
    expect((await readFile(path.join(root, 'alice', `${task.id}.svg`))).length).toBeGreaterThan(1_000_000)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('blocks budget overflow before fetch and does not create a reservation', async () => {
    config.vectorizerDailyBudget = 0
    await expect(submitVectorTask('alice', png, options())).rejects.toMatchObject({ status: 503 })
    expect(fetch).not.toHaveBeenCalled()
    expect((await vectorBudget('alice')).totalReserved).toBe(0)
  })
  it('enforces a shared global budget across invited accounts', async () => {
    config.vectorizerDailyBudget = .3
    await submitVectorTask('alice', png, options(), undefined, false, true)
    await expect(submitVectorTask('bob', png, options())).rejects.toMatchObject({ status: 503 })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('persists daily attempt limits and conservative reservations after failed upstream responses', async () => {
    config.vectorizerDailyLimit = 1
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 429 })))
    const task = await submitVectorTask('alice', png, options(), undefined, false, true)
    expect(task).toMatchObject({ status: 'upstream_failed', errorStatus: 429 })
    const duplicate = await submitVectorTask('alice', png, options(), undefined, false, true)
    expect(duplicate.id).toBe(task.id)
    const different = options(); different['output.draw_style'] = 'fill_shapes'
    await expect(submitVectorTask('alice', png, different)).rejects.toMatchObject({ status: 429 })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect((await vectorBudget('alice')).paidCallsToday).toBe(1)
  })
  it('never automatically resubmits unknown network failures or interrupted jobs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network disconnected') }))
    const task = await submitVectorTask('alice', png, options(), undefined, false, true)
    expect(task.status).toBe('unknown')
    const file = path.join(root, 'alice', 'tasks', task.id, 'task.json')
    const saved = JSON.parse(await readFile(file, 'utf8')); saved.status = 'running'; await writeFile(file, JSON.stringify(saved))
    expect((await getVectorTask('alice', task.id))?.status).toBe('unknown')
    await submitVectorTask('alice', png, options(), undefined, false, true)
    expect(fetch).toHaveBeenCalledTimes(1)
    await expect(reprocessVectorTask('alice', task.id)).rejects.toMatchObject({ status: 409 })
  })
  it('a damaged budget file fails closed instead of resetting spend to zero', async () => {
    await writeFile(path.join(root, 'ledger.json'), 'broken')
    await expect(submitVectorTask('alice', png, options())).rejects.toMatchObject({ status: 503 })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('checks storage capacity before reserving budget or calling upstream', async () => {
    config.vectorizerStorageBudgetMb = 1
    await expect(submitVectorTask('alice', png, options())).rejects.toMatchObject({ status: 503 })
    expect(fetch).not.toHaveBeenCalled()
    expect((await vectorBudget('alice')).totalReserved).toBe(0)
  })
  it('lists previous saved SVG files as legacy downloads without creating a paid task', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    await mkdir(path.join(root, 'alice')); await writeFile(path.join(root, 'alice', `${id}.svg`), svg)
    expect(await listVectorTasks('alice')).toMatchObject([{ id, legacy: true, url: `/api/vectorize/results/${id}`, estimatedCost: null }])
    expect(await listVectorTasks('bob')).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })
})
