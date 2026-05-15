import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../../lib/web-push.js', () => ({
  recordSubscription: vi.fn(),
  removeSubscription: vi.fn(),
  getPublicKey: vi.fn()
}))

const { recordSubscription, removeSubscription, getPublicKey } = await import('../../../../lib/web-push.js')
const { makeSessionCookie } = await import('../../../../lib/auth.js')
const handler = (await import('../push-subscribe.js')).default

function authedReq(method, body) {
  const token = makeSessionCookie().split(';')[0]
  return { method, headers: { cookie: token, 'user-agent': 'test-ua' }, body, query: {} }
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

describe('/api/sendblue/console/push-subscribe', () => {
  it('GET returns the VAPID public key when authed', async () => {
    getPublicKey.mockReturnValue('PUB_KEY_BASE64')
    const res = makeRes()
    await handler(authedReq('GET'), res)
    expect(res.statusCode).toBe(200)
    expect(res._json.publicKey).toBe('PUB_KEY_BASE64')
  })

  it('GET returns 500 when public key not configured', async () => {
    getPublicKey.mockReturnValue(null)
    const res = makeRes()
    await handler(authedReq('GET'), res)
    expect(res.statusCode).toBe(500)
  })

  it('POST records the subscription and returns id', async () => {
    recordSubscription.mockResolvedValue({ id: 'sub_uuid' })
    const res = makeRes()
    await handler(authedReq('POST', {
      endpoint: 'https://push.example.com/abc',
      keys: { p256dh: 'p', auth: 'a' }
    }), res)
    expect(res.statusCode).toBe(200)
    expect(res._json).toEqual({ ok: true, id: 'sub_uuid' })
    expect(recordSubscription).toHaveBeenCalledWith({
      endpoint: 'https://push.example.com/abc',
      p256dh: 'p',
      auth: 'a',
      userAgent: 'test-ua'
    })
  })

  it('POST returns 400 on missing endpoint', async () => {
    const res = makeRes()
    await handler(authedReq('POST', { keys: { p256dh: 'p', auth: 'a' } }), res)
    expect(res.statusCode).toBe(400)
  })

  it('POST returns 400 on missing keys', async () => {
    const res = makeRes()
    await handler(authedReq('POST', { endpoint: 'https://e' }), res)
    expect(res.statusCode).toBe(400)
  })

  it('DELETE removes the subscription', async () => {
    removeSubscription.mockResolvedValue()
    const res = makeRes()
    await handler(authedReq('DELETE', { endpoint: 'https://push.example.com/abc' }), res)
    expect(res.statusCode).toBe(200)
    expect(removeSubscription).toHaveBeenCalledWith('https://push.example.com/abc')
  })

  it('returns 401 unauthed for all verbs', async () => {
    const res1 = makeRes()
    await handler({ method: 'GET', headers: {} }, res1)
    expect(res1.statusCode).toBe(401)

    const res2 = makeRes()
    await handler({ method: 'POST', headers: {}, body: {} }, res2)
    expect(res2.statusCode).toBe(401)
  })

  it('returns 405 on PATCH', async () => {
    const res = makeRes()
    await handler(authedReq('PATCH', {}), res)
    expect(res.statusCode).toBe(405)
  })
})
