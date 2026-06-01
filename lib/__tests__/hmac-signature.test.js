import { describe, it, expect, vi, afterEach } from 'vitest'
import crypto from 'node:crypto'
import { verifyHmacSignature, readRawBody } from '../hmac-signature.js'
import { EventEmitter } from 'node:events'

function sign(secret, t, body) {
  return crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')
}

afterEach(() => { vi.useRealTimers() })

describe('verifyHmacSignature', () => {
  const secret = 'whsec_test'; const body = '{"event":"message.received"}'
  it('accepts a valid current signature', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-06-01T00:00:00Z'))
    const t = Math.floor(Date.now() / 1000)
    expect(verifyHmacSignature(body, `t=${t},v1=${sign(secret, t, body)}`, secret)).toBe(true)
  })
  it('rejects a wrong signature', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-06-01T00:00:00Z'))
    const t = Math.floor(Date.now() / 1000)
    expect(verifyHmacSignature(body, `t=${t},v1=deadbeef`, secret)).toBe(false)
  })
  it('rejects an expired timestamp (>5 min)', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-06-01T00:10:00Z'))
    const t = Math.floor(new Date('2026-06-01T00:00:00Z').getTime() / 1000) // 10 min old
    expect(verifyHmacSignature(body, `t=${t},v1=${sign(secret, t, body)}`, secret)).toBe(false)
  })
  it('returns false when secret missing or header malformed', () => {
    expect(verifyHmacSignature(body, 't=1,v1=x', '')).toBe(false)
    expect(verifyHmacSignature(body, 'garbage', secret)).toBe(false)
  })
})

describe('readRawBody', () => {
  it('returns req.rawBody when present', async () => {
    expect(await readRawBody({ rawBody: '{"a":1}' })).toBe('{"a":1}')
  })
  it('buffers a streaming request body when rawBody is absent', async () => {
    const req = new EventEmitter()
    const p = readRawBody(req)
    req.emit('data', Buffer.from('{"a":'))
    req.emit('data', Buffer.from('1}'))
    req.emit('end')
    expect(await p).toBe('{"a":1}')
  })
})
