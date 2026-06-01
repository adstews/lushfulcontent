import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createLead,
  updateLead,
  findLeadByPhone,
  createCustomActivity,
  listCustomActivities,
  getLead,
  getMe,
  findLeadByEmail,
  createNote,
  sendEmail
} from '../close.js'

beforeEach(() => {
  process.env.CLOSE_API_KEY = 'test_key'
  global.fetch = vi.fn()
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
          'custom.cf_q': 'Yes'
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
    expect(body).toEqual({ 'custom.cf_cta': 'Book Appointment' })
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

describe('findLeadByPhone', () => {
  it('returns null when no leads match', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] })
    })
    const result = await findLeadByPhone('+15550100123')
    expect(result).toBeNull()
  })

  it('returns null when phone is empty', async () => {
    const result = await findLeadByPhone('')
    expect(result).toBeNull()
  })

  it('returns first match with contact id matching the phone', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{
          id: 'lead_abc',
          display_name: 'Jane Doe',
          contacts: [
            { id: 'cont_1', phones: [{ phone: '+19990000000' }] },
            { id: 'cont_2', phones: [{ phone: '+15550100123' }] }
          ]
        }]
      })
    })
    const result = await findLeadByPhone('+15550100123')
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/lead/?query='),
      expect.objectContaining({ method: 'GET' })
    )
    expect(result).toEqual({
      closeLeadId: 'lead_abc',
      contactId: 'cont_2',
      displayName: 'Jane Doe'
    })
  })

  it('falls back to first contact when no exact phone match on the contact', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{
          id: 'lead_xyz',
          display_name: 'Bob',
          contacts: [{ id: 'cont_only', phones: [] }]
        }]
      })
    })
    const result = await findLeadByPhone('+15550100123')
    expect(result.contactId).toBe('cont_only')
  })

  it('throws on non-OK response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'forbidden'
    })
    await expect(findLeadByPhone('+15550100123')).rejects.toThrow(/Close lead search failed: 403/)
  })
})

describe('createCustomActivity', () => {
  it('POSTs to /activity/custom/ with type, lead, and custom fields', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'acti_abc' })
    })
    await createCustomActivity({
      leadId: 'lead_1',
      activityTypeId: 'actitype_imsg',
      contactId: 'cont_1',
      customFields: { cf_text: 'hello', cf_dir: 'outbound' }
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.close.com/api/v1/activity/custom/',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          custom_activity_type_id: 'actitype_imsg',
          lead_id: 'lead_1',
          contact_id: 'cont_1',
          'custom.cf_text': 'hello',
          'custom.cf_dir': 'outbound'
        })
      })
    )
  })

  it('skips empty/null custom field values', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({})
    })
    await createCustomActivity({
      leadId: 'lead_1',
      activityTypeId: 'actitype_imsg',
      customFields: { cf_a: 'x', cf_b: '', cf_c: null, cf_d: undefined }
    })
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body['custom.cf_a']).toBe('x')
    expect(body['custom.cf_b']).toBeUndefined()
    expect(body['custom.cf_c']).toBeUndefined()
    expect(body['custom.cf_d']).toBeUndefined()
  })

  it('throws when leadId missing', async () => {
    await expect(createCustomActivity({ activityTypeId: 'a' })).rejects.toThrow(/leadId required/)
  })

  it('throws when activityTypeId missing', async () => {
    await expect(createCustomActivity({ leadId: 'l' })).rejects.toThrow(/activityTypeId required/)
  })

  it('throws on non-OK response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'bad type id'
    })
    await expect(
      createCustomActivity({ leadId: 'l', activityTypeId: 'a' })
    ).rejects.toThrow(/Close custom activity failed: 400/)
  })
})

describe('listCustomActivities', () => {
  it('GETs /activity/custom/ with activity type id', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], has_more: false })
    })
    await listCustomActivities({ activityTypeId: 'actitype_im', limit: 25 })
    const url = fetchSpy.mock.calls[0][0]
    expect(url).toContain('custom_activity_type_id=actitype_im')
    expect(url).toContain('_limit=25')
    expect(url).not.toContain('lead_id=')
  })

  it('includes lead_id when provided', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], has_more: false })
    })
    await listCustomActivities({ activityTypeId: 'actitype_im', leadId: 'lead_1' })
    expect(fetchSpy.mock.calls[0][0]).toContain('lead_id=lead_1')
  })

  it('throws when activityTypeId missing', async () => {
    await expect(listCustomActivities({})).rejects.toThrow(/activityTypeId required/)
  })

  it('throws on non-OK', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'down'
    })
    await expect(
      listCustomActivities({ activityTypeId: 'a' })
    ).rejects.toThrow(/Close list custom activities failed: 500/)
  })
})

