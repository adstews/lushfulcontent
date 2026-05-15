import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../../lib/sendblue.js', () => ({
  sendReaction: vi.fn()
}))
vi.mock('../../../../lib/supabase.js', () => ({
  getSupabase: vi.fn()
}))

const { sendReaction } = await import('../../../../lib/sendblue.js')
const { getSupabase } = await import('../../../../lib/supabase.js')
const { makeSessionCookie } = await import('../../../../lib/auth.js')
const handler = (await import('../react.js')).default

function authedReq(body) {
  const token = makeSessionCookie().split(';')[0]
  return { method: 'POST', headers: { cookie: token }, body, query: {} }
}
function makeRes() {
  return {
    statusCode: 200,
    _json: null,
    status(c) { this.statusCode = c; return this },
    json(o) { this._json = o; return this },
    setHeader() {}
  }
}

beforeEach(() => {
  process.env.REPLY_CONSOLE_SESSION_SECRET = 'this-is-a-long-enough-secret-yes'
  const insert = vi.fn().mockResolvedValue({ error: null })
  getSupabase.mockReturnValue({ from: () => ({ insert }) })
})

afterEach(() => { vi.clearAllMocks() })

describe('POST /api/sendblue/console/react', () => {
  it('returns 401 unauthed', async () => {
    const res = makeRes()
    await handler({ method: 'POST', headers: {}, body: {} }, res)
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 on missing fields', async () => {
    const res = makeRes()
    await handler(authedReq({ reaction: 'love' }), res)
    expect(res.statusCode).toBe(400)
  })

  it('rejects unknown reaction types', async () => {
    const res = makeRes()
    await handler(authedReq({
      messageHandle: 'sb_x', phone: '+1', reaction: 'thumbs-up'
    }), res)
    expect(res.statusCode).toBe(400)
  })

  it('sends a valid reaction', async () => {
    sendReaction.mockResolvedValue({ ok: true })
    const res = makeRes()
    await handler(authedReq({
      messageHandle: 'sb_x', phone: '+15550100123', reaction: 'love', leadId: 'lead_1'
    }), res)
    expect(res.statusCode).toBe(200)
    expect(sendReaction).toHaveBeenCalledWith({
      phone: '+15550100123',
      messageHandle: 'sb_x',
      reaction: 'love'
    })
  })

  it('accepts removal reactions (-love, etc.)', async () => {
    sendReaction.mockResolvedValue({ ok: true })
    const res = makeRes()
    await handler(authedReq({
      messageHandle: 'sb_x', phone: '+15550100123', reaction: '-love'
    }), res)
    expect(res.statusCode).toBe(200)
  })

  it('returns 502 when SendBlue fails', async () => {
    sendReaction.mockRejectedValue(new Error('SendBlue reaction failed: 500'))
    const res = makeRes()
    await handler(authedReq({
      messageHandle: 'sb_x', phone: '+15550100123', reaction: 'love'
    }), res)
    expect(res.statusCode).toBe(502)
  })
})
