import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../lib/sequences.js', () => ({
  findDueSends: vi.fn(),
  tryAdvanceEnrollment: vi.fn(),
  recordSend: vi.fn(),
  markCompleted: vi.fn(),
  renderTemplate: (s) => s ?? '',
  unenrollAllForLead: vi.fn()
}))
vi.mock('../../../lib/scheduled-messages.js', () => ({
  findDueScheduledMessages: vi.fn(),
  claimScheduledMessage: vi.fn(),
  markScheduledSent: vi.fn(),
  markScheduledFailed: vi.fn()
}))
vi.mock('../../../lib/imessage-bridge.js', () => ({
  sendImessage: vi.fn()
}))
vi.mock('../../../lib/close.js', () => ({
  getLead: vi.fn()
}))

const { findDueSends, tryAdvanceEnrollment, recordSend, markCompleted } = await import('../../../lib/sequences.js')
const { sendImessage } = await import('../../../lib/imessage-bridge.js')
const { getLead } = await import('../../../lib/close.js')
const { findDueScheduledMessages, claimScheduledMessage, markScheduledSent, markScheduledFailed } =
  await import('../../../lib/scheduled-messages.js')
const handler = (await import('../sequence-tick.js')).default

function makeReqRes({ auth = 'cron-secret', headers = {} } = {}) {
  return {
    req: {
      method: 'GET',
      headers: { authorization: auth ? `Bearer ${auth}` : undefined, ...headers }
    },
    res: {
      statusCode: 200,
      _json: null,
      status(c) { this.statusCode = c; return this },
      json(o) { this._json = o; return this }
    }
  }
}

beforeEach(() => {
  process.env.CRON_SECRET = 'cron-secret'
  getLead.mockResolvedValue({
    id: 'L1', display_name: 'Test',
    contacts: [{ phones: [{ phone: '+15550100123' }] }]
  })
  findDueScheduledMessages.mockResolvedValue([])
})

afterEach(() => { vi.clearAllMocks() })

describe('GET /api/cron/sequence-tick', () => {
  it('returns 401 when no auth', async () => {
    const { req, res } = makeReqRes({ auth: '' })
    await handler(req, res)
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 on wrong bearer', async () => {
    const { req, res } = makeReqRes({ auth: 'wrong' })
    await handler(req, res)
    expect(res.statusCode).toBe(401)
  })

  it('accepts x-vercel-cron header without bearer', async () => {
    findDueSends.mockResolvedValue([])
    const { req, res } = makeReqRes({ auth: '', headers: { 'x-vercel-cron': '1' } })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
  })

  it('reports 0 fired when nothing due', async () => {
    findDueSends.mockResolvedValue([])
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res._json.fired).toBe(0)
  })

  it('fires a due send and advances the enrollment', async () => {
    findDueSends.mockResolvedValue([{
      enrollment: { id: 'e1', sequence_id: 's1', lead_id: 'L1', next_step_position: 0, phone: '+15550100123', contact_id: null },
      step: { id: 'st1', message_template: 'hi', media_url: null },
      scheduledFor: new Date(),
      totalSteps: 3
    }])
    tryAdvanceEnrollment.mockResolvedValue(true)
    sendImessage.mockResolvedValue({ send: { message_handle: 'msg_h' }, log: { ok: true } })
    recordSend.mockResolvedValue(true)

    const { req, res } = makeReqRes()
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res._json.fired).toBe(1)
    expect(sendImessage).toHaveBeenCalledWith(expect.objectContaining({
      phone: '+15550100123',
      message: 'hi',
      leadId: 'L1'
    }))
    expect(markCompleted).not.toHaveBeenCalled()
  })

  it('marks enrollment completed when firing the last step', async () => {
    findDueSends.mockResolvedValue([{
      enrollment: { id: 'e1', sequence_id: 's1', lead_id: 'L1', next_step_position: 2, phone: '+15550100123', contact_id: null },
      step: { id: 'st3', message_template: 'bye', media_url: null },
      scheduledFor: new Date(),
      totalSteps: 3
    }])
    tryAdvanceEnrollment.mockResolvedValue(true)
    sendImessage.mockResolvedValue({ send: { message_handle: 'h' }, log: { ok: true } })
    recordSend.mockResolvedValue(true)

    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(res._json.completed).toBe(1)
    expect(markCompleted).toHaveBeenCalledWith('e1')
  })

  it('skips when tryAdvance loses the race', async () => {
    findDueSends.mockResolvedValue([{
      enrollment: { id: 'e1', sequence_id: 's1', lead_id: 'L1', next_step_position: 0, phone: '+15550100123' },
      step: { id: 'st1', message_template: 'hi' },
      scheduledFor: new Date(),
      totalSteps: 2
    }])
    tryAdvanceEnrollment.mockResolvedValue(false)

    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(res._json.fired).toBe(0)
    expect(sendImessage).not.toHaveBeenCalled()
  })

  it('records error when send fails', async () => {
    findDueSends.mockResolvedValue([{
      enrollment: { id: 'e1', sequence_id: 's1', lead_id: 'L1', next_step_position: 0, phone: '+15550100123' },
      step: { id: 'st1', message_template: 'hi' },
      scheduledFor: new Date(),
      totalSteps: 2
    }])
    tryAdvanceEnrollment.mockResolvedValue(true)
    sendImessage.mockRejectedValue(new Error('SendBlue down'))

    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(res._json.fired).toBe(0)
    expect(res._json.failed).toBe(1)
    expect(recordSend).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringContaining('SendBlue down')
    }))
  })

  it('drains a due scheduled message via sendImessage', async () => {
    findDueSends.mockResolvedValue([])
    findDueScheduledMessages.mockResolvedValue([
      { id: 'm1', phone: '+15550100123', message: 'reminder', media_url: null, close_lead_id: 'lead_1' }
    ])
    claimScheduledMessage.mockResolvedValue(true)
    sendImessage.mockResolvedValue({ send: { message_handle: 'h1' }, log: { ok: true } })

    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(sendImessage).toHaveBeenCalledWith(expect.objectContaining({
      phone: '+15550100123', message: 'reminder', leadId: 'lead_1'
    }))
    expect(markScheduledSent).toHaveBeenCalledWith('m1', expect.objectContaining({ handle: 'h1' }))
    expect(res._json.reminders).toMatchObject({ sent: 1 })
  })

  it('marks a scheduled message failed when the recipient is opted out', async () => {
    findDueSends.mockResolvedValue([])
    findDueScheduledMessages.mockResolvedValue([
      { id: 'm2', phone: '+15550100124', message: 'reminder', media_url: null, close_lead_id: 'lead_2' }
    ])
    claimScheduledMessage.mockResolvedValue(true)
    sendImessage.mockRejectedValue(new Error('recipient opted out (STOP)'))

    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(markScheduledFailed).toHaveBeenCalledWith('m2', expect.stringContaining('opted out'))
    expect(res._json.reminders).toMatchObject({ failed: 1 })
  })

  it('skips a scheduled message it cannot claim (race)', async () => {
    findDueSends.mockResolvedValue([])
    findDueScheduledMessages.mockResolvedValue([{ id: 'm3', phone: '+1', message: 'x', media_url: null, close_lead_id: null }])
    claimScheduledMessage.mockResolvedValue(false)
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(sendImessage).not.toHaveBeenCalled()
  })
})
