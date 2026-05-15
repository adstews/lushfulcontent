import { sendMessage, normalizePhone } from './sendblue.js'
import { createCustomActivity } from './close.js'

// Best-effort: log an iMessage as a Custom Activity on a Close lead.
// Returns { ok: true, activityId } or { ok: false, error } — never throws.
export async function logImessageActivity({ leadId, contactId, direction, message, phone, mediaUrl, sendblueHandle }) {
  const activityTypeId = process.env.CLOSE_CUSTOM_ACTIVITY_IMESSAGE
  if (!activityTypeId) {
    return { ok: false, error: 'CLOSE_CUSTOM_ACTIVITY_IMESSAGE not set' }
  }
  if (!leadId) return { ok: false, error: 'leadId required' }

  const customFields = {}
  if (process.env.CLOSE_CF_IMESSAGE_TEXT) {
    customFields[process.env.CLOSE_CF_IMESSAGE_TEXT] = message
  }
  if (process.env.CLOSE_CF_IMESSAGE_DIRECTION) {
    customFields[process.env.CLOSE_CF_IMESSAGE_DIRECTION] = direction
  }
  if (process.env.CLOSE_CF_IMESSAGE_PHONE && phone) {
    customFields[process.env.CLOSE_CF_IMESSAGE_PHONE] = phone
  }
  if (process.env.CLOSE_CF_IMESSAGE_MEDIA_URL && mediaUrl) {
    customFields[process.env.CLOSE_CF_IMESSAGE_MEDIA_URL] = mediaUrl
  }
  if (process.env.CLOSE_CF_IMESSAGE_HANDLE && sendblueHandle) {
    customFields[process.env.CLOSE_CF_IMESSAGE_HANDLE] = sendblueHandle
  }

  // Fall back to using `note` for the message body if no text custom field exists,
  // so the message is still visible on the timeline.
  const note = process.env.CLOSE_CF_IMESSAGE_TEXT ? undefined : `[${direction}] ${message}`

  try {
    const result = await createCustomActivity({
      leadId,
      activityTypeId,
      contactId,
      customFields,
      note
    })
    return { ok: true, activityId: result?.id }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
}

// Send an iMessage via SendBlue and optionally record it on a Close lead.
// `leadId` is optional; if provided we log the outbound message as a Custom Activity.
export async function sendImessage({ phone, message, leadId, contactId, sendStyle, mediaUrl }) {
  const normalized = normalizePhone(phone)
  if (!normalized) throw new Error('phone is required')
  if (!message || typeof message !== 'string') throw new Error('message is required')

  const sendResult = await sendMessage({
    phone: normalized,
    message,
    sendStyle,
    mediaUrl
  })

  let logResult = { ok: false, error: 'no leadId provided' }
  if (leadId) {
    logResult = await logImessageActivity({
      leadId,
      contactId,
      direction: 'outbound',
      message,
      phone: normalized,
      mediaUrl,
      sendblueHandle: sendResult?.message_handle
    })
  }

  return { send: sendResult, log: logResult, phone: normalized }
}
