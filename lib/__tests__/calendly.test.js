import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import { verifySignature } from '../calendly.js'

function sign(raw, key, t = '1700000000') {
  const v1 = crypto.createHmac('sha256', key).update(`${t}.${raw}`).digest('hex')
  return `t=${t},v1=${v1}`
}

describe('verifySignature', () => {
  const key = 'whsec_test'
  const raw = '{"event":"invitee.created"}'

  it('accepts a valid signature', () => {
    expect(verifySignature(raw, sign(raw, key), key)).toBe(true)
  })
  it('rejects a tampered body', () => {
    expect(verifySignature(raw + ' ', sign(raw, key), key)).toBe(false)
  })
  it('rejects a signature made with a different key', () => {
    expect(verifySignature(raw, sign(raw, 'other_key'), key)).toBe(false)
  })
  it('rejects when the signing key is missing', () => {
    expect(verifySignature(raw, sign(raw, key), '')).toBe(false)
  })
  it('rejects a malformed header', () => {
    expect(verifySignature(raw, 'garbage', key)).toBe(false)
    expect(verifySignature(raw, '', key)).toBe(false)
    expect(verifySignature(raw, undefined, key)).toBe(false)
  })
})
