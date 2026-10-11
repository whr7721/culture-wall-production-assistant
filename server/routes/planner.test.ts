import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import { createServer, type Server } from 'node:http'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { config } from '../config.ts'
import { requireInvite } from '../security/invites.ts'
import { plannerRouter } from './planner.ts'
import { planWithKimi } from '../services/kimiPlanner.ts'

vi.mock('../services/kimiPlanner.ts', () => ({ planWithKimi: vi.fn(async () => ({ summary: 'mock' })) }))
vi.mock('../security/generationGate.ts', () => ({ GenerationGate: class { async acquire() { return () => {} } }, GateError: class extends Error {} }))
const original = { kimiEnabled: config.kimiEnabled, kimiApiKey: config.kimiApiKey, requireInvites: config.requireInvites, invitesFile: config.invitesFile }
let server: Server
let base: string
let temporary: string
beforeEach(async () => {
  config.kimiEnabled = true; config.kimiApiKey = 'test-only'; config.requireInvites = false
  temporary = await mkdtemp(path.join(os.tmpdir(), 'wall-planner-test-'))
  config.invitesFile = path.join(temporary, 'invites.json')
  await writeFile(config.invitesFile, '[]')
  const app = express(); app.use(requireInvite); app.use('/api/planner', plannerRouter)
  server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/planner`
  vi.mocked(planWithKimi).mockClear()
})
afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  await rm(temporary, { recursive: true })
  Object.assign(config, original)
})
function form(authorized = true) {
  const data = new FormData()
  data.set('brief', '请设计品牌文化墙保留全部客户内容')
  data.set('widthMm', '3500'); data.set('heightMm', '2300')
  data.set('exactCopy', '专颜媄肤')
  if (authorized) data.set('authorized', '1')
  return data
}
describe('planner HTTP boundary', () => {
  it('blocks unauthorized access before planner calls', async () => {
    config.requireInvites = true
    const response = await fetch(base, { method: 'POST', body: form() })
    expect(response.status).toBe(401)
    expect(planWithKimi).not.toHaveBeenCalled()
  })
  it('returns disabled status and does not call provider when disabled', async () => {
    config.kimiEnabled = false
    expect(await (await fetch(`${base}/status`)).json()).toMatchObject({ available: false })
    expect((await fetch(base, { method: 'POST', body: form() })).status).toBe(503)
    expect(planWithKimi).not.toHaveBeenCalled()
  })
  it('requires upload consent and validates measurements before calling provider', async () => {
    expect((await fetch(base, { method: 'POST', body: form(false) })).status).toBe(400)
    const invalid = form(); invalid.set('widthMm', '-1')
    expect((await fetch(base, { method: 'POST', body: invalid })).status).toBe(400)
    expect(planWithKimi).not.toHaveBeenCalled()
    expect((await fetch(base, { method: 'POST', body: form() })).status).toBe(200)
    expect(planWithKimi).toHaveBeenCalledTimes(1)
  })
})
