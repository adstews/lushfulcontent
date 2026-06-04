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
  process.env.CLOSE_CF_UTM_TERM = 'cf_utmt'
  process.env.CLOSE_CF_FBCLID = 'cf_fb'
  process.env.CLOSE_CF_GCLID = 'cf_gc'
  process.env.CLOSE_CF_REFERRER = 'cf_ref'
  process.env.CLOSE_CF_LANDING_PAGE = 'cf_lp'
  process.env.CLOSE_STATUS_HOLETOX_NEW = 'stat_holetox_new'
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
      tags: ['girthfill-landing', 'SQ Lander']
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
      tags: ['girthfill-carousel', 'SQ Lander']
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
      // no utm_medium, utm_campaign, utm_content, utm_term, fbclid, gclid, referrer, landing_page
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
    expect(Object.keys(customFields)).not.toContain('cf_utmt')
    expect(Object.keys(customFields)).not.toContain('cf_fb')
    expect(Object.keys(customFields)).not.toContain('cf_gc')
    expect(Object.keys(customFields)).not.toContain('cf_ref')
    expect(Object.keys(customFields)).not.toContain('cf_lp')
  })

  it('forwards utm_term, referrer, and landing_page to Close customFields', async () => {
    mockSupabase({
      upsertResult: { data: { id: 'lead-uuid-attr' }, error: null }
    })
    upsertSubscriber.mockResolvedValue({ subscriberHash: 'h' })
    addTags.mockResolvedValue()
    createLead.mockResolvedValue({ closeLeadId: 'close_lead_attr' })

    const { req, res } = makeReqRes({
      name: 'Attribution Tester',
      email: 'attr@example.com',
      phone: '555-0303',
      source: 'girthfill-nyc',
      utm_source: 'meta',
      utm_medium: 'cpc',
      utm_campaign: 'q2_girthfill',
      utm_content: 'hero_video',
      utm_term: 'penis enlargement nyc',
      fbclid: 'fb.1.abc',
      gclid: 'EAIaIQobChMI.gclid.xyz',
      referrer: 'https://www.facebook.com/',
      landing_page: 'https://lushfulcontent.vercel.app/girthfill-nyc?utm_source=meta&utm_campaign=q2_girthfill'
    })
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(createLead).toHaveBeenCalledTimes(1)
    const { customFields } = createLead.mock.calls[0][0]
    expect(customFields['cf_src']).toBe('girthfill-nyc')
    expect(customFields['cf_utms']).toBe('meta')
    expect(customFields['cf_utmm']).toBe('cpc')
    expect(customFields['cf_utmc']).toBe('q2_girthfill')
    expect(customFields['cf_utmcon']).toBe('hero_video')
    expect(customFields['cf_utmt']).toBe('penis enlargement nyc')
    expect(customFields['cf_fb']).toBe('fb.1.abc')
    expect(customFields['cf_gc']).toBe('EAIaIQobChMI.gclid.xyz')
    expect(customFields['cf_ref']).toBe('https://www.facebook.com/')
    expect(customFields['cf_lp']).toBe('https://lushfulcontent.vercel.app/girthfill-nyc?utm_source=meta&utm_campaign=q2_girthfill')
  })

  it('errors out (logged to lead_sync_errors) when new required Close env vars are missing', async () => {
    delete process.env.CLOSE_CF_REFERRER
    const chain = mockSupabase({
      upsertResult: { data: { id: 'lead-uuid-missing' }, error: null }
    })
    upsertSubscriber.mockResolvedValue({ subscriberHash: 'h' })
    addTags.mockResolvedValue()

    const { req, res } = makeReqRes({
      name: 'X',
      email: 'x@y.com',
      phone: null,
      source: 'girthfill-landing'
    })
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(createLead).not.toHaveBeenCalled()
    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({
      service: 'close',
      operation: 'create',
      error_message: expect.stringContaining('CLOSE_CF_REFERRER')
    }))
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

  it('accepts source = girthfill-nyc-google and tags Mailchimp with that source', async () => {
    mockSupabase({
      upsertResult: { data: { id: 'lead-uuid' }, error: null }
    })
    upsertSubscriber.mockResolvedValue({ subscriberHash: 'hash123' })
    addTags.mockResolvedValue()
    createLead.mockResolvedValue({ closeLeadId: 'close_lead_xyz' })

    const { req, res } = makeReqRes({
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '555-0100',
      source: 'girthfill-nyc-google'
    })
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(addTags).toHaveBeenCalledWith({
      email: 'jane@example.com',
      tags: ['girthfill-nyc-google', 'SQ Lander']
    })
    // Step 1 contact submit does NOT send qualified, so Close should
    // be created with the NEW (Potential) status.
    expect(createLead).toHaveBeenCalledWith(
      expect.objectContaining({
        statusId: 'stat_new'
      })
    )
  })

  it('accepts source = girthfill-sd-google', async () => {
    mockSupabase({
      upsertResult: { data: { id: 'lead-uuid' }, error: null }
    })
    upsertSubscriber.mockResolvedValue({ subscriberHash: 'hash123' })
    addTags.mockResolvedValue()
    createLead.mockResolvedValue({ closeLeadId: 'close_lead_xyz' })

    const { req, res } = makeReqRes({
      name: 'John Smith',
      email: 'john@example.com',
      phone: '555-0200',
      source: 'girthfill-sd-google'
    })
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(addTags).toHaveBeenCalledWith({
      email: 'john@example.com',
      tags: ['girthfill-sd-google', 'SQ Lander']
    })
  })

  it('routes holetox-nyc to the Holetox - New status and adds the Holetox tag', async () => {
    mockSupabase({ upsertResult: { data: { id: 'lead-holetox' }, error: null } })
    upsertSubscriber.mockResolvedValue({ subscriberHash: 'h' })
    addTags.mockResolvedValue()
    createLead.mockResolvedValue({ closeLeadId: 'close_holetox' })

    const { req, res } = makeReqRes({
      name: 'Sam', email: 'sam@example.com', phone: '555-0400', source: 'holetox-nyc'
    })
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(addTags).toHaveBeenCalledWith({
      email: 'sam@example.com',
      tags: ['holetox-nyc', 'SQ Lander', 'Holetox']
    })
    expect(createLead).toHaveBeenCalledWith(expect.objectContaining({ statusId: 'stat_holetox_new' }))
  })

  it('accepts source = holetox-sd and routes to Holetox - New', async () => {
    mockSupabase({ upsertResult: { data: { id: 'lead-holetox-sd' }, error: null } })
    upsertSubscriber.mockResolvedValue({ subscriberHash: 'h' })
    addTags.mockResolvedValue()
    createLead.mockResolvedValue({ closeLeadId: 'close_holetox_sd' })

    const { req, res } = makeReqRes({
      name: 'Lee', email: 'lee@example.com', phone: '555-0500', source: 'holetox-sd'
    })
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(createLead).toHaveBeenCalledWith(expect.objectContaining({ statusId: 'stat_holetox_new' }))
  })
})