describe('getLead', () => {
  it('GETs /lead/{id}/', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'lead_1', display_name: 'Jane' })
    })
    const result = await getLead('lead_1')
    expect(fetchSpy.mock.calls[0][0]).toMatch(/\/lead\/lead_1\//)
    expect(result.id).toBe('lead_1')
  })

  it('throws when leadId missing', async () => {
    await expect(getLead('')).rejects.toThrow(/leadId required/)
  })

  it('throws on non-OK', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'not found'
    })
    await expect(getLead('lead_x')).rejects.toThrow(/Close get lead failed: 404/)
  })
})

describe('getMe', () => {
  it('GETs /me/ with auth header', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'user_1' })
    })
    const result = await getMe()
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.close.com/api/v1/me/',
      expect.objectContaining({ method: 'GET' })
    )
    expect(result).toEqual({ id: 'user_1' })
  })

  it('throws on non-OK response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'bad key'
    })
    await expect(getMe()).rejects.toThrow(/Close \/me failed: 401/)
  })
})

function jsonResponse(body, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body))
  })
}

describe('findLeadByEmail', () => {
  it('returns null when email is empty', async () => {
    expect(await findLeadByEmail('')).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('queries Close by email and returns the first match + matching contact', async () => {
    global.fetch.mockReturnValueOnce(jsonResponse({
      data: [{
        id: 'lead_abc',
        display_name: 'Jane Doe',
        contacts: [
          { id: 'cont_1', emails: [{ email: 'other@x.com' }] },
          { id: 'cont_2', emails: [{ email: 'JANE@example.com' }] }
        ]
      }]
    }))

    const result = await findLeadByEmail('jane@example.com')

    expect(result).toEqual({ closeLeadId: 'lead_abc', contactId: 'cont_2', displayName: 'Jane Doe' })
    const calledUrl = global.fetch.mock.calls[0][0]
    expect(calledUrl).toContain('/lead/?query=')
    expect(decodeURIComponent(calledUrl)).toContain('email:"jane@example.com"')
  })

  it('returns null when Close has no match', async () => {
    global.fetch.mockReturnValueOnce(jsonResponse({ data: [] }))
    expect(await findLeadByEmail('nobody@x.com')).toBeNull()
  })

  it('throws on a non-ok response', async () => {
    global.fetch.mockReturnValueOnce(jsonResponse({ error: 'boom' }, false, 500))
    await expect(findLeadByEmail('x@y.com')).rejects.toThrow('Close lead search failed: 500')
  })
})

describe('createNote', () => {
  it('throws without leadId', async () => {
    await expect(createNote({ note: 'hi' })).rejects.toThrow('leadId required')
  })

  it('throws without note', async () => {
    await expect(createNote({ leadId: 'lead_1' })).rejects.toThrow('note required')
  })

  it('POSTs a note activity to Close', async () => {
    global.fetch.mockReturnValueOnce(jsonResponse({ id: 'acti_1' }))
    const result = await createNote({ leadId: 'lead_1', note: 'Booked a call' })
    expect(result).toEqual({ id: 'acti_1' })
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toContain('/activity/note/')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ lead_id: 'lead_1', note: 'Booked a call' })
  })

  it('throws on a non-ok response', async () => {
    global.fetch.mockReturnValueOnce(jsonResponse({ error: 'nope' }, false, 400))
    await expect(createNote({ leadId: 'lead_1', note: 'x' })).rejects.toThrow('Close create note failed: 400')
  })
})

describe('sendEmail', () => {
  it('throws without leadId/to/sender', async () => {
    await expect(sendEmail({ to: 'a@b.com', sender: 's@x.com' })).rejects.toThrow('leadId required')
    await expect(sendEmail({ leadId: 'lead_1', sender: 's@x.com' })).rejects.toThrow('to required')
    await expect(sendEmail({ leadId: 'lead_1', to: 'a@b.com' })).rejects.toThrow('sender required')
  })
  it('POSTs an outbox email to Close', async () => {
    global.fetch.mockReturnValueOnce(jsonResponse({ id: 'acti_email_1' }))
    const r = await sendEmail({ leadId: 'lead_1', to: 'jane@example.com', sender: 'hello@x.com', subject: 'Hi', bodyText: 'T', bodyHtml: '<p>T</p>' })
    expect(r).toEqual({ id: 'acti_email_1' })
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toContain('/activity/email/')
    expect(JSON.parse(opts.body)).toMatchObject({
      lead_id: 'lead_1', to: ['jane@example.com'], sender: 'hello@x.com',
      subject: 'Hi', body_text: 'T', body_html: '<p>T</p>', status: 'outbox'
    })
  })
  it('throws on non-ok', async () => {
    global.fetch.mockReturnValueOnce(jsonResponse({ error: 'no' }, false, 400))
    await expect(sendEmail({ leadId: 'lead_1', to: 'a@b.com', sender: 's@x.com' })).rejects.toThrow('Close send email failed: 400')
  })
})
