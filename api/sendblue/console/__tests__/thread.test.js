import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../../lib/close.js', () => ({
  listCustomActivities: vi.fn(),
  getLead: vi.fn()
}))

const { listCustomActivities, getLead } = await import('../../../../lib/close.js')
const { makeSessionCookie } = await import('../../../../lib/auth.js')
const handler = (await import('../thread.js')).default

function authedReq(query = {}) {
  const token = makeSessionCookie().split(';')[0]
  return { method: 'GET', headers: { cookie: token }, body: null, query }
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
  process.env.CLOSE_CUSTOM_ACTIVITY_IMESSAGE = 'actitype_im'
  process.env.CLOSE_CF_IMESSAGE_TEXT = 'cf_text'
  process.env.CLOSE_CF_IMESSAGE_DIRECTION = 'cf_dir'
  process.env.CLOSE_CF_IMESSAGE_PHONE = 'cf_phone'
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/sendblue/console/thread', () => {
  it('returns 401 when not authed', async () => {
    const res = makeRes()
    await handler({ method: 'GET', headers: {}, query: {} }, res)
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 when leadId missing', async () => {
    const res = makeRes()
    await handler(authedReq({}), res)
    expect(res.statusCode).toBe(400)
  })

  it('returns sorted messages and a reply phone from latest activity', async () => {
    listCustomActivities.mockResolvedValue({
      data: [
        { id: 'a2', lead_id: 'lead_1', 'custom.cf_text': 'second', 'custom.cf_dir': 'outbound', 'custom.cf_phone': '+15551111111', date_created: '2026-05-12T10:00:00Z' },
        { id: 'a1', lead_id: 'lead_1', 'custom.cf_text': 'first',  'custom.cf_dir': 'inbound',  'custom.cf_phone': '+15551111111', date_created: '2026-05-11T10:00:00Z' }
      ]
    })
    getLead.mockResolvedValue({
      id: 'lead_1',
      display_name: 'Jane Doe',
      contacts: [{ id: 'cont_1', phones: [{ phone: '+15552222222' }] }]
    })

    const res = makeRes()
    await handler(authedReq({ leadId: 'lead_1' }), res)

    expect(res.statusCode).toBe(200)
    expect(res._json.leadId).toBe('lead_1')
    expect(res._json.leadName).toBe('Jane Doe')
    expect(res._json.messages.map(m => m.id)).toEqual(['a1', 'a2'])
    expect(res._json.replyPhone).toBe('+15551111111') // from activity, not contact
  })

  it('falls back to lead contact phone when no activity phone exists', async () => {
    listCustomActivities.mockResolvedValue({ data: [] })
    getLead.mockResolvedValue({
      id: 'lead_1',
      display_name: 'Jane Doe',
      contacts: [{ id: 'cont_1', phones: [{ phone: '+15553333333' }] }]
    })

    const res = makeRes()
    await handler(authedReq({ leadId: 'lead_1' }), res)
    expect(res.statusCode).toBe(200)
    expect(res._json.messages).toEqual([])
    expect(res._json.replyPhone).toBe('+15553333333')
  })

  it('returns 502 when Close errors', async () => {
    listCustomActivities.mockRejectedValue(new Error('close down'))
    getLead.mockResolvedValue({})

    const res = makeRes()
    await handler(authedReq({ leadId: 'lead_1' }), res)
    expect(res.statusCode).toBe(502)
  })
})
