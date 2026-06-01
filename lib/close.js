const BASE = 'https://api.close.com/api/v1'

function authHeader() {
  const key = process.env.CLOSE_API_KEY
  if (!key) throw new Error('CLOSE_API_KEY not set')
  return 'Basic ' + Buffer.from(key + ':').toString('base64')
}

export async function createLead({ name, email, phone, statusId, customFields }) {
  const body = {
    name,
    status_id: statusId,
    contacts: [{
      name,
      emails: email ? [{ email, type: 'office' }] : [],
      phones: phone ? [{ phone, type: 'office' }] : []
    }],
    custom: customFields
  }
  const res = await fetch(`${BASE}/lead/`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Close create failed: ${res.status} ${text}`)
  }
  const data = await res.json()
  return { closeLeadId: data.id }
}

// Search Close by phone. Returns the first matching lead (with its primary
// contact id when available) or null. Phone should already be normalized.
export async function findLeadByPhone(phone) {
  if (!phone) return null
  const url = `${BASE}/lead/?query=${encodeURIComponent(`phone:"${phone}"`)}&_fields=id,display_name,contacts`
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: authHeader() }
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Close lead search failed: ${res.status} ${text}`)
  }
  const data = await res.json()
  const lead = data?.data?.[0]
  if (!lead) return null
  // Pick the contact whose phone matches; fall back to the first.
  let contactId = null
  if (Array.isArray(lead.contacts) && lead.contacts.length > 0) {
    const match = lead.contacts.find(c =>
      Array.isArray(c.phones) && c.phones.some(p => p.phone === phone)
    )
    contactId = (match || lead.contacts[0]).id || null
  }
  return { closeLeadId: lead.id, contactId, displayName: lead.display_name }
}

// Search Close by email. Returns the first matching lead (with its primary
// contact id when available) or null.
export async function findLeadByEmail(email) {
  if (!email) return null
  const url = `${BASE}/lead/?query=${encodeURIComponent(`email:"${email}"`)}&_fields=id,display_name,contacts`
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: authHeader() }
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Close lead search failed: ${res.status} ${text}`)
  }
  const data = await res.json()
  const lead = data?.data?.[0]
  if (!lead) return null
  let contactId = null
  if (Array.isArray(lead.contacts) && lead.contacts.length > 0) {
    const match = lead.contacts.find(c =>
      Array.isArray(c.emails) && c.emails.some(e => (e.email || '').toLowerCase() === email.toLowerCase())
    )
    contactId = (match || lead.contacts[0]).id || null
  }
  return { closeLeadId: lead.id, contactId, displayName: lead.display_name }
}

// Create a plain note on a lead's timeline.
export async function createNote({ leadId, note }) {
  if (!leadId) throw new Error('createNote: leadId required')
  if (!note) throw new Error('createNote: note required')
  const res = await fetch(`${BASE}/activity/note/`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ lead_id: leadId, note })
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Close create note failed: ${res.status} ${text}`)
  }
  return res.json()
}

// Send an email to a lead via Close (routes through the connected email
// account). status 'outbox' tells Close to actually send, not just log a draft.
export async function sendEmail({ leadId, to, sender, subject, bodyText, bodyHtml }) {
  if (!leadId) throw new Error('sendEmail: leadId required')
  if (!to) throw new Error('sendEmail: to required')
  if (!sender) throw new Error('sendEmail: sender required')
  const body = {
    lead_id: leadId,
    to: Array.isArray(to) ? to : [to],
    sender,
    subject: subject || '',
    status: 'outbox'
  }
  if (bodyText) body.body_text = bodyText
  if (bodyHtml) body.body_html = bodyHtml
  const res = await fetch(`${BASE}/activity/email/`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Close send email failed: ${res.status} ${text}`)
  }
  return res.json()
}

// Create a Custom Activity entry on a lead's timeline.
// `customFields` is a map of Close custom field IDs (cf_xxx) → values.
export async function createCustomActivity({ leadId, activityTypeId, contactId, customFields, note }) {
  if (!leadId) throw new Error('createCustomActivity: leadId required')
  if (!activityTypeId) throw new Error('createCustomActivity: activityTypeId required')
  const body = {
    custom_activity_type_id: activityTypeId,
    lead_id: leadId
  }
  if (contactId) body.contact_id = contactId
  if (note) body.note = note
  if (customFields) {
    for (const [cfId, value] of Object.entries(customFields)) {
      if (value !== undefined && value !== null && value !== '') {
        body[`custom.${cfId}`] = value
      }
    }
  }
  const res = await fetch(`${BASE}/activity/custom/`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Close custom activity failed: ${res.status} ${text}`)
  }
  return res.json()
}

// List Custom Activities of a given type. `leadId` filters to one lead.
// Returns { data, has_more } from Close.
export async function listCustomActivities({ activityTypeId, leadId, limit = 50, skip = 0 }) {
  if (!activityTypeId) throw new Error('listCustomActivities: activityTypeId required')
  const params = new URLSearchParams({
    custom_activity_type_id: activityTypeId,
    _limit: String(limit),
    _skip: String(skip)
  })
  if (leadId) params.set('lead_id', leadId)
  const res = await fetch(`${BASE}/activity/custom/?${params.toString()}`, {
    method: 'GET',
    headers: { Authorization: authHeader() }
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Close list custom activities failed: ${res.status} ${text}`)
  }
  return res.json()
}

// Fetch a lead with contacts so we can find the phone for replying.
export async function getLead(leadId) {
  if (!leadId) throw new Error('getLead: leadId required')
  const url = `${BASE}/lead/${encodeURIComponent(leadId)}/?_fields=id,display_name,contacts,status_label`
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: authHeader() }
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Close get lead failed: ${res.status} ${text}`)
  }
  return res.json()
}

// List all lead statuses defined for the organization. Used by the
// sequences modal to show human-readable labels for trigger_status_id.
export async function listLeadStatuses() {
  const res = await fetch(`${BASE}/status/lead/`, {
    method: 'GET',
    headers: { Authorization: authHeader() }
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Close list lead statuses failed: ${res.status} ${text}`)
  }
  const data = await res.json()
  // Close returns { data: [{ id, label, ... }, ...] }
  return Array.isArray(data?.data) ? data.data : []
}

// Used by /health to confirm the API key is valid.
export async function getMe() {
  const res = await fetch(`${BASE}/me/`, {
    method: 'GET',
    headers: { Authorization: authHeader() }
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Close /me failed: ${res.status} ${text}`)
  }
  return res.json()
}

export async function updateLead({ leadId, statusId, customFields }) {
  const body = {}
  if (statusId) body.status_id = statusId
  if (customFields) {
    for (const [cfId, value] of Object.entries(customFields)) {
      body[`custom.${cfId}`] = value
    }
  }
  const res = await fetch(`${BASE}/lead/${leadId}/`, {
    method: 'PUT',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Close update failed: ${res.status} ${text}`)
  }
}
