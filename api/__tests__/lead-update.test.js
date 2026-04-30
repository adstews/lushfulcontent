import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../lib/supabase.js', () => ({
  getSupabase: vi.fn()
}))
vi.mock('../../lib/mailchimp.js', () => ({
  addTags: vi.fn()
}))
vi.mock('../../lib/close.js', () => ({
  updateLead: vi.fn()
}))

const { getSupabase } = await import('../../lib/supabase.js')
const { addTags } = await import('../../lib/mailchimp.js')
const { updateLead } = await import('../../lib/close.js')
const handler = (await import('../lead-update.js')).default

function makeReqRes(body) {
  const req = { method: 'POST', body }
  const res = {
    statusCode: 200,
    _json: null,
    status(code) { this.statusCode = code; return this },
    json(obj) { this._json = obj; return this }
  }
  return { req, res }
}

function mockSupabase({ leadRow, leadError }) {
  const fromChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: leadRow ?? null, error: leadError ?? null }),
    update: vi.fn().mockReturnThis(),
    insert: vi.fn().mockResolvedValue({ error: null })
  }
  // The .update().eq() chain needs eq to resolve (not chain to single)
  fromChain.update = vi.fn(() => ({
    eq: vi.fn().mockResolvedValue({ error: null })
  }))
  getSupabase.mockReturnValue({
    from: vi.fn(() => fromChain)
  })
  return fromChain
}

beforeEach(() => {
  process.env.CLOSE_STATUS_QUALIFIED = 'stat_q'
  process.env.CLOSE_STATUS_BAD_FIT = 'stat_bf'
  process.env.CLOSE_CF_QUALIFIED = 'cf_q'
  process.env.CLOSE_CF_CTA_CLICKED = 'cf_cta'
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/lead-update', () => {
  it('returns 405 on non-POST', async () => {
    const { req, res } = makeReqRes({})
    req.method = 'GET'
    await handler(req, res)
    expect(res.statusCode).toBe(405)
  })

  it('returns 400 when neither qualified nor cta_clicked is provided', async () => {
    const { req, res } = makeReqRes({ lead_id: '00000000-0000-0000-0000-000000000000' })
    await handler(req, res)
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 when lead row is missing', async () => {
    mockSupabase({ leadRow: null, leadError: { code: 'PGRST116' } })
    const { req, res } = makeReqRes({
      lead_id: '00000000-0000-0000-0000-000000000000',
      qualified: true
    })
    await handler(req, res)
    expect(res.statusCode).toBe(404)
  })

  it('updates Supabase, tags Mailchimp qualified, updates Close (qualified=true, consultation lead)', async () => {
    mockSupabase({
      leadRow: {
        id: 'lead-uuid',
        email: 'jane@example.com',
        source: 'girthfill-landing',
        close_lead_id: 'close_x'
      }
    })
    addTags.mockResolvedValue()
    updateLead.mockResolvedValue()

    const { req, res } = makeReqRes({ lead_id: 'lead-uuid', qualified: true })
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(addTags).toHaveBeenCalledWith({
      email: 'jane@example.com',
      tags: ['girthfill-qualified']
    })
    expect(updateLead).toHaveBeenCalledWith({
      leadId: 'close_x',
      statusId: 'stat_q',
      customFields: { cf_q: 'Yes' }
    })
  })

  it('uses not-qualified tag and Bad Fit status when qualified=false', async () => {
    mockSupabase({
      leadRow: {
        id: 'lead-uuid',
        email: 'jane@example.com',
        source: 'girthfill-landing',
        close_lead_id: 'close_x'
      }
    })
    const { req, res } = makeReqRes({ lead_id: 'lead-uuid', qualified: false })
    await handler(req, res)
    expect(addTags).toHaveBeenCalledWith({
      email: 'jane@example.com',
      tags: ['girthfill-not-qualified']
    })
    expect(updateLead).toHaveBeenCalledWith(expect.objectContaining({
      statusId: 'stat_bf',
      customFields: { cf_q: 'No' }
    }))
  })

  it('skips Close when source is carousel', async () => {
    mockSupabase({
      leadRow: {
        id: 'lead-uuid',
        email: 'jane@example.com',
        source: 'girthfill-carousel',
        close_lead_id: null
      }
    })
    const { req, res } = makeReqRes({ lead_id: 'lead-uuid', qualified: true })
    await handler(req, res)
    expect(updateLead).not.toHaveBeenCalled()
  })

  it('only updates Close (no Mailchimp tag) when only cta_clicked is sent', async () => {
    mockSupabase({
      leadRow: {
        id: 'lead-uuid',
        email: 'jane@example.com',
        source: 'girthfill-landing',
        close_lead_id: 'close_x'
      }
    })
    const { req, res } = makeReqRes({ lead_id: 'lead-uuid', cta_clicked: 'book' })
    await handler(req, res)
    expect(addTags).not.toHaveBeenCalled()
    expect(updateLead).toHaveBeenCalledWith({
      leadId: 'close_x',
      statusId: undefined,
      customFields: { cf_cta: 'Book Appointment' }
    })
  })
})
