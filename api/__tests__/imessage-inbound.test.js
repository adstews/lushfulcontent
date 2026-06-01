import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'node:crypto'
vi.mock('../../lib/close.js', () => ({ findLeadByPhone: vi.fn() }))
vi.mock('../../lib/imessage-bridge.js', () => ({ logImessageActivity: vi.fn() }))
vi.mock('../../lib/web-push.js', () => ({ pushToAll: vi.fn() }))
vi.mock('../../lib/opt-outs.js', () => ({ suppressPhone: vi.fn() }))
vi.mock('../../lib/sequences.js', async (orig) => ({ ...(await orig()), unenrollAllForLead: vi.fn(), pauseEnrollmentsForLead: vi.fn() }))

const { findLeadByPhone } = await import('../../lib/close.js')
const { logImessageActivity } = await import('../../lib/imessage-bridge.js')
const { pushToAll } = await import('../../lib/web-push.js')
const { suppressPhone } = await import('../../lib/opt-outs.js')
const { unenrollAllForLead, pauseEnrollmentsForLead } = await import('../../lib/sequences.js')
const handler = (await import('../imessage/inbound.js')).default

const SECRET = 'whsec_test'
function signed(payload) {
  const raw = JSON.stringify(payload)
  const t = Math.floor(Date.now() / 1000)
  const v1 = crypto.createHmac('sha256', SECRET).update(`${t}.${raw}`).digest('hex')
  return { raw, header: `t=${t},v1=${v1}` }
}
function makeReqRes(payload) {
  const { raw, header } = signed(payload)
  const req = { method: 'POST', rawBody: raw, headers: { 'x-blooio-signature': header } }
  const res = { statusCode: 200, _json: null, status(c){this.statusCode=c;return this}, json(o){this._json=o;return this} }
  return { req, res }
}

beforeEach(() => {
  process.env.BLOOIO_WEBHOOK_SIGNING_SECRET = SECRET
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-06-01T00:00:00Z'))
  pushToAll.mockResolvedValue({ ok: true, sent: 0 })
  pauseEnrollmentsForLead.mockResolvedValue({ affected: 0 })
})
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

describe('POST /api/imessage/inbound', () => {
  it('401 on bad signature', async () => {
    const { req, res } = makeReqRes({ event: 'message.received', sender: '+15550100123', text: 'hi' })
    req.headers['x-blooio-signature'] = 't=1,v1=bad'
    await handler(req, res)
    expect(res.statusCode).toBe(401)
  })
  it('message.received with no lead → suppress only on STOP, matched:false', async () => {
    findLeadByPhone.mockResolvedValue(null)
    const { req, res } = makeReqRes({ event: 'message.received', sender: '+15550100123', text: 'STOP' })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res._json.matched).toBe(false)
    expect(suppressPhone).toHaveBeenCalledWith(expect.objectContaining({ phone: '+15550100123', leadId: null }))
  })
  it('message.received with lead → logs + pauses on a normal reply', async () => {
    findLeadByPhone.mockResolvedValue({ closeLeadId: 'lead_1', contactId: null, displayName: 'A' })
    logImessageActivity.mockResolvedValue({ ok: true })
    pauseEnrollmentsForLead.mockResolvedValue({ affected: 1 })
    const { req, res } = makeReqRes({ event: 'message.received', sender: '+15550100123', text: 'hello', message_id: 'm1' })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(logImessageActivity).toHaveBeenCalledWith(expect.objectContaining({ leadId: 'lead_1', direction: 'inbound', message: 'hello', phone: '+15550100123' }))
    expect(pauseEnrollmentsForLead).toHaveBeenCalled()
    expect(suppressPhone).not.toHaveBeenCalled()
  })
  it('ignores non-message events (200 skip)', async () => {
    const { req, res } = makeReqRes({ event: 'message.delivered', message_id: 'm1' })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(findLeadByPhone).not.toHaveBeenCalled()
  })
})
