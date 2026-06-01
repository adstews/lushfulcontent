import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../lib/sequences.js', () => ({
  findSequencesForStatusTrigger: vi.fn(),
  enrollLead: vi.fn(),
  unenrollAllForLead: vi.fn()
}))

const { findSequencesForStatusTrigger, enrollLead, unenrollAllForLead } = await import('../../../lib/sequences.js')
const handler = (await import('../close-webhook.js')).default

function makeReqRes(body, { method = 'POST', headers = {}, url = '/api/sendblue/close-webhook' } = {}) {
  return {
    req: { method, body, headers, url },
    res: {
      statusCode: 200,
      _json: null,
      status(c) { this.statusCode = c; return this },
      json(o) { this._json = o; return this }
    }
  }
}

beforeEach(() => {
  delete process.env.CLOSE_WEBHOOK_SECRET
  process.env.CLOSE_STATUS_CALL_BOOKED = 'stat_call'
  process.env.CLOSE_STATUS_APPT_BOOKED = 'stat_appt'
})

afterEach(() => { vi.clearAllMocks() })

describe('POST /api/sendblue/close-webhook', () => {
  it('returns 405 on GET', async () => {
    const { req, res } = makeReqRes({}, { method: 'GET' })
    await handler(req, res)
    expect(res.statusCode).toBe(405)
  })

  it('returns 401 when secret configured but missing', async () => {
    process.env.CLOSE_WEBHOOK_SECRET = 'shh'
    const { req, res } = makeReqRes({})
    await handler(req, res)
    expect(res.statusCode).toBe(401)
  })

  it('accepts matching secret on query', async () => {
    process.env.CLOSE_WEBHOOK_SECRET = 'shh'
    const { req, res } = makeReqRes(
      { event: { object_type: 'lead', action: 'updated', data: { id: 'L1', status_id: 's_new' }, previous_data: { status_id: 's_old' } } },
      { url: '/api/sendblue/close-webhook?secret=shh' }
    )
    findSequencesForStatusTrigger.mockResolvedValue([])
    await handler(req, res)
    expect(res.statusCode).toBe(200)
  })

  it('skips non-lead events', async () => {
    const { req, res } = makeReqRes({
      event: { object_type: 'activity', action: 'created', data: {} }
    })
    await handler(req, res)
    expect(res._json.skipped).toBeDefined()
    expect(findSequencesForStatusTrigger).not.toHaveBeenCalled()
  })

  it('skips when status did not change', async () => {
    const { req, res } = makeReqRes({
      event: {
        object_type: 'lead', action: 'updated',
        data: { id: 'L1', status_id: 'stat_a' },
        previous_data: { status_id: 'stat_a' }
      }
    })
    await handler(req, res)
    expect(res._json.skipped).toBeDefined()
    expect(findSequencesForStatusTrigger).not.toHaveBeenCalled()
  })

  it('enrolls lead in matching sequences on status transition', async () => {
    findSequencesForStatusTrigger.mockResolvedValue([
      { id: 'seq1', name: 'Welcome' },
      { id: 'seq2', name: 'Follow up' }
    ])
    enrollLead.mockImplementation(async ({ sequenceId }) => ({ id: `enrol_${sequenceId}` }))

    const { req, res } = makeReqRes({
      event: {
        object_type: 'lead', action: 'updated',
        data: {
          id: 'L1', status_id: 'stat_qualified',
          contacts: [{ id: 'cont_1', phones: [{ phone: '+15550100123' }] }]
        },
        previous_data: { status_id: 'stat_potential' }
      }
    })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(findSequencesForStatusTrigger).toHaveBeenCalledWith('stat_qualified')
    expect(enrollLead).toHaveBeenCalledTimes(2)
    expect(enrollLead).toHaveBeenCalledWith(expect.objectContaining({
      sequenceId: 'seq1', leadId: 'L1', phone: '+15550100123', contactId: 'cont_1'
    }))
    expect(res._json.enrolled).toHaveLength(2)
  })

  it('returns matched:0 when no sequences match', async () => {
    findSequencesForStatusTrigger.mockResolvedValue([])
    const { req, res } = makeReqRes({
      event: {
        object_type: 'lead', action: 'updated',
        data: { id: 'L1', status_id: 'stat_qualified' },
        previous_data: { status_id: 'stat_potential' }
      }
    })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res._json.matched).toBe(0)
  })

  it('unenrolls and does not enroll when the new status is a booked status', async () => {
    unenrollAllForLead.mockResolvedValue({ affected: 1 })
    const { req, res } = makeReqRes({
      event: {
        object_type: 'lead', action: 'updated',
        data: { id: 'lead_b', status_id: 'stat_call' },
        previous_data: { status_id: 'stat_potential' }
      }
    })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(unenrollAllForLead).toHaveBeenCalledWith('lead_b', 'booked')
    expect(res._json.unenrolled).toBe(true)
    expect(findSequencesForStatusTrigger).not.toHaveBeenCalled()
  })

  it('still enrolls on a non-booked status transition', async () => {
    findSequencesForStatusTrigger.mockResolvedValue([{ id: 'seq1', name: 'Drip' }])
    enrollLead.mockResolvedValue({ id: 'enr1' })
    const { req, res } = makeReqRes({
      event: {
        object_type: 'lead', action: 'updated',
        data: { id: 'lead_c', status_id: 'stat_qualified', contacts: [{ id: 'c1', phones: [{ phone: '+15550100123' }] }] },
        previous_data: { status_id: 'stat_potential' }
      }
    })
    await handler(req, res)
    expect(unenrollAllForLead).not.toHaveBeenCalled()
    expect(enrollLead).toHaveBeenCalled()
  })
})
