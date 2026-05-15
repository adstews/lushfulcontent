import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../../lib/imessage-bridge.js', () => ({
  sendImessage: vi.fn()
}))

const { sendImessage } = await import('../../../../lib/imessage-bridge.js')
const { makeSessionCookie } = await import('../../../../lib/auth.js')
const handler = (await import('../reply.js')).default

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

afterEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/sendblue/console/reply', () => {
  it('returns 401 when unauthed', async () => {
    const res = makeRes()
    await handler(
      { method: 'POST', headers: {}, body: { leadId: 'l', phone: 'p', message: 'm' } },
      res
    )
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 when leadId missing', async () => {
    const res = makeRes()
    await handler(authedReq({ phone: '+1', message: 'hi' }), res)
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when phone missing', async () => {
    const res = makeRes()
    await handler(authedReq({ leadId: 'l', message: 'hi' }), res)
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when message missing', async () => {
    const res = makeRes()
    await handler(authedReq({ leadId: 'l', phone: '+1' }), res)
    expect(res.statusCode).toBe(400)
  })

  it('sends via sendImessage and returns ok', async () => {
    sendImessage.mockResolvedValue({
      send: { message_handle: 'sb_h' },
      log: { ok: true, activityId: 'acti_1' },
      phone: '+15550000000'
    })
    const res = makeRes()
    await handler(
      authedReq({ leadId: 'lead_1', phone: '+15550000000', message: 'hey' }),
      res
    )
    expect(res.statusCode).toBe(200)
    expect(res._json).toMatchObject({
      ok: true,
      phone: '+15550000000',
      messageHandle: 'sb_h',
      logged: true
    })
    expect(sendImessage).toHaveBeenCalledWith({
      phone: '+15550000000',
      message: 'hey',
      leadId: 'lead_1'
    })
  })

  it('returns 502 when send throws', async () => {
    sendImessage.mockRejectedValue(new Error('SendBlue send failed: 500'))
    const res = makeRes()
    await handler(
      authedReq({ leadId: 'l', phone: '+1', message: 'hi' }),
      res
    )
    expect(res.statusCode).toBe(502)
  })
})
