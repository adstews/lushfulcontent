import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the lib modules before importing the handler
vi.mock('../../lib/supabase.js', () => ({
  getSupabase: vi.fn()
}))
vi.mock('../../lib/mailchimp.js', () => ({
  upsertSubscriber: vi.fn(),
  addTags: vi.fn()
}))
vi.mock('../../lib/close.js', () => ({
  createLead: vi.fn()
}))

const { getSupabase } = await import('../../lib/supabase.js')
const { upsertSubscriber, addTags } = await import('../../lib/mailchimp.js')
const { createLead } = await import('../../lib/close.js')
const handler = (await import('../lead.js')).default

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

function mockSupabase({ upsertResult, leadRow, updateResult }) {
  const chain = {
    upsert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(upsertResult),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue(updateResult ?? { error: null }),
    insert: vi.fn().mockResolvedValue({ error: null })
  }
  getSupabase.mockReturnValue({
    from: vi.fn(() => chain)
  })
  return chain
}

beforeEach(() => {
  process.env.CLOSE_STATUS_NEW = 'stat_new'
  process.env.CLOSE_CF_SOURCE = 'cf_src'
  process.env.CLOSE_CF_UTM_SOURCE = 'cf_utms'
  process.env.CLOSE_CF_UTM_MEDIUM = 'cf_utmm'
  process.env.CLOSE_CF_UTM_CAMPAIGN = 'cf_utmc'
  process.env.CLOSE_CF_UTM_CONTENT = 'cf_utmcon'
  process.env.CLOSE_CF_FBCLID = 'cf_fb'
  process.env.CLOSE_CF_GCLID = 'cf_gc'
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/lead', () => {
  it('returns 405 on non-POST', async () => {
    const { req, res } = makeReqRes({})
    req.method = 'GET'
    await handler(req, res)
    expect(res.statusCode).toBe(405)
  })

  it('returns 400 on invalid body', async () => {
    const { req, res } = makeReqRes({ name: '' })  // missing email
    await handler(req, res)
    expect(res.statusCode).toBe(400)
    expect(res._json.error).toMatch(/validation/i)
  })

  it('upserts to Supabase, calls Mailchimp + Close, returns lead_id (consultation source)', async () => {
    mockSupabase({
      upsertResult: { data: { id: 'lead-uuid' }, error: null }
    })
    upsertSubscriber.mockResolvedValue({ subscriberHash: 'hash123' })
    addTags.mockResolvedValue()
    createLead.mockResolvedValue({ closeLeadId: 'close_lead_xyz' })

    const { req, res } = makeReqRes({
      name: 'Jane',
      email: 'jane@example.com',
      phone: '555-0100',
      source: 'girthfill-landing',
      utm_source: 'meta',
      utm_campaign: 'q2_girthfill'
    })
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res._json).toEqual({ lead_id: 'lead-uuid' })
    expect(upsertSubscriber).toHaveBeenCalled()
    expect(addTags).toHaveBeenCalledWith({
      email: 'jane@example.com',
      tags: ['girthfill-landing']
    })
    expect(createLead).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Jane',
      email: 'jane@example.com',
      statusId: 'stat_new'
    }))
  })

  it('skips Close for carousel source', async () => {
    mockSupabase({
      upsertResult: { data: { id: 'lead-uuid-2' }, error: null }
    })
    upsertSubscriber.mockResolvedValue({ subscriberHash: 'h' })
    addTags.mockResolvedValue()

    const { req, res } = makeReqRes({
      name: 'Bob',
      email: 'bob@example.com',
      phone: null,
      source: 'girthfill-carousel'
    })
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(createLead).not.toHaveBeenCalled()
    expect(addTags).toHaveBeenCalledWith({
      email: 'bob@example.com',
      tags: ['girthfill-carousel']
    })
  })

  it('returns 500 when Supabase upsert fails', async () => {
    mockSupabase({
      upsertResult: { data: null, error: { message: 'db down' } }
    })
    const { req, res } = makeReqRes({
      name: 'X',
      email: 'x@y.com',
      phone: null,
      source: 'girthfill-landing'
    })
    await handler(req, res)
    expect(res.statusCode).toBe(500)
    expect(createLead).not.toHaveBeenCalled()
  })

  it('omits empty optional custom fields from Close payload', async () => {
    mockSupabase({
      upsertResult: { data: { id: 'lead-uuid-3' }, error: null }
    })
    upsertSubscriber.mockResolvedValue({ subscriberHash: 'h' })
    addTags.mockResolvedValue()
    createLead.mockResolvedValue({ closeLeadId: 'close_lead_xyz' })

    const { req, res } = makeReqRes({
      name: 'X',
      email: 'x@y.com',
      phone: null,
      source: 'girthfill-landing',
      utm_source: 'meta'
      // no utm_medium, utm_campaign, utm_content, fbclid, gclid
    })
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(createLead).toHaveBeenCalledTimes(1)
    const { customFields } = createLead.mock.calls[0][0]
    expect(Object.keys(customFields)).toContain('cf_src')
    expect(Object.keys(customFields)).toContain('cf_utms')
    expect(Object.keys(customFields)).not.toContain('cf_utmm')
    expect(Object.keys(customFields)).not.toContain('cf_utmc')
    expect(Object.keys(customFields)).not.toContain('cf_utmcon')
    expect(Object.keys(customFields)).not.toContain('cf_fb')
    expect(Object.keys(customFields)).not.toContain('cf_gc')
  })

  it('still returns success when Mailchimp fails (best-effort)', async () => {
    const chain = mockSupabase({
      upsertResult: { data: { id: 'lead-id' }, error: null }
    })
    upsertSubscriber.mockRejectedValue(new Error('mailchimp down'))
    createLead.mockResolvedValue({ closeLeadId: 'cl_x' })

    const { req, res } = makeReqRes({
      name: 'X',
      email: 'x@y.com',
      phone: null,
      source: 'girthfill-landing'
    })
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    // verify lead_sync_errors got a row
    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({
      service: 'mailchimp',
      operation: 'create'
    }))
  })
})
