import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
const { makeSessionCookie } = await import('../../../../lib/auth.js')
const handler = (await import('../sendblue-webhooks.js')).default

function authedReq() {
  const token = makeSessionCookie().split(';')[0]
  return { method: 'GET', headers: { cookie: token } }
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
  process.env.SENDBLUE_API_KEY = 'k'
  process.env.SENDBLUE_API_SECRET = 's'
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GET /api/sendblue/console/sendblue-webhooks', () => {
  it('returns 401 when unauthed', async () => {
    const res = makeRes()
    await handler({ method: 'GET', headers: {} }, res)
    expect(res.statusCode).toBe(401)
  })

  it('returns 500 when SendBlue creds missing', async () => {
    delete process.env.SENDBLUE_API_KEY
    const res = makeRes()
    await handler(authedReq(), res)
    expect(res.statusCode).toBe(500)
  })

  it('returns 200 with parsed payload on success', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ webhooks: [{ url: 'https://example.com' }] })
    })
    const res = makeRes()
    await handler(authedReq(), res)
    expect(res.statusCode).toBe(200)
    expect(res._json.payload.webhooks[0].url).toBe('https://example.com')
  })

  it('returns 502 when SendBlue responds non-OK', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => '{"error":"nope"}'
    })
    const res = makeRes()
    await handler(authedReq(), res)
    expect(res.statusCode).toBe(502)
    expect(res._json.status).toBe(403)
  })
})
