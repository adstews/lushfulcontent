import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../lib/close.js', () => ({
  findLeadByPhone: vi.fn()
}))
vi.mock('../../../lib/imessage-bridge.js', () => ({
  logImessageActivity: vi.fn()
}))
vi.mock('../../../lib/web-push.js', () => ({
  pushToAll: vi.fn()
}))
vi.mock('../../../lib/supabase.js', () => ({
  getSupabase: vi.fn()
}))
vi.mock('../../../lib/opt-outs.js', () => ({ suppressPhone: vi.fn() }))
vi.mock('../../../lib/sequences.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, unenrollAllForLead: vi.fn(), pauseEnrollmentsForLead: vi.fn() }
})

const { findLeadByPhone } = await import('../../../lib/close.js')
const { logImessageActivity } = await import('../../../lib/imessage-bridge.js')
const { pushToAll } = await import('../../../lib/web-push.js')
const { getSupabase } = await import('../../../lib/supabase.js')
const { suppressPhone } = await import('../../../lib/opt-outs.js')
const { unenrollAllForLead, pauseEnrollmentsForLead } = await import('../../../lib/sequences.js')
const handler = (await import('../inbound.js')).default

function makeReqRes(body, { method = 'POST', headers = {}, url = '/api/sendblue/inbound' } = {}) {
  const req = { method, body, headers, url }
  const res = {
    statusCode: 200,
    _json: null,
    status(code) { this.statusCode = code; return this },
    json(obj) { this._json = obj; return this }
  }
  return { req, res }
}

