import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../lib/supabase.js', () => ({ getSupabase: vi.fn() }))
vi.mock('../../lib/close.js', () => ({
  createLead: vi.fn(),
  updateLead: vi.fn(),
  createNote: vi.fn(),
  findLeadByEmail: vi.fn(),
  findLeadByPhone: vi.fn()
}))
// Keep parseInviteeCreated real; stub the signature + raw-body helpers.
vi.mock('../../lib/calendly.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, readRawBody: vi.fn(), verifySignature: vi.fn() }
})

const { getSupabase } = await import('../../lib/supabase.js')
const close = await import('../../lib/close.js')
const calendly = await import('../../lib/calendly.js')
const handler = (await import('../calendly-webhook.js')).default

function makeReqRes() {
  const req = { method: 'POST', headers: { 'calendly-webhook-signature': 't=1,v1=sig' } }
  const res = {
    statusCode: 200,
    _json: null,
    status(code) { this.statusCode = code; return this },
    json(obj) { this._json = obj; return this }
  }
  return { req, res }
}

// Flexible Supabase stub. Captures inserts/upserts for assertions.
function mockSupabase({ dedup = [], leadsByEmail = [], upsertId = 'sb-new' } = {}) {
  const calls = { inserts: {}, upserts: {} }
  function from(table) {
    return {
      select() { return this },
      eq() { return this },
      ilike() { return this },
      not() { return this },
      limit() {
        if (table === 'calendly_bookings') return Promise.resolve({ data: dedup, error: null })
        if (table === 'leads') return Promise.resolve({ data: leadsByEmail, error: null })
        return Promise.resolve({ data: [], error: null })
      },
      insert(row) {
        calls.inserts[table] = (calls.inserts[table] || []).concat([row])
        return Promise.resolve({ error: null })
      },
      upsert(row) {
        calls.upserts[table] = (calls.upserts[table] || []).concat([row])
        return { select() { return { single() { return Promise.resolve({ data: { id: upsertId }, error: null }) } } } }
      }
    }
  }
  getSupabase.mockReturnValue({ from })
  return calls
}

const INVITEE = {
  event: 'invitee.created',
  payload: {
    name: 'Jane Doe',
    email: 'jane@example.com',
    text_reminder_number: '+15551234567',
    timezone: 'America/New_York',
    uri: 'https://api.calendly.com/scheduled_events/EVT/invitees/INV',
    event: 'https://api.calendly.com/scheduled_events/EVT',
    questions_and_answers: [{ question: 'Goal?', answer: 'Bigger' }],
    tracking: { utm_source: 'email', utm_campaign: 'reactivation' },
    scheduled_event: { name: '30 Minute Meeting', start_time: '2026-06-03T18:00:00Z' }
  }
}

beforeEach(() => {
  process.env.CALENDLY_WEBHOOK_SIGNING_KEY = 'whsec_test'
  process.env.CLOSE_STATUS_CALL_BOOKED = 'stat_call'
  process.env.CLOSE_CF_BOOKED = 'cf_booked'
  process.env.CLOSE_CF_SOURCE = 'cf_source'
  process.env.CLOSE_CF_UTM_SOURCE = 'cf_utm_source'
  process.env.CLOSE_CF_UTM_CAMPAIGN = 'cf_utm_campaign'
  calendly.verifySignature.mockReturnValue(true)
  calendly.readRawBody.mockResolvedValue(JSON.stringify(INVITEE))
})
afterEach(() => { vi.clearAllMocks() })

