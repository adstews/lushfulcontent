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
