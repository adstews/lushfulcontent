import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../../lib/supabase.js', () => ({
  getSupabase: vi.fn()
}))

const { getSupabase } = await import('../../../../lib/supabase.js')
const { makeSessionCookie } = await import('../../../../lib/auth.js')
const handler = (await import('../mark-read.js')).default

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
})
afterEach(() => { vi.clearAllMocks() })

describe('POST /api/sendblue/console/mark-read', () => {
  it('returns 401 unauthed', async () => {
    const res = makeRes()
    await handler({ method: 'POST', headers: {}, body: { leadId: 'l' } }, res)
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 when leadId missing', async () => {
    const res = makeRes()
    await handler(authedReq({}), res)
    expect(res.statusCode).toBe(400)
  })

  it('upserts read state with leadId + custom at', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    getSupabase.mockReturnValue({ from: () => ({ upsert }) })

    const res = makeRes()
    await handler(authedReq({ leadId: 'lead_1', at: '2026-05-15T12:00:00Z' }), res)
    expect(res.statusCode).toBe(200)
    expect(upsert).toHaveBeenCalledWith(
      { lead_id: 'lead_1', last_read_at: '2026-05-15T12:00:00Z' },
      { onConflict: 'lead_id' }
    )
  })

  it('uses now() when no at provided', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    getSupabase.mockReturnValue({ from: () => ({ upsert }) })

    const res = makeRes()
    await handler(authedReq({ leadId: 'lead_1' }), res)
    expect(res.statusCode).toBe(200)
    expect(upsert.mock.calls[0][0].last_read_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('returns 500 when supabase errors', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: { message: 'db down' } })
    getSupabase.mockReturnValue({ from: () => ({ upsert }) })

    const res = makeRes()
    await handler(authedReq({ leadId: 'lead_1' }), res)
    expect(res.statusCode).toBe(500)
  })
})