describe('POST /api/calendly-webhook', () => {
  it('405 on non-POST', async () => {
    const { req, res } = makeReqRes()
    req.method = 'GET'
    await handler(req, res)
    expect(res.statusCode).toBe(405)
  })

  it('401 on bad signature', async () => {
    calendly.verifySignature.mockReturnValue(false)
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(res.statusCode).toBe(401)
    expect(close.updateLead).not.toHaveBeenCalled()
  })

  it('200 skip for non invitee.created', async () => {
    calendly.readRawBody.mockResolvedValue(JSON.stringify({ event: 'invitee.canceled' }))
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res._json.skipped).toBeDefined()
    expect(close.updateLead).not.toHaveBeenCalled()
  })

  it('200 skip when already processed (dedup)', async () => {
    mockSupabase({ dedup: [{ id: 'existing' }] })
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res._json.skipped).toBe('already processed')
    expect(close.updateLead).not.toHaveBeenCalled()
    expect(close.createLead).not.toHaveBeenCalled()
  })

  it('matches an existing lead by email via Supabase → Call Booked + note', async () => {
    const calls = mockSupabase({ leadsByEmail: [{ id: 'sb1', close_lead_id: 'lead_1' }] })
    const { req, res } = makeReqRes()
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(close.findLeadByEmail).not.toHaveBeenCalled()
    expect(close.updateLead).toHaveBeenCalledWith({
      leadId: 'lead_1',
      statusId: 'stat_call',
      customFields: { cf_booked: 'Call' }
    })
    expect(close.createNote).toHaveBeenCalledWith(expect.objectContaining({ leadId: 'lead_1' }))
    expect(calls.inserts.calendly_bookings[0]).toMatchObject({
      invitee_uri: INVITEE.payload.uri,
      close_lead_id: 'lead_1',
      matched_by: 'email'
    })
  })

  it('falls back to Close email search when not in Supabase', async () => {
    mockSupabase({ leadsByEmail: [] })
    close.findLeadByEmail.mockResolvedValue({ closeLeadId: 'lead_2' })
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(close.updateLead).toHaveBeenCalledWith(expect.objectContaining({ leadId: 'lead_2' }))
  })

  it('falls back to phone search when email finds nothing', async () => {
    mockSupabase({ leadsByEmail: [] })
    close.findLeadByEmail.mockResolvedValue(null)
    close.findLeadByPhone.mockResolvedValue({ closeLeadId: 'lead_3' })
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(close.findLeadByPhone).toHaveBeenCalledWith('+15551234567')
    expect(close.updateLead).toHaveBeenCalledWith(expect.objectContaining({ leadId: 'lead_3' }))
  })

  it('creates a tagged lead with UTM when nothing matches', async () => {
    const calls = mockSupabase({ leadsByEmail: [] })
    close.findLeadByEmail.mockResolvedValue(null)
    close.findLeadByPhone.mockResolvedValue(null)
    close.createLead.mockResolvedValue({ closeLeadId: 'lead_new' })
    const { req, res } = makeReqRes()
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(close.updateLead).not.toHaveBeenCalled()
    expect(close.createLead).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '+15551234567',
      statusId: 'stat_call',
      customFields: expect.objectContaining({
        cf_source: 'calendly-direct',
        cf_booked: 'Call',
        cf_utm_source: 'email',
        cf_utm_campaign: 'reactivation'
      })
    }))
    expect(close.createNote).toHaveBeenCalledWith(expect.objectContaining({ leadId: 'lead_new' }))
    expect(calls.upserts.leads[0]).toMatchObject({
      source: 'calendly-direct',
      cta_clicked: 'book-calendly',
      close_lead_id: 'lead_new',
      utm_source: 'email'
    })
    expect(calls.inserts.calendly_bookings[0]).toMatchObject({ matched_by: 'created' })
  })

  it('logs a note containing the booking summary + answers', async () => {
    mockSupabase({ leadsByEmail: [{ id: 'sb1', close_lead_id: 'lead_1' }] })
    const { req, res } = makeReqRes()
    await handler(req, res)
    const note = close.createNote.mock.calls[0][0].note
    expect(note).toContain('Calendly booking confirmed')
    expect(note).toContain('30 Minute Meeting')
    expect(note).toContain('Goal?: Bigger')
  })

  it('200 skip when payload has no email', async () => {
    calendly.readRawBody.mockResolvedValue(JSON.stringify({
      event: 'invitee.created',
      payload: { uri: 'u', email: '' }
    }))
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res._json.skipped).toBeDefined()
    expect(close.updateLead).not.toHaveBeenCalled()
  })

  it('500 + records lead_sync_errors when a Close write throws', async () => {
    const calls = mockSupabase({ leadsByEmail: [{ id: 'sb1', close_lead_id: 'lead_1' }] })
    close.updateLead.mockRejectedValue(new Error('close boom'))
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(res.statusCode).toBe(500)
    expect(calls.inserts.lead_sync_errors[0]).toMatchObject({ service: 'calendly' })
    expect(calls.inserts.calendly_bookings).toBeUndefined()
  })
})
