import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../lib/sendblue.js', () => ({
  checkAuth: vi.fn()
}))
vi.mock('../../../lib/blooio.js', () => ({
  checkAuth: vi.fn()
}))
vi.mock('../../../lib/close.js', () => ({
  getMe: vi.fn()
}))

const { checkAuth: sbCheckAuth } = await import('../../../lib/sendblue.js')
const { checkAuth: blCheckAuth } = await import('../../../lib/blooio.js')
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
  delete process.env.BLOOIO_API_KEY
  delete process.env.BLOOIO_WEBHOOK_SIGNING_SECRET
  delete process.env.IMESSAGE_PROVIDER
})

afterEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Default path: Blooio (IMESSAGE_PROVIDER unset)
// ---------------------------------------------------------------------------
describe('GET /api/sendblue/health — blooio provider (default)', () => {
  it('returns 200 with blooio + close ok', async () => {
    blCheckAuth.mockResolvedValue([])
    getMe.mockResolvedValue({ id: 'user_1' })
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res._json.ok).toBe(true)
    expect(res._json.checks).toEqual([
      { service: 'blooio', ok: true },
      { service: 'close', ok: true }
    ])
    expect(res._json.env.BLOOIO_API_KEY).toBe(false)
    expect(res._json.env.CLOSE_CUSTOM_ACTIVITY_IMESSAGE).toBe(true)
  })

  it('returns 503 when Blooio check fails', async () => {
    blCheckAuth.mockRejectedValue(new Error('Blooio auth check failed: 401'))
    getMe.mockResolvedValue({ id: 'user_1' })
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(res.statusCode).toBe(503)
    expect(res._json.ok).toBe(false)
    expect(res._json.checks[0]).toMatchObject({ service: 'blooio', ok: false })
    expect(res._json.checks[1]).toMatchObject({ service: 'close', ok: true })
  })

  it('does not call sendblue checkAuth when provider is blooio', async () => {
    blCheckAuth.mockResolvedValue([])
    getMe.mockResolvedValue({})
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(sbCheckAuth).not.toHaveBeenCalled()
    expect(blCheckAuth).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// SendBlue path: IMESSAGE_PROVIDER=sendblue
// ---------------------------------------------------------------------------
describe('GET /api/sendblue/health — sendblue provider', () => {
  beforeEach(() => {
    process.env.IMESSAGE_PROVIDER = 'sendblue'
  })

  it('returns 200 with both ok when both APIs respond', async () => {
    sbCheckAuth.mockResolvedValue({ name: 'workspace' })
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
    sbCheckAuth.mockRejectedValue(new Error('SendBlue auth check failed: 401'))
    getMe.mockResolvedValue({ id: 'user_1' })
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(res.statusCode).toBe(503)
    expect(res._json.ok).toBe(false)
    expect(res._json.checks[0]).toMatchObject({ service: 'sendblue', ok: false })
    expect(res._json.checks[1]).toMatchObject({ service: 'close', ok: true })
  })

  it('returns 503 when Close check fails', async () => {
    sbCheckAuth.mockResolvedValue({})
    getMe.mockRejectedValue(new Error('Close /me failed: 401'))
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(res.statusCode).toBe(503)
    expect(res._json.checks[1].ok).toBe(false)
  })

  it('does not call blooio checkAuth when provider is sendblue', async () => {
    sbCheckAuth.mockResolvedValue({})
    getMe.mockResolvedValue({})
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(blCheckAuth).not.toHaveBeenCalled()
    expect(sbCheckAuth).toHaveBeenCalledOnce()
  })
})
