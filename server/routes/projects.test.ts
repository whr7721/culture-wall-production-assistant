import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import express from 'express'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Server } from 'node:http'
import sharp from 'sharp'
import { config } from '../config.ts'
import { projectsRouter } from './projects.ts'

let server: Server, base: string
const original = { projectsDir: config.projectsDir, projectActiveLimit: config.projectActiveLimit }
beforeEach(async () => {
  config.projectsDir = await mkdtemp(path.join(os.tmpdir(), 'wall-project-lock-'))
  config.projectActiveLimit = 1
  const app = express()
  app.use((req, res, next) => { res.locals.invite = { username: req.get('X-Test-User') || 'alice' }; next() })
  app.use('/api/projects', projectsRouter)
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/projects`
})
afterEach(async () => { await new Promise<void>(resolve => server.close(() => resolve())); Object.assign(config, original) })
const json = (body: unknown, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
describe('project mutation boundaries', () => {
  it('accepts exactly one concurrent save and rejects the stale revision', async () => {
    const p = await (await fetch(base, json({ title: 'test' }))).json()
    const results = await Promise.all(['one', 'two'].map(title => fetch(`${base}/${p.id}`, json({ ...p, title }, 'PUT'))))
    expect(results.map(r => r.status).sort()).toEqual([200, 409])
    expect((await (await fetch(`${base}/${p.id}`)).json()).revision).toBe(2)
  })
  it('serializes uploads with saves without losing an asset or a revision', async () => {
    const p = await (await fetch(base, json({ title: 'test' }))).json()
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'red' } }).png().toBuffer()
    const form = new FormData(); form.set('revision', String(p.revision)); form.set('asset', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'red.png')
    const results = await Promise.all([fetch(`${base}/${p.id}/assets`, { method: 'POST', body: form }), fetch(`${base}/${p.id}`, json({ ...p, title: 'new' }, 'PUT'))])
    expect(results.filter(r => r.ok)).toHaveLength(1)
    expect(results.filter(r => r.status === 409)).toHaveLength(1)
    const saved = await (await fetch(`${base}/${p.id}`)).json()
    expect(saved.revision).toBe(2)
    if (results[0].ok) { expect(saved.assets).toHaveLength(1); expect((await fetch(new URL(saved.assets[0].url, base))).status).toBe(200) }
  })
  it('archives without deletion, enforces active capacity and isolates accounts', async () => {
    const p = await (await fetch(base, json({ title: 'archive me' }))).json()
    expect((await fetch(base, json({ title: 'over capacity' }))).status).toBe(400)
    const archived = await (await fetch(`${base}/${p.id}/archive`, json({ revision: p.revision, archived: true }))).json()
    expect(archived.archived).toBe(true)
    expect((await fetch(base, json({ title: 'new slot' }))).status).toBe(201)
    expect((await fetch(`${base}/${p.id}/archive`, json({ revision: archived.revision, archived: false }))).status).toBe(400)
    expect((await fetch(`${base}/${p.id}`, { headers: { 'X-Test-User': 'bob' } })).status).toBe(404)
    expect((await (await fetch(base)).json()).length).toBe(2)
  })
  it('serializes competing creates at the capacity boundary', async () => {
    const results = await Promise.all(['one', 'two'].map(title => fetch(base, json({ title }))))
    expect(results.map(r => r.status).sort()).toEqual([201, 400])
  })
})
