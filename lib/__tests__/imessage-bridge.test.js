import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../sendblue.js', async () => {
  const actual = await vi.importActual('../sendblue.js')
  return {
    ...actual,
    sendMessage: vi.fn()
  }
})
vi.mock('../close.js', () => ({
  createCustomActivity: vi.fn()
}))
vi.mock('../supabase.js', () => ({
  getSupabase: vi.fn()
}))
vi.mock('../opt-outs.js', () => ({ isSuppressed: vi.fn() }))

const { sendMessage } = await import('../sendblue.js')
const { createCustomActivity } = await import('../close.js')
const { getSupabase } = await import('../supabase.js')
const { isSuppressed } = await import('../opt-outs.js')
const { sendImessage, logImessageActivity } = await import('../imessage-bridge.js')

function mockSupabaseInsert(returnValue = { error: null }) {
  const insert = vi.fn().mockResolvedValue(returnValue)
  getSupabase.mockReturnValue({ from: () => ({ insert }) })
  return insert
}

beforeEach(() => {
  process.env.CLOSE_CUSTOM_ACTIVITY_IMESSAGE = 'actitype_im'
  process.env.CLOSE_CF_IMESSAGE_TEXT = 'cf_text'
  process.env.CLOSE_CF_IMESSAGE_DIRECTION = 'cf_dir'
  process.env.CLOSE_CF_IMESSAGE_PHONE = 'cf_phone'
  delete process.env.CLOSE_CF_IMESSAGE_MEDIA_URL
  delete process.env.CLOSE_CF_IMESSAGE_HANDLE
  isSuppressed.mockResolvedValue(false)
})

afterEach(() => {
  vi.clearAllMocks()
})

// Default supabase mock for tests that don't care — every logImessageActivity
// call goes through mirrorToInbox now, which needs getSupabase to return a chainable.
beforeEach(() => {
  mockSupabaseInsert()
})

describe('logImessageActivity', () => {
  it('returns ok:false when CLOSE_CUSTOM_ACTIVITY_IMESSAGE missing', async () => {
    delete process.env.CLOSE_CUSTOM_ACTIVITY_IMESSAGE
    const result = await logImessageActivity({
      leadId: 'lead_1',
      direction: 'inbound',
      message: 'hi',
      phone: '+15550100123'
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/CLOSE_CUSTOM_ACTIVITY_IMESSAGE/)
  })

  it('returns ok:false when leadId missing', async () => {
    const result = await logImessageActivity({
      direction: 'inbound',
      message: 'hi',
      phone: '+15550100123'
    })
    expect(result.ok).toBe(false)
  })

  it('builds custom fields from configured env vars + mirrors to supabase', async () => {
    createCustomActivity.mockResolvedValue({ id: 'acti_1' })
    const insert = mockSupabaseInsert()
    const result = await logImessageActivity({
      leadId: 'lead_1',
      leadName: 'Jane',
      contactId: 'cont_1',
      direction: 'outbound',
      message: 'hi there',
      phone: '+15550100123'
    })
    expect(createCustomActivity).toHaveBeenCalledWith({
      leadId: 'lead_1',
      activityTypeId: 'actitype_im',
      contactId: 'cont_1',
      customFields: {
        cf_text: 'hi there',
        cf_dir: 'outbound',
        cf_phone: '+15550100123'
      },
      note: undefined
    })
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      close_activity_id: 'acti_1',
      lead_id: 'lead_1',
      lead_name: 'Jane',
      contact_id: 'cont_1',
      direction: 'outbound',
      message: 'hi there',
      phone: '+15550100123'
    }))
    expect(result).toEqual({ ok: true, activityId: 'acti_1', mirrored: true })
  })

  it('still mirrors to supabase when Close write fails', async () => {
    createCustomActivity.mockRejectedValue(new Error('Close down'))
    const insert = mockSupabaseInsert()
    const result = await logImessageActivity({
      leadId: 'lead_x',
      direction: 'inbound',
      message: 'hi',
      phone: '+15550100123'
    })
    expect(insert).toHaveBeenCalled()
    expect(result.ok).toBe(false)
    expect(result.mirrored).toBe(true)
  })

  it('returns mirrored:false when supabase insert fails', async () => {
    createCustomActivity.mockResolvedValue({ id: 'acti_1' })
    mockSupabaseInsert({ error: { message: 'pg down' } })
    const result = await logImessageActivity({
      leadId: 'lead_1',
      direction: 'inbound',
      message: 'hi',
      phone: '+15550100123'
    })
    expect(result.ok).toBe(true)
    expect(result.mirrored).toBe(false)
  })

  it('falls back to note when no text custom field is configured', async () => {
    delete process.env.CLOSE_CF_IMESSAGE_TEXT
    createCustomActivity.mockResolvedValue({ id: 'acti_2' })
    await logImessageActivity({
      leadId: 'lead_1',
      direction: 'inbound',
      message: 'hi',
      phone: '+15550100123'
    })
    const call = createCustomActivity.mock.calls[0][0]
    expect(call.note).toBe('[inbound] hi')
    expect(call.customFields.cf_text).toBeUndefined()
  })

  it('returns ok:false when createCustomActivity throws', async () => {
    createCustomActivity.mockRejectedValue(new Error('Close down'))
    const result = await logImessageActivity({
      leadId: 'lead_1',
      direction: 'inbound',
      message: 'hi',
      phone: '+15550100123'
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Close down/)
  })
})

describe('sendImessage', () => {
  it('sends via SendBlue and logs to Close when leadId provided', async () => {
    sendMessage.mockResolvedValue({ message_handle: 'sb_handle' })
    createCustomActivity.mockResolvedValue({ id: 'acti_1' })

    const result = await sendImessage({
      phone: '5550100123',
      message: 'hello',
      leadId: 'lead_1'
    })

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      phone: '+15550100123',
      message: 'hello'
    }))
    expect(createCustomActivity).toHaveBeenCalled()
    expect(result.send.message_handle).toBe('sb_handle')
    expect(result.log.ok).toBe(true)
    expect(result.phone).toBe('+15550100123')
  })

  it('skips logging when no leadId', async () => {
    sendMessage.mockResolvedValue({ message_handle: 'sb_handle' })
    const result = await sendImessage({
      phone: '+15550100123',
      message: 'hi'
    })
    expect(createCustomActivity).not.toHaveBeenCalled()
    expect(result.log.ok).toBe(false)
    expect(result.log.error).toMatch(/no leadId/)
  })

  it('throws when phone missing', async () => {
    await expect(sendImessage({ phone: '', message: 'x' })).rejects.toThrow(/phone is required/)
  })

  it('throws when both message and mediaUrl missing', async () => {
    await expect(sendImessage({ phone: '+15550100123', message: '' })).rejects.toThrow(/message or mediaUrl is required/)
  })

  it('propagates SendBlue errors', async () => {
    sendMessage.mockRejectedValue(new Error('SendBlue send failed: 500'))
    await expect(
      sendImessage({ phone: '+15550100123', message: 'hi' })
    ).rejects.toThrow(/SendBlue send failed: 500/)
  })

  it('throws and does not send when the recipient is opted out', async () => {
    isSuppressed.mockResolvedValue(true)
    await expect(
      sendImessage({ phone: '+15550100123', message: 'hi', leadId: 'lead_1' })
    ).rejects.toThrow(/opted out/)
    expect(sendMessage).not.toHaveBeenCalled()
  })
})
