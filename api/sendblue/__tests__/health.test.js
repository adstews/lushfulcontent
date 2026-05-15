import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../lib/sendblue.js', () => ({
  checkAuth: vi.fn()
}))
vi.mock('../../../lib/close.js', () => ({
  getMe: vi.fn()
}))

const { checkAuth } = await import('../../../lib/sendblue.js')
const { getMe } = await import('../../../lib/close.js')
const handler = (await import('../health.js')).default

function makeReqRes() {
  const req = { method: 'GET' }
  const res = {
    statusCode: 200,
    _json: null,
    status(code) { this.statusCode = code; return this },
    json(obj) { this._json = obj; return this }
  }
  return { req, res }
}

beforeEach(() => {
  process.env.SENDBLUE_API_KEY = 'k'
  process.env.SENDBLUE_API_SECRET = 's'
  process.env.CLOSE_API_KEY = 'c'
  process.env.CLOSE_CUSTOM_ACTIVITY_IMESSAGE = 'actitype_im'
  delete process.env.SENDBLUE_WEBHOOK_SECRET
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/sendblue/health', () => {
  it('returns 200 with both ok when both APIs respond', async () => {
    checkAuth.mockResolvedValue({ name: 'workspace' })
    getMe.mockResolvedValue({ id: 'user_1' })
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res._json.ok).toBe(true)
    expect(res._json.checks).toEqual([
      { service: 'sendblue', ok: true },
      { service: 'close', ok: true }
    ])
    expect(res._json.env.SENDBLUE_API_KEY).toBe(true)
    expect(res._json.env.CLOSE_CUSTOM_ACTIVITY_IMESSAGE).toBe(true)
    expect(res._json.env.SENDBLUE_WEBHOOK_SECRET).toBe(false)
  })

  it('returns 503 when SendBlue check fails', async () => {
    checkAuth.mockRejectedValue(new Error('SendBlue auth check failed: 401'))
    getMe.mockResolvedValue({ id: 'user_1' })
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(res.statusCode).toBe(503)
    expect(res._json.ok).toBe(false)
    expect(res._json.checks[0]).toMatchObject({ service: 'sendblue', ok: false })
    expect(res._json.checks[1]).toMatchObject({ service: 'close', ok: true })
  })

  it('returns 503 when Close check fails', async () => {
    checkAuth.mockResolvedValue({})
    getMe.mockRejectedValue(new Error('Close /me failed: 401'))
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(res.statusCode).toBe(503)
    expect(res._json.checks[1].ok).toBe(false)
  })
})
