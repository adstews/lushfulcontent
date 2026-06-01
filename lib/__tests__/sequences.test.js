import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../supabase.js', () => ({
  getSupabase: vi.fn()
}))
vi.mock('../opt-outs.js', () => ({ isSuppressed: vi.fn() }))

const { getSupabase } = await import('../supabase.js')
const { isSuppressed } = await import('../opt-outs.js')
const {
  enrollLead,
  isStopKeyword,
  renderTemplate,
  pauseEnrollmentsForLead,
  unenrollAllForLead,
  findDueSends,
  tryAdvanceEnrollment,
  recordSend
} = await import('../sequences.js')

beforeEach(() => { isSuppressed.mockResolvedValue(false) })
afterEach(() => { vi.clearAllMocks() })

describe('isStopKeyword', () => {
  it('matches the documented STOP keywords case-insensitively', () => {
    expect(isStopKeyword('STOP')).toBe(true)
    expect(isStopKeyword('stop')).toBe(true)
    expect(isStopKeyword('  Stop. ')).toBe(true)
    expect(isStopKeyword('unsubscribe')).toBe(true)
    expect(isStopKeyword('END')).toBe(true)
    expect(isStopKeyword('CANCEL')).toBe(true)
    expect(isStopKeyword('quit')).toBe(true)
    expect(isStopKeyword('stopall')).toBe(true)
  })
  it('does NOT match messages that just contain stop', () => {
    expect(isStopKeyword('please stop calling me')).toBe(false)
    expect(isStopKeyword('I will stop soon')).toBe(false)
  })
  it('handles non-strings', () => {
    expect(isStopKeyword(null)).toBe(false)
    expect(isStopKeyword(undefined)).toBe(false)
    expect(isStopKeyword(42)).toBe(false)
  })
})

describe('renderTemplate', () => {
  it('substitutes simple lead vars', () => {
    expect(renderTemplate('Hi {{lead.display_name}}!', { lead: { display_name: 'Jane' } }))
      .toBe('Hi Jane!')
  })
  it('handles nested paths', () => {
    expect(renderTemplate('Phone: {{lead.contact.phone}}', { lead: { contact: { phone: '+15550100123' } } }))
      .toBe('Phone: +15550100123')
  })
  it('returns empty string for missing vars (does not break the message)', () => {
    expect(renderTemplate('Hi {{lead.missing_field}}!', { lead: {} }))
      .toBe('Hi !')
  })
  it('returns empty for null template', () => {
    expect(renderTemplate(null)).toBe('')
  })
})

describe('pauseEnrollmentsForLead', () => {
  function mockChain({ enrollments, sequences, updateError = null }) {
    const updateMock = vi.fn().mockReturnValue({
      eq: () => Promise.resolve({ error: updateError })
    })
    getSupabase.mockReturnValue({
      from: (table) => {
        if (table === 'imessage_sequence_enrollments') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => Promise.resolve({ data: enrollments, error: null })
              })
            }),
            update: updateMock
          }
        }
        if (table === 'imessage_sequences') {
          return {
            select: () => ({
              in: () => Promise.resolve({ data: sequences, error: null })
            })
          }
        }
      }
    })
    return updateMock
  }

  it('returns affected:0 when no active enrollments', async () => {
    mockChain({ enrollments: [], sequences: [] })
    const r = await pauseEnrollmentsForLead('lead_1', 'reply')
    expect(r.affected).toBe(0)
  })

  it('pauses pause-behavior enrollments', async () => {
    const updateMock = mockChain({
      enrollments: [{ id: 'e1', sequence_id: 's1' }, { id: 'e2', sequence_id: 's2' }],
      sequences: [{ id: 's1', on_reply_behavior: 'pause' }, { id: 's2', on_reply_behavior: 'pause' }]
    })
    const r = await pauseEnrollmentsForLead('lead_1', 'reply')
    expect(r.affected).toBe(2)
    expect(r.total).toBe(2)
    // Each update should have been called with status: 'paused'
    const calls = updateMock.mock.calls
    expect(calls.every(c => c[0].status === 'paused')).toBe(true)
  })

  it('unenrolls behavior=unenroll enrollments', async () => {
    const updateMock = mockChain({
      enrollments: [{ id: 'e1', sequence_id: 's1' }],
      sequences: [{ id: 's1', on_reply_behavior: 'unenroll' }]
    })
    await pauseEnrollmentsForLead('lead_1', 'reply')
    expect(updateMock.mock.calls[0][0].status).toBe('unenrolled')
  })

  it('skips continue-behavior enrollments', async () => {
    const updateMock = mockChain({
      enrollments: [{ id: 'e1', sequence_id: 's1' }],
      sequences: [{ id: 's1', on_reply_behavior: 'continue' }]
    })
    const r = await pauseEnrollmentsForLead('lead_1', 'reply')
    expect(r.affected).toBe(0)
    expect(updateMock).not.toHaveBeenCalled()
  })
})

