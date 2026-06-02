// Selects the active iMessage provider. Default blooio; set IMESSAGE_PROVIDER=sendblue to fall back.
import * as blooio from './blooio.js'
import * as sendblue from './sendblue.js'
export { normalizePhone } from './phone.js'

function active() {
  return process.env.IMESSAGE_PROVIDER === 'sendblue' ? sendblue : blooio
}
export function sendMessage(args) { return active().sendMessage(args) }
export function sendReaction(args) {
  const p = active()
  // NOTE: Blooio's reaction-send endpoint is unconfirmed — console tap-back is non-critical;
  // this will surface a clear error until the endpoint is confirmed and implemented.
  if (typeof p.sendReaction !== 'function') throw new Error('sendReaction not supported by active provider')
  return p.sendReaction(args)
}
