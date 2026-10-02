import { createHash, scryptSync, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { RequestHandler } from 'express'
import { config } from '../config.ts'

export interface InviteRecord {
  username: string
  salt: string
  hash: string
  dailyLimit?: number
  totalLimit?: number
}

function parseRecords(raw: string): InviteRecord[] {
  const value: unknown = JSON.parse(raw)
  if (!Array.isArray(value)) throw new Error('邀请配置必须是数组')
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('邀请配置格式错误')
    const row = item as Record<string, unknown>
    if (typeof row.username !== 'string' || typeof row.salt !== 'string' || typeof row.hash !== 'string') {
      throw new Error('邀请配置缺少 username/salt/hash')
    }
    return {
      username: row.username,
      salt: row.salt,
      hash: row.hash,
      dailyLimit: typeof row.dailyLimit === 'number' ? row.dailyLimit : undefined,
      totalLimit: typeof row.totalLimit === 'number' ? row.totalLimit : undefined,
    }
  })
}

export function hashInvitePassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('hex')
}

function verifyPassword(password: string, invite: InviteRecord): boolean {
  const actual = Buffer.from(hashInvitePassword(password, invite.salt), 'hex')
  const expected = Buffer.from(invite.hash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function parseBasicAuth(header: string | undefined): { username: string; password: string } | null {
  if (!header?.startsWith('Basic ')) return null
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
    const separator = decoded.indexOf(':')
    if (separator < 1) return null
    return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) }
  } catch {
    return null
  }
}

function loadInvites(): InviteRecord[] {
  return parseRecords(readFileSync(path.resolve(config.invitesFile), 'utf8'))
}

// Basic 凭据只经 SSH 隧道传输；公网 HTTPS 启用前不要公开站点端口。
export const requireInvite: RequestHandler = (request, response, next) => {
  response.setHeader('Cache-Control', 'private, no-store')
  if (!config.requireInvites) {
    response.locals.invite = { username: 'local-dev' } satisfies Pick<InviteRecord, 'username'>
    next()
    return
  }

  const credentials = parseBasicAuth(request.headers.authorization)
  let invite: InviteRecord | undefined
  try {
    invite = credentials ? loadInvites().find((item) => item.username === credentials.username) : undefined
  } catch (error) {
    console.error('[auth] invitation configuration unavailable', error instanceof Error ? error.message : '')
    response.status(503).json({ error: '访问配置暂不可用' })
    return
  }

  // Unknown users still incur comparable scrypt work; do not reveal valid usernames.
  const dummy = { username: '', salt: 'culture-wall-dummy-salt', hash: createHash('sha512').update('dummy').digest('hex') }
  const valid = credentials ? verifyPassword(credentials.password, invite || dummy) : false
  if (!invite || !valid) {
    response.setHeader('WWW-Authenticate', 'Basic realm="Culture Wall Trial", charset="UTF-8"')
    response.status(401).json({ error: '请使用受邀试用凭据访问' })
    return
  }

  response.locals.invite = invite
  next()
}
