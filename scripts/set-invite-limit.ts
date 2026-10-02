import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { InviteRecord } from '../server/security/invites.ts'

const [username, dailyRaw, totalRaw] = process.argv.slice(2)
const dailyLimit = Number(dailyRaw)
const totalLimit = Number(totalRaw)
if (!username || !Number.isInteger(dailyLimit) || dailyLimit < 1 || !Number.isInteger(totalLimit) || totalLimit < dailyLimit) {
  console.error('用法：npm run invite:limit -- <用户名> <每日额度> <总额度>')
  process.exit(1)
}

const file = path.resolve(process.env.INVITES_FILE || 'data/invites.json')
const records = JSON.parse(await readFile(file, 'utf8')) as InviteRecord[]
const target = records.find((record) => record.username === username)
if (!target) throw new Error(`未找到受邀账号：${username}`)
target.dailyLimit = dailyLimit
target.totalLimit = totalLimit
await writeFile(file, JSON.stringify(records, null, 2), { mode: 0o600 })
console.log(`额度已更新：${username} 每日 ${dailyLimit} 次、总计 ${totalLimit} 次。`)
