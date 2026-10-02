import { describe, expect, it } from 'vitest'
import { hashInvitePassword } from './invites.ts'

describe('invite password hashing', () => {
  it('is deterministic for the same salt and differs for another salt', () => {
    const one = hashInvitePassword('secret-example', 'salt-one')
    expect(one).toHaveLength(128)
    expect(hashInvitePassword('secret-example', 'salt-one')).toBe(one)
    expect(hashInvitePassword('secret-example', 'salt-two')).not.toBe(one)
  })
})
