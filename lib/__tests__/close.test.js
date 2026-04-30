import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLead, updateLead } from '../close.js'

beforeEach(() => {
  process.env.CLOSE_API_KEY = 'api_test'
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createLead', () => {
  it('POSTs to /lead/ with name, contact, status, and custom fields', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'lead_abc123' })
    })
    const result = await createLead({
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '555-0100',
      statusId: 'stat_new',
      customFields: { cf_src: 'girthfill-landing' }
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.close.com/api/v1/lead/',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'Jane Doe',
          status_id: 'stat_new',
          contacts: [{
            name: 'Jane Doe',
            emails: [{ email: 'jane@example.com', type: 'office' }],
            phones: [{ phone: '555-0100', type: 'office' }]
          }],
          custom: { cf_src: 'girthfill-landing' }
        })
      })
    )
    expect(result).toEqual({ closeLeadId: 'lead_abc123' })
  })

  it('omits phone array when phone is null', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'lead_x' })
    })
    await createLead({
      name: 'X',
      email: 'x@y.com',
      phone: null,
      statusId: 'stat_new',
      customFields: {}
    })
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.contacts[0].phones).toEqual([])
  })

  it('throws on non-OK response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => 'invalid'
    })
    await expect(
      createLead({
        name: 'X',
        email: 'x@y.com',
        phone: null,
        statusId: 'stat_new',
        customFields: {}
      })
    ).rejects.toThrow('Close create failed: 422')
  })
})

describe('updateLead', () => {
  it('PUTs to /lead/{id}/ with only provided fields', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => ''
    })
    await updateLead({
      leadId: 'lead_abc',
      statusId: 'stat_qualified',
      customFields: { cf_q: 'Yes' }
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.close.com/api/v1/lead/lead_abc/',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          status_id: 'stat_qualified',
          custom: { cf_q: 'Yes' }
        })
      })
    )
  })

  it('omits status_id when not provided', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => ''
    })
    await updateLead({
      leadId: 'lead_abc',
      customFields: { cf_cta: 'Book Appointment' }
    })
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body).toEqual({ custom: { cf_cta: 'Book Appointment' } })
    expect(body.status_id).toBeUndefined()
  })

  it('throws on non-OK update', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'not found'
    })
    await expect(
      updateLead({ leadId: 'lead_x', statusId: 's' })
    ).rejects.toThrow('Close update failed: 404')
  })
})