describe('unenrollAllForLead', () => {
  it('hard-unenrolls regardless of behavior', async () => {
    const updateMock = vi.fn().mockReturnValue({
      eq: () => ({
        in: () => Promise.resolve({ error: null })
      })
    })
    getSupabase.mockReturnValue({
      from: () => ({ update: updateMock })
    })
    await unenrollAllForLead('lead_1', 'stop')
    expect(updateMock.mock.calls[0][0].status).toBe('unenrolled')
    expect(updateMock.mock.calls[0][0].paused_reason).toBe('stop')
  })
})

describe('findDueSends', () => {
  function mockChain({ enrollments, steps }) {
    getSupabase.mockReturnValue({
      from: (table) => {
        if (table === 'imessage_sequence_enrollments') {
          return {
            select: () => ({
              eq: () => ({
                limit: () => Promise.resolve({ data: enrollments, error: null })
              })
            })
          }
        }
        if (table === 'imessage_sequence_steps') {
          return {
            select: () => ({
              in: () => ({
                order: () => ({
                  order: () => Promise.resolve({ data: steps, error: null })
                })
              })
            })
          }
        }
      }
    })
  }

  it('returns only enrollments whose next step is past its scheduled time', async () => {
    const now = new Date('2026-05-15T12:00:00Z')
    mockChain({
      enrollments: [
        // due — enrolled 2h ago, step delay 1h
        { id: 'e1', sequence_id: 's1', lead_id: 'L1', next_step_position: 0,
          enrolled_at: '2026-05-15T10:00:00Z' },
        // not due — enrolled 30 min ago, step delay 1h
        { id: 'e2', sequence_id: 's1', lead_id: 'L2', next_step_position: 0,
          enrolled_at: '2026-05-15T11:30:00Z' }
      ],
      steps: [
        { id: 'st1', sequence_id: 's1', delay_seconds: 3600, position: 0,
          message_template: 'hi' }
      ]
    })
    const due = await findDueSends({ now })
    expect(due.length).toBe(1)
    expect(due[0].enrollment.id).toBe('e1')
  })

  it('skips enrollments past their last step', async () => {
    const now = new Date('2026-05-15T12:00:00Z')
    mockChain({
      enrollments: [
        { id: 'e1', sequence_id: 's1', lead_id: 'L1', next_step_position: 99,
          enrolled_at: '2026-05-15T00:00:00Z' }
      ],
      steps: [
        { id: 'st1', sequence_id: 's1', delay_seconds: 0, position: 0, message_template: 'hi' }
      ]
    })
    const due = await findDueSends({ now })
    expect(due.length).toBe(0)
  })
})

describe('tryAdvanceEnrollment', () => {
  it('returns true when the row was advanced', async () => {
    getSupabase.mockReturnValue({
      from: () => ({
        update: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                select: () => Promise.resolve({ data: [{ id: 'e1' }], error: null })
              })
            })
          })
        })
      })
    })
    expect(await tryAdvanceEnrollment('e1', 0)).toBe(true)
  })

  it('returns false when no row matched (race)', async () => {
    getSupabase.mockReturnValue({
      from: () => ({
        update: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                select: () => Promise.resolve({ data: [], error: null })
              })
            })
          })
        })
      })
    })
    expect(await tryAdvanceEnrollment('e1', 0)).toBe(false)
  })
})

describe('recordSend', () => {
  it('returns false on duplicate-key error (idempotency)', async () => {
    getSupabase.mockReturnValue({
      from: () => ({
        insert: () => Promise.resolve({ error: { message: 'duplicate key value violates unique constraint' } })
      })
    })
    expect(
      await recordSend({ enrollmentId: 'e1', stepId: 'st1', scheduledFor: new Date(), sentAt: new Date() })
    ).toBe(false)
  })

  it('returns true on success', async () => {
    getSupabase.mockReturnValue({
      from: () => ({
        insert: () => Promise.resolve({ error: null })
      })
    })
    expect(
      await recordSend({ enrollmentId: 'e1', stepId: 'st1', scheduledFor: new Date(), sentAt: new Date() })
    ).toBe(true)
  })
})

describe('enrollLead suppression guard', () => {
  it('skips and does not touch supabase when the lead is opted out', async () => {
    isSuppressed.mockResolvedValue(true)
    const from = vi.fn()
    getSupabase.mockReturnValue({ from })
    const r = await enrollLead({ sequenceId: 's1', leadId: 'lead_1', phone: '+15550100123' })
    expect(r.skipped).toBe('opted-out')
    expect(from).not.toHaveBeenCalled()
  })
})
