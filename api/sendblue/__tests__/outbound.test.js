import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../../../lib/imessage-bridge.js', () => ({
  sendImessage: vi.fn()
}))

const { sendImessage } = await import('../../../lib/imessage-bridge.js')
const handler = (await import('../outbound.js')).default

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

describe('POST /api/sendblue/outbound', () => {
  it('returns 405 on non-POST', async () => {
    const { req, res } = makeReqRes({}, 'GET')
    await handler(req, res)
    expect(res.statusCode).toBe(405)
  })

  it('returns 400 when phone or message missing', async () => {
    const { req, res } = makeReqRes({ lead_id: 'lead_1' })
    await handler(req, res)
    expect(res.statusCode).toBe(400)
    expect(res._json.error).toMatch(/missing fields/)
  })

  it('extracts flat top-level fields from Close workflow webhook', async () => {
    sendImessage.mockResolvedValue({
      send: { message_handle: 'msg_1' },
      log: { ok: true, activityId: 'acti_1' },
      phone: '+15550100123'
    })
    const { req, res } = makeReqRes({
      lead_id: 'lead_abc',
      phone: '5550100123',
      message: 'Hi Jane'
    })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(sendImessage).toHaveBeenCalledWith(expect.objectContaining({
      leadId: 'lead_abc',
      phone: '5550100123',
      message: 'Hi Jane'
    }))
    expect(res._json.leadId).toBe('lead_abc')
    expect(res._json.logged).toBe(true)
  })

  it('extracts from Close standard event envelope', async () => {
    sendImessage.mockResolvedValue({
      send: { message_handle: 'msg_2' },
      log: { ok: true },
      phone: '+15550100123'
    })
    const { req, res } = makeReqRes({
      event: {
        lead_id: 'lead_event',
        data: {
          phone: '+15550100123',
          message: 'event-driven message'
        }
      }
    })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(sendImessage).toHaveBeenCalledWith(expect.objectContaining({
      leadId: 'lead_event',
      phone: '+15550100123',
      message: 'event-driven message'
    }))
  })

  it('accepts camelCase alternates', async () => {
    sendImessage.mockResolvedValue({
      send: { message_handle: 'm' },
      log: { ok: false, error: 'no leadId provided' },
      phone: '+15550100123'
    })
    const { req, res } = makeReqRes({
      leadId: 'lead_cc',
      phone: '+15550100123',
      message: 'hi'
    })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(sendImessage).toHaveBeenCalledWith(expect.objectContaining({
      leadId: 'lead_cc'
    }))
  })

  it('returns 502 when send fails', async () => {
    sendImessage.mockRejectedValue(new Error('SendBlue send failed: 500'))
    const { req, res } = makeReqRes({
      lead_id: 'lead_1',
      phone: '+15550100123',
      message: 'hi'
    })
    await handler(req, res)
    expect(res.statusCode).toBe(502)
  })
})
