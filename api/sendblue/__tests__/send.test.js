import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../lib/imessage-bridge.js', () => ({
  sendImessage: vi.fn()
}))

const { sendImessage } = await import('../../../lib/imessage-bridge.js')
const handler = (await import('../send.js')).default

function makeReqRes(body, method = 'POST') {
  const req = { method, body }
  const res = {
    statusCode: 200,
    _json: null,
    status(code) { this.statusCode = code; return this },
    json(obj) { this._json = obj; return this }
  }
  return { req, res }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/sendblue/send', () => {
  it('returns 405 on non-POST', async () => {
    const { req, res } = makeReqRes({}, 'GET')
    await handler(req, res)
    expect(res.statusCode).toBe(405)
  })

  it('returns 400 on missing phone or message', async () => {
    const { req, res } = makeReqRes({ phone: '+15550100123' })
    await handler(req, res)
    expect(res.statusCode).toBe(400)
  })

  it('sends and returns ok', async () => {
    sendImessage.mockResolvedValue({
      send: { message_handle: 'msg_x' },
      log: { ok: false, error: 'no leadId provided' },
      phone: '+15550100123'
    })
    const { req, res } = makeReqRes({
      phone: '555-010-0123',
      message: 'hello'
    })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res._json).toEqual({
      ok: true,
      phone: '+15550100123',
      messageHandle: 'msg_x',
      logged: false,
      logError: 'no leadId provided'
    })
    expect(sendImessage).toHaveBeenCalledWith(expect.objectContaining({
      phone: '555-010-0123',
      message: 'hello'
    }))
  })

  it('reports logged:true when leadId provided and activity created', async () => {
    sendImessage.mockResolvedValue({
      send: { message_handle: 'msg_x' },
      log: { ok: true, activityId: 'acti_1' },
      phone: '+15550100123'
    })
    const { req, res } = makeReqRes({
      phone: '+15550100123',
      message: 'hello',
      leadId: 'lead_1'
    })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res._json.logged).toBe(true)
    expect(res._json.logError).toBeNull()
  })

  it('returns 502 when SendBlue fails', async () => {
    sendImessage.mockRejectedValue(new Error('SendBlue send failed: 401'))
    const { req, res } = makeReqRes({
      phone: '+15550100123',
      message: 'hi'
    })
    await handler(req, res)
    expect(res.statusCode).toBe(502)
    expect(res._json.error).toMatch(/SendBlue send failed: 401/)
  })
})
