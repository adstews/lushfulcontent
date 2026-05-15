import { describe, it, expect, beforeEach } from 'vitest'
const handler = (await import('../login.js')).default

function makeReqRes(body, method = 'POST') {
  const req = { method, body, headers: {} }
  let setCookieValue = null
  const res = {
    statusCode: 200,
    _json: null,
    status(c) { this.statusCode = c; return this },
    json(o) { this._json = o; return this },
    setHeader(name, value) { if (name === 'Set-Cookie') setCookieValue = value }
  }
  return { req, res, getCookie: () => setCookieValue }
}

beforeEach(() => {
  process.env.REPLY_CONSOLE_PASSWORD = 'correct-horse-battery-staple'
  process.env.REPLY_CONSOLE_SESSION_SECRET = 'this-is-a-long-enough-secret-yes'
})

describe('POST /api/sendblue/console/login', () => {
  it('returns 405 on GET', async () => {
    const { req, res } = makeReqRes(null, 'GET')
    await handler(req, res)
    expect(res.statusCode).toBe(405)
  })

  it('returns 400 when password missing', async () => {
    const { req, res } = makeReqRes({})
    await handler(req, res)
    expect(res.statusCode).toBe(400)
  })

  it('returns 401 on wrong password', async () => {
    const { req, res, getCookie } = makeReqRes({ password: 'wrong' })
    await handler(req, res)
    expect(res.statusCode).toBe(401)
    expect(getCookie()).toBeNull()
  })

  it('returns 200 + sets cookie on correct password', async () => {
    const { req, res, getCookie } = makeReqRes({ password: 'correct-horse-battery-staple' })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res._json).toEqual({ ok: true })
    expect(getCookie()).toMatch(/^lush_console=/)
    expect(getCookie()).toMatch(/HttpOnly/)
  })

  it('returns 500 when REPLY_CONSOLE_PASSWORD is not set', async () => {
    delete process.env.REPLY_CONSOLE_PASSWORD
    const { req, res } = makeReqRes({ password: 'anything' })
    await handler(req, res)
    expect(res.statusCode).toBe(500)
  })

  it('DELETE clears the cookie', async () => {
    const { req, res, getCookie } = makeReqRes(null, 'DELETE')
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(getCookie()).toMatch(/Max-Age=0/)
  })
})