beforeEach(() => {
  delete process.env.SENDBLUE_WEBHOOK_SECRET
  pushToAll.mockResolvedValue({ ok: true, sent: 0 })
  // Default supabase mock — reaction events insert; tests that care override.
  const insert = vi.fn().mockResolvedValue({ error: null })
  getSupabase.mockReturnValue({ from: () => ({ insert }) })
  pauseEnrollmentsForLead.mockResolvedValue({ affected: 0 })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/sendblue/inbound', () => {
  it('returns 405 on non-POST', async () => {
    const { req, res } = makeReqRes({}, { method: 'GET' })
    await handler(req, res)
    expect(res.statusCode).toBe(405)
  })

  it('returns 401 when secret is set but missing on request', async () => {
    process.env.SENDBLUE_WEBHOOK_SECRET = 'shh'
    const { req, res } = makeReqRes({
      from_number: '+15550100123',
      content: 'hi'
    })
    await handler(req, res)
    expect(res.statusCode).toBe(401)
  })

  it('accepts matching secret via X-Webhook-Secret header', async () => {
    process.env.SENDBLUE_WEBHOOK_SECRET = 'shh'
    findLeadByPhone.mockResolvedValue(null)
    const { req, res } = makeReqRes(
      { from_number: '+15550100123', content: 'hi' },
      { headers: { 'x-webhook-secret': 'shh' } }
    )
    await handler(req, res)
    expect(res.statusCode).toBe(200)
  })

  it('accepts matching secret via ?secret= query param', async () => {
    process.env.SENDBLUE_WEBHOOK_SECRET = 'shh'
    findLeadByPhone.mockResolvedValue(null)
    const { req, res } = makeReqRes(
      { from_number: '+15550100123', content: 'hi' },
      { url: '/api/sendblue/inbound?secret=shh' }
    )
    await handler(req, res)
    expect(res.statusCode).toBe(200)
  })

  it('returns 400 on missing from/content', async () => {
    const { req, res } = makeReqRes({ from_number: '+15550100123' })
    await handler(req, res)
    expect(res.statusCode).toBe(400)
  })

  it('returns 200 with matched:false when no lead found', async () => {
    findLeadByPhone.mockResolvedValue(null)
    const { req, res } = makeReqRes({
      from_number: '+15550100123',
      content: 'hello back'
    })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res._json.matched).toBe(false)
    expect(logImessageActivity).not.toHaveBeenCalled()
  })

  it('logs a custom activity when lead is found', async () => {
    findLeadByPhone.mockResolvedValue({
      closeLeadId: 'lead_abc',
      contactId: 'cont_1',
      displayName: 'Jane'
    })
    logImessageActivity.mockResolvedValue({ ok: true, activityId: 'acti_xyz' })
    pushToAll.mockResolvedValue({ ok: true, sent: 2, total: 2 })

    const { req, res } = makeReqRes({
      from_number: '5550100123',
      content: 'hi from iMessage',
      media_url: 'https://example.com/x.jpg',
      message_handle: 'sb_handle_1'
    })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(findLeadByPhone).toHaveBeenCalledWith('+15550100123')
    expect(logImessageActivity).toHaveBeenCalledWith({
      leadId: 'lead_abc',
      leadName: 'Jane',
      contactId: 'cont_1',
      direction: 'inbound',
      message: 'hi from iMessage',
      phone: '+15550100123',
      mediaUrl: 'https://example.com/x.jpg',
      sendblueHandle: 'sb_handle_1'
    })
    expect(pushToAll).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Jane',
      body: 'hi from iMessage',
      tag: 'lead:lead_abc'
    }))
    expect(res._json).toMatchObject({
      ok: true,
      matched: true,
      leadId: 'lead_abc',
      logged: true,
      pushed: 2
    })
  })

  it('handles reaction events: persists + pushes notification', async () => {
    findLeadByPhone.mockResolvedValue({ closeLeadId: 'lead_r', contactId: null, displayName: 'Reactor' })
    const insert = vi.fn().mockResolvedValue({ error: null })
    getSupabase.mockReturnValue({ from: () => ({ insert }) })
    pushToAll.mockResolvedValue({ ok: true, sent: 1 })

    const { req, res } = makeReqRes({
      type: 'reaction',
      from_number: '+15550100123',
      message_handle: 'sb_target',
      reaction: 'love'
    })
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res._json.kind).toBe('reaction')
    expect(res._json.reaction).toBe('love')
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      message_handle: 'sb_target',
      lead_id: 'lead_r',
      direction: 'inbound',
      reaction: 'love',
      removed: false
    }))
    // logImessageActivity should NOT be called on reaction events
    expect(logImessageActivity).not.toHaveBeenCalled()
  })

  it('allows media-only inbound messages (no content)', async () => {
    findLeadByPhone.mockResolvedValue({ closeLeadId: 'lead_m', contactId: null, displayName: 'M' })
    logImessageActivity.mockResolvedValue({ ok: true })

    const { req, res } = makeReqRes({
      from_number: '+15550100123',
      media_url: 'https://cdn.example.com/x.jpg'
    })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(logImessageActivity).toHaveBeenCalledWith(expect.objectContaining({
      mediaUrl: 'https://cdn.example.com/x.jpg',
      message: ''
    }))
  })

  it('still returns 200 when push fan-out throws', async () => {
    findLeadByPhone.mockResolvedValue({ closeLeadId: 'lead_z', contactId: null, displayName: 'Z' })
    logImessageActivity.mockResolvedValue({ ok: true })
    pushToAll.mockRejectedValue(new Error('push exploded'))

    const { req, res } = makeReqRes({ from_number: '+15550100123', content: 'hi' })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res._json.matched).toBe(true)
    expect(res._json.pushed).toBe(0)
  })

  it('returns 502 when Close lookup throws', async () => {
    findLeadByPhone.mockRejectedValue(new Error('Close lead search failed: 500'))
    const { req, res } = makeReqRes({
      from_number: '+15550100123',
      content: 'hi'
    })
    await handler(req, res)
    expect(res.statusCode).toBe(502)
  })

  it('returns logged:false with error when activity creation fails', async () => {
    findLeadByPhone.mockResolvedValue({
      closeLeadId: 'lead_x',
      contactId: null,
      displayName: 'X'
    })
    logImessageActivity.mockResolvedValue({ ok: false, error: 'CLOSE_CUSTOM_ACTIVITY_IMESSAGE not set' })
    const { req, res } = makeReqRes({
      from_number: '+15550100123',
      content: 'hi'
    })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res._json.logged).toBe(false)
    expect(res._json.logError).toMatch(/CLOSE_CUSTOM_ACTIVITY_IMESSAGE/)
  })

  it('STOP with no matched lead still suppresses the number', async () => {
    findLeadByPhone.mockResolvedValue(null)
    const { req, res } = makeReqRes({ from_number: '+15550100123', content: 'STOP' })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res._json.matched).toBe(false)
    expect(suppressPhone).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '+15550100123', leadId: null })
    )
    expect(unenrollAllForLead).not.toHaveBeenCalled()
  })

  it('STOP with a matched lead suppresses + unenrolls + still logs', async () => {
    findLeadByPhone.mockResolvedValue({ closeLeadId: 'lead_s', contactId: null, displayName: 'S' })
    logImessageActivity.mockResolvedValue({ ok: true })
    const { req, res } = makeReqRes({ from_number: '+15550100123', content: 'stop' })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(suppressPhone).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '+15550100123', leadId: 'lead_s' })
    )
    expect(unenrollAllForLead).toHaveBeenCalledWith('lead_s', expect.any(String))
    expect(logImessageActivity).toHaveBeenCalled()
    expect(pauseEnrollmentsForLead).not.toHaveBeenCalled()
  })

  it('non-STOP reply pauses, does not suppress', async () => {
    findLeadByPhone.mockResolvedValue({ closeLeadId: 'lead_p', contactId: null, displayName: 'P' })
    logImessageActivity.mockResolvedValue({ ok: true })
    pauseEnrollmentsForLead.mockResolvedValue({ affected: 1 })
    const { req, res } = makeReqRes({ from_number: '+15550100123', content: 'sounds good' })
    await handler(req, res)
    expect(suppressPhone).not.toHaveBeenCalled()
    expect(pauseEnrollmentsForLead).toHaveBeenCalledWith('lead_p', expect.any(String))
  })
})
