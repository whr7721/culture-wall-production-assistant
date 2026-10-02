import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { hashInvitePassword, type InviteRecord } from '../server/security/invites.ts'

const username = process.argv[2]
if (!username || !/^[a-z][a-z0-9_-]{1,30}$/.test(username)) {
  console.error('用法：npm run invite:add -- <用户名> [每日额度] [总额度]')
  process.exit(1)
}

const dailyLimit = Number(process.argv[3] || 5)
const totalLimit = Number(process.argv[4] || 20)
if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || !Number.isInteger(totalLimit) || totalLimit < dailyLimit) {
  console.error('额度必须为正整数，且总额度不小于每日额度。')
  process.exit(1)
}

const invitesFile = path.resolve(process.env.INVITES_FILE || 'data/invites.json')
const credentialsDir = path.resolve('data/invite-credentials')
let records: InviteRecord[] = []
try {
  records = JSON.parse(await readFile(invitesFile, 'utf8')) as InviteRecord[]
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}

if (records.some((record) => record.username === username)) {
  console.error('用户名已存在，请使用新用户名。')
  process.exit(1)
}

const password = randomBytes(24).toString('base64url')
const salt = randomBytes(16).toString('hex')
records.push({ username, salt, hash: hashInvitePassword(password, salt), dailyLimit, totalLimit })
await mkdir(path.dirname(invitesFile), { recursive: true })
await mkdir(credentialsDir, { recursive: true })
await writeFile(invitesFile, JSON.stringify(records, null, 2), { mode: 0o600 })
const credentialsFile = path.join(credentialsDir, `${username}.txt`)
await writeFile(credentialsFile, `username=${username}\npassword=${password}\n`, { mode: 0o600, flag: 'wx' })
console.log(`邀请已创建：${username}；凭据保存在本机 ${credentialsFile}，终端不显示密码。`)
