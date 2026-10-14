import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, statfs, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { config } from '../config.ts'
import { processVectorizerSvg, vectorizeWithVectorizerAI, vectorizerStatus, VectorizerError, type VectorizerOptions, type RawVectorResponse } from './providers/vectorizerai.ts'
import type { VectorTaskContext, VectorTaskStatus, VectorTaskView } from '../../shared/vectorTasks.ts'

type Task = {
  id: string; owner: string; fingerprint: string; status: VectorTaskStatus; createdAt: string; updatedAt: string
  channel: string; mode: string; options: VectorizerOptions; contexts: VectorTaskContext[]
  estimatedCost: number; budgetUnit: 'PTC' | 'credit'; error?: string; errorStatus?: number
  input?: { width: number; height: number; bytes: number }
  response?: RawVectorResponse; output?: { width: number; height: number; pathCount: number; bytes: number; warnings: string[] }
}
type Reservation = { id: string; owner: string; fingerprint: string; day: string; createdAt: string; cost: number; unit: 'PTC' | 'credit' }
type Ledger = { version: 1; reservations: Reservation[] }
let queue: Promise<unknown> = Promise.resolve()
const active = new Set<string>()
const completions = new Map<string, Promise<void>>()
const userPattern = /^[a-z][a-z0-9_-]{1,30}$/
const idPattern = /^[0-9a-f-]{36}$/
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const micro = (n: number) => Math.round(n * 1_000_000)
const key = (root: string, owner: string, id: string) => `${root}:${owner}:${id}`
function directory(root: string, owner: string, id?: string) {
  if (!userPattern.test(owner) || id && !idPattern.test(id)) throw new VectorizerError('任务编号或账号无效', 404)
  return id ? path.join(root, owner, 'tasks', id) : path.join(root, owner)
}
function serialize<T>(action: () => Promise<T>): Promise<T> { const pending = queue.then(action); queue = pending.catch(() => undefined); return pending }
async function atomic(file: string, contents: string | Buffer) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${randomUUID()}.tmp`
  await writeFile(temporary, contents, { mode: 0o600, flag: 'wx' })
  for (let attempt = 0; ; attempt++) {
    try { await rename(temporary, file); return } catch (error) {
      if (!['EPERM', 'EBUSY'].includes((error as NodeJS.ErrnoException).code || '') || attempt >= 3) throw error
      // Only local file writes retry. Never retry an upstream paid request.
      await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)))
    }
  }
}
async function ledger(root: string): Promise<Ledger> {
  try {
    const parsed = JSON.parse(await readFile(path.join(root, 'ledger.json'), 'utf8')) as Ledger
    if (parsed.version !== 1 || !Array.isArray(parsed.reservations) || parsed.reservations.some(row => !idPattern.test(row.id) || !userPattern.test(row.owner) || !Number.isFinite(row.cost) || row.cost < 0 || !['PTC', 'credit'].includes(row.unit))) throw new Error('invalid ledger')
    return parsed
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, reservations: [] }; throw new VectorizerError('预算记录无法读取，已阻止新增付费调用，请管理员检查', 503) }
}
async function readTask(root: string, owner: string, id: string): Promise<Task | null> {
  try {
    const task = JSON.parse(await readFile(path.join(directory(root, owner, id), 'task.json'), 'utf8')) as Task
    if (task.id !== id || task.owner !== owner) throw new Error('任务记录不匹配')
    return task
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
}
const saveTask = (root: string, task: Task) => atomic(path.join(directory(root, task.owner, task.id), 'task.json'), JSON.stringify(task, null, 2))
async function patchTask(root: string, owner: string, id: string, patch: Partial<Task>) {
  return serialize(async () => { const task = await readTask(root, owner, id); if (!task) throw new Error('任务记录缺失'); const next = { ...task, ...patch, updatedAt: new Date().toISOString() }; await saveTask(root, next); return next })
}
function interrupted(root: string, task: Task): Task {
  if (['running', 'processing'].includes(task.status) && !active.has(key(root, task.owner, task.id))) return { ...task, status: task.response?.rawComplete ? 'needs_repair' : 'unknown', error: task.response?.rawComplete ? '服务重启前已保存原始响应，可免费重处理' : '上次任务中断，费用状态未知；不会自动再次提交上游' }
  return task
}
export const hasActiveVectorTask = () => active.size > 0
export async function vectorBudget(owner: string) {
  const rows = (await ledger(path.resolve(config.vectorizerResultsDir))).reservations
  const unit = config.vectorizerChannel === '302' ? 'PTC' as const : 'credit' as const
  const cost = config.vectorizerChannel === '302' ? config.vectorizer302CostPtc : config.vectorizerMode === 'production' ? 1 : 0
  return { unit, estimatedPerCall: cost, dailyLimit: config.vectorizerDailyLimit, paidCallsToday: rows.filter(row => row.owner === owner && row.day === today() && row.cost > 0).length, dailyReserved: rows.filter(row => row.unit === unit && row.day === today()).reduce((n, row) => n + micro(row.cost), 0) / 1e6, totalReserved: rows.filter(row => row.unit === unit).reduce((n, row) => n + micro(row.cost), 0) / 1e6, dailyBudget: config.vectorizerDailyBudget, totalBudget: config.vectorizerTotalBudget, note: '本站预算从新版本启用起预占，不是平台余额或已核实账单；旧版费用未补计，失败和未知调用保守占用预算，本地恢复不占预算。' }
}
async function assertStorage(root: string) {
  await mkdir(root, { recursive: true, mode: 0o700 })
  const disk = await statfs(root)
  if (disk.bavail * disk.bsize < config.vectorizerMinFreeMb * 1024 * 1024) throw new VectorizerError('可用磁盘不足，已在调用上游前停止；未删除已有付费资产', 503, 'preflight')
  async function sizeOf(dir: string): Promise<number> {
    let bytes = 0
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) bytes += await sizeOf(file)
      else if (entry.isFile()) bytes += (await stat(file)).size
    }
    return bytes
  }
  // Reserve space for bounded raw response, clean copy and upload before spending.
  if (await sizeOf(root) + 82 * 1024 * 1024 > config.vectorizerStorageBudgetMb * 1024 * 1024) throw new VectorizerError('描摹存储配额不足，已阻止新调用；历史文件继续保留', 503, 'preflight')
}
async function view(root: string, task: Task, includeSvg = false, context?: VectorTaskContext): Promise<VectorTaskView> {
  task = interrupted(root, task)
  const editable = Boolean(task.output && task.output.bytes <= 1_000_000 && task.output.pathCount <= 120)
  const result: VectorTaskView = { id: task.id, provider: 'vectorizerai', channel: task.channel, mode: task.mode, status: task.status, createdAt: task.createdAt, updatedAt: task.updatedAt, estimatedCost: task.estimatedCost, budgetUnit: task.budgetUnit, actualCostKnown: false, error: task.error, errorStatus: task.errorStatus, context: context || task.contexts.at(-1), upstreamStatus: task.response?.httpStatus, upstreamRequestId: task.response?.requestId, chargedCredits: task.response?.chargedCredits, rawBytes: task.response?.byteLength, rawComplete: task.response?.rawComplete, editable }
  if (task.response?.byteLength) result.rawUrl = `/api/vectorize/tasks/${task.id}/raw`
  result.options = task.options; result.input = task.input
  if (task.output && task.status === 'ready') {
    Object.assign(result, task.output, { url: `/api/vectorize/results/${task.id}`, previewUrl: `/api/vectorize/tasks/${task.id}/preview` })
    if (includeSvg && editable) result.svg = await readFile(path.join(directory(root, task.owner), `${task.id}.svg`), 'utf8')
  }
  return result
}
async function legacy(root: string, owner: string, id: string, includeSvg = false): Promise<VectorTaskView | null> {
  const file = path.join(directory(root, owner), `${id}.svg`)
  try {
    const info = await stat(file)
    const base: VectorTaskView = { id, provider: 'vectorizerai', channel: 'legacy', mode: 'unknown', status: 'ready', legacy: true, createdAt: info.mtime.toISOString(), updatedAt: info.mtime.toISOString(), estimatedCost: null, budgetUnit: 'PTC', actualCostKnown: false, url: `/api/vectorize/results/${id}`, editable: false, warnings: ['旧版已保存结果，费用及原始定位未记录；可以下载，不需重新描摹。'] }
    if (includeSvg && info.size <= 16 * 1024 * 1024) {
      const result = processVectorizerSvg(await readFile(file, 'utf8'), {} as VectorizerOptions)
      Object.assign(base, { width: result.width, height: result.height, pathCount: result.pathCount })
    }
    return base
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
}
export async function getVectorTask(owner: string, id: string, includeSvg = true): Promise<VectorTaskView | null> {
  const root = path.resolve(config.vectorizerResultsDir)
  const task = await readTask(root, owner, id)
  return task ? view(root, task, includeSvg) : legacy(root, owner, id, includeSvg)
}
export async function listVectorTasks(owner: string, projectId?: string, assetId?: string) {
  const root = path.resolve(config.vectorizerResultsDir), base = directory(root, owner)
  const ids: string[] = await readdir(path.join(base, 'tasks')).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? [] : Promise.reject(error))
  const tasks: VectorTaskView[] = []
  for (const id of ids.filter(id => idPattern.test(id))) {
    const task = await readTask(root, owner, id)
    if (!task) continue
    const context = task.contexts.find(item => (!projectId || item.projectId === projectId) && (!assetId || item.assetId === assetId))
    if ((projectId || assetId) && !context) continue
    tasks.push(await view(root, task, false, context))
  }
  const oldFiles = await readdir(base).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? [] : Promise.reject(error))
  for (const file of oldFiles.filter(file => /^[0-9a-f-]{36}\.svg$/.test(file) && !ids.includes(file.slice(0, -4)))) {
    const result = await legacy(root, owner, file.slice(0, -4)); if (result) tasks.push(result)
  }
  return tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30)
}
async function finish(root: string, task: Task, result: ReturnType<typeof processVectorizerSvg>) {
  await atomic(path.join(directory(root, task.owner), `${task.id}.svg`), result.svg)
  await patchTask(root, task.owner, task.id, { status: 'ready', error: undefined, errorStatus: undefined, output: { width: result.width, height: result.height, pathCount: result.pathCount, bytes: Buffer.byteLength(result.svg), warnings: result.warnings } })
}
async function run(root: string, task: Task, input: Buffer) {
  try {
    const result = await vectorizeWithVectorizerAI(input, task.options, async (raw, metadata) => {
      // Capture untrusted response privately before any XML parsing/size-based editing checks.
      await atomic(path.join(directory(root, task.owner, task.id), 'response.txt'), raw)
      await patchTask(root, task.owner, task.id, { response: metadata, status: metadata.rawComplete ? 'processing' : 'unknown' })
    })
    await finish(root, task, result)
  } catch (error) {
    const current = await readTask(root, task.owner, task.id)
    const stage = error instanceof VectorizerError ? error.stage : 'processing'
    await patchTask(root, task.owner, task.id, { status: current?.response?.rawComplete ? 'needs_repair' : stage === 'upstream' || stage === 'preflight' ? 'upstream_failed' : 'unknown', error: error instanceof Error ? error.message : '任务未完成，费用状态需核实', errorStatus: error instanceof VectorizerError ? error.status : 502 })
  } finally { active.delete(key(root, task.owner, task.id)); completions.delete(key(root, task.owner, task.id)) }
}
export async function submitVectorTask(owner: string, input: Buffer, options: VectorizerOptions, context?: VectorTaskContext, force = false, wait = false) {
  const root = path.resolve(config.vectorizerResultsDir)
  directory(root, owner)
  const meta = await sharp(input, { limitInputPixels: 33_554_432 }).metadata()
  if (meta.format !== 'png') throw new VectorizerError('只能提交有效PNG图片', 400, 'preflight')
  if (context) {
    const project = JSON.parse(await readFile(path.resolve(config.projectsDir, owner, context.projectId, 'project.json'), 'utf8').catch(() => { throw new VectorizerError('项目不存在或无权访问', 404, 'preflight') })) as { assets: { id: string }[] }
    if (!project.assets.some(asset => asset.id === context.assetId)) throw new VectorizerError('素材不属于该项目', 400, 'preflight')
  }
  const fingerprint = createHash('sha256').update(input).update(JSON.stringify({ version: 1, channel: config.vectorizerChannel, mode: config.vectorizerMode, endpoint: config.vectorizerChannel === '302' ? '302' : config.vectorizerEndpoint, options })).digest('hex')
  const reserved = await serialize(async () => {
    const book = await ledger(root)
    const prior = book.reservations.filter(row => row.owner === owner && row.fingerprint === fingerprint).at(-1)
    if (prior && !force) {
      const task = await readTask(root, owner, prior.id)
      if (!task) throw new VectorizerError('已有任务记录缺失，已阻止重复收费提交', 503)
      if (context && !task.contexts.some(item => JSON.stringify(item) === JSON.stringify(context))) { task.contexts.push(context); task.contexts = task.contexts.slice(-100); await saveTask(root, task) }
      return { task, cached: true }
    }
    const availability = vectorizerStatus()
    if (!availability.available) throw new VectorizerError(availability.reason, 503, 'preflight')
    if (active.size) throw new VectorizerError('另一项描摹正在处理，请稍后再试，尚未调用上游', 429, 'preflight')
    const day = today(), unit = config.vectorizerChannel === '302' ? 'PTC' as const : 'credit' as const
    const cost = availability.freeTest ? 0 : config.vectorizerChannel === '302' ? config.vectorizer302CostPtc : 1
    const dayRows = book.reservations.filter(row => row.day === day)
    if (cost > 0) {
      if (dayRows.filter(row => row.owner === owner && row.cost > 0).length >= config.vectorizerDailyLimit) throw new VectorizerError('今日高质量描摹次数已达上限，尚未调用上游', 429, 'preflight')
      if (dayRows.filter(row => row.unit === unit).reduce((n, row) => n + micro(row.cost), 0) + micro(cost) > micro(config.vectorizerDailyBudget)) throw new VectorizerError('本站今日描摹预算不足，已阻止收费调用；历史恢复和下载仍可使用', 503, 'preflight')
      if (book.reservations.filter(row => row.unit === unit).reduce((n, row) => n + micro(row.cost), 0) + micro(cost) > micro(config.vectorizerTotalBudget)) throw new VectorizerError('本站总描摹预算不足，已阻止收费调用', 503, 'preflight')
    } else if (dayRows.filter(row => row.owner === owner).length >= 10) throw new VectorizerError('今日免费测试次数已达10次', 429, 'preflight')
    const last = book.reservations.filter(row => row.owner === owner).at(-1)
    if (last && Date.now() - Date.parse(last.createdAt) < config.vectorizerMinIntervalMs) throw new VectorizerError('提交过于频繁，尚未调用上游；已有任务请从历史恢复', 429, 'preflight')
    await assertStorage(root)
    const now = new Date().toISOString(), id = randomUUID()
    const task: Task = { id, owner, fingerprint, status: 'running', createdAt: now, updatedAt: now, channel: config.vectorizerChannel, mode: config.vectorizerMode, options, contexts: context ? [context] : [], estimatedCost: cost, budgetUnit: unit, input: { width: meta.width!, height: meta.height!, bytes: input.length } }
    await atomic(path.join(directory(root, owner, id), 'input.png'), input)
    await saveTask(root, task)
    book.reservations.push({ id, owner, fingerprint, day, createdAt: now, cost, unit })
    await atomic(path.join(root, 'ledger.json'), JSON.stringify(book, null, 2))
    active.add(key(root, owner, id))
    return { task, cached: false }
  })
  if (!reserved.cached) {
    const completion = run(root, reserved.task, input)
    // Recording failures stop work; do not launch another paid request.
    completions.set(key(root, owner, reserved.task.id), completion)
    void completion.catch(error => console.error('[vector-task] persistence failure', (error as NodeJS.ErrnoException).code || 'unknown'))
  }
  if (wait) await completions.get(key(root, owner, reserved.task.id))
  const current = await readTask(root, owner, reserved.task.id)
  return { ...(await view(root, current || reserved.task, wait, context)), cached: reserved.cached }
}
export async function reprocessVectorTask(owner: string, id: string) {
  const root = path.resolve(config.vectorizerResultsDir), task = await readTask(root, owner, id)
  if (!task) throw new VectorizerError('任务不存在', 404)
  if (active.has(key(root, owner, id))) throw new VectorizerError('该任务仍在处理中，未重复执行', 409)
  if (!task.response?.rawComplete) throw new VectorizerError('没有完整原始响应；费用状态需人工核实，不会自动重新调用上游', 409)
  active.add(key(root, owner, id))
  try {
    await patchTask(root, owner, id, { status: 'processing' })
    const raw = await readFile(path.join(directory(root, owner, id), 'response.txt'), 'utf8')
    await finish(root, task, processVectorizerSvg(raw, task.options))
  } catch (error) { await patchTask(root, owner, id, { status: 'needs_repair', error: error instanceof Error ? error.message : '本地重处理未完成' }) }
  finally { active.delete(key(root, owner, id)) }
  return (await getVectorTask(owner, id))!
}
export function vectorRawFile(owner: string, id: string) { return path.join(directory(path.resolve(config.vectorizerResultsDir), owner, id), 'response.txt') }
