import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { config } from '../config.ts'
import { GateError, GenerationGate } from './generationGate.ts'

const original = {
  usageFile: config.usageFile,
  dailyGenerationLimit: config.dailyGenerationLimit,
  totalGenerationLimit: config.totalGenerationLimit,
  maxConcurrentGenerations: config.maxConcurrentGenerations,
  minGenerationIntervalMs: config.minGenerationIntervalMs,
}
let temporary = ''

beforeEach(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), 'culture-wall-gate-'))
  config.usageFile = path.join(temporary, 'usage.json')
  config.dailyGenerationLimit = 2
  config.totalGenerationLimit = 2
  config.maxConcurrentGenerations = 1
  config.minGenerationIntervalMs = 0
})

afterEach(async () => {
  Object.assign(config, original)
  await rm(temporary, { recursive: true, force: true })
})

describe('GenerationGate', () => {
  it('blocks concurrent work and persists the reserved attempt', async () => {
    const gate = new GenerationGate()
    const release = await gate.acquire({ username: 'tester' })
    await expect(gate.acquire({ username: 'other' })).rejects.toBeInstanceOf(GateError)
    const usage = JSON.parse(await readFile(config.usageFile, 'utf8'))
    expect(usage.tester.total).toBe(1)
    release()
    const releaseSecond = await gate.acquire({ username: 'tester' })
    releaseSecond()
    await expect(gate.acquire({ username: 'tester' })).rejects.toThrow('额度')
  })

  it('applies an invite-specific cap', async () => {
    const gate = new GenerationGate()
    const release = await gate.acquire({ username: 'tester', dailyLimit: 1, totalLimit: 1 })
    release()
    await expect(gate.acquire({ username: 'tester', dailyLimit: 1, totalLimit: 1 })).rejects.toThrow('今日')
  })
})
