import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.ts'
import type { InviteRecord } from './invites.ts'

interface UsageRecord {
  day: string
  daily: number
  total: number
  lastAt: number
}

type Usage = Record<string, UsageRecord>

export class GateError extends Error {
  constructor(message: string, readonly retryAfterSeconds = 0) {
    super(message)
  }
}

export class GenerationGate {
  private queue: Promise<unknown> = Promise.resolve()
  private active = 0

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action)
    this.queue = result.catch(() => undefined)
    return result
  }

  private async loadUsage(): Promise<Usage> {
    try {
      return JSON.parse(await readFile(path.resolve(config.usageFile), 'utf8')) as Usage
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw error
    }
  }

  private async saveUsage(usage: Usage): Promise<void> {
    const file = path.resolve(config.usageFile)
    await mkdir(path.dirname(file), { recursive: true })
    const temporary = `${file}.tmp`
    await writeFile(temporary, JSON.stringify(usage, null, 2), { mode: 0o600 })
    await rename(temporary, file)
  }

  async acquire(invite: Pick<InviteRecord, 'username' | 'dailyLimit' | 'totalLimit'>): Promise<() => void> {
    return this.serialize(async () => {
      if (this.active >= config.maxConcurrentGenerations) throw new GateError('当前已有生成任务，请稍后再试', 30)
      const usage = await this.loadUsage()
      const now = Date.now()
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
      const previous = usage[invite.username] || { day, daily: 0, total: 0, lastAt: 0 }
      const daily = previous.day === day ? previous.daily : 0
      const dailyLimit = invite.dailyLimit || config.dailyGenerationLimit
      const totalLimit = invite.totalLimit || config.totalGenerationLimit
      if (daily >= dailyLimit) throw new GateError('今日试用额度已用完')
      if (previous.total >= totalLimit) throw new GateError('总试用额度已用完')
      const remaining = config.minGenerationIntervalMs - (now - previous.lastAt)
      if (remaining > 0) throw new GateError(`操作过快，请 ${Math.ceil(remaining / 1000)} 秒后再试`, Math.ceil(remaining / 1000))
      usage[invite.username] = { day, daily: daily + 1, total: previous.total + 1, lastAt: now }
      await this.saveUsage(usage)
      this.active++
      let released = false
      return () => {
        if (!released) this.active--
        released = true
      }
    })
  }
}

export const generationGate = new GenerationGate()
