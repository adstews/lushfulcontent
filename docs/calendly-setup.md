# Calendly → Close webhook setup

Marks a Close lead "Call Booked" (and logs the Q&A) whenever someone books the
30-min consult on Calendly — funnel embed, `/consultation-book`, or a bare
Calendly link in an email. Handler: `api/calendly-webhook.js`.

## One-time registration

Calendly webhook subscriptions are created via API (paid-plan feature) and
require a Personal Access Token (PAT): Calendly → Integrations → API & Webhooks.

1. Get your organization URI:

   ```bash
   curl https://api.calendly.com/users/me \
     -H "Authorization: Bearer $CALENDLY_PAT"
   # → resource.current_organization
   ```

2. Create the subscription (only `invitee.created`):

   ```bash
   curl -X POST https://api.calendly.com/webhook_subscriptions \
     -H "Authorization: Bearer $CALENDLY_PAT" \
     -H "Content-Type: application/json" \
     -d '{
       "url": "https://lushfulaesthetics.com/api/calendly-webhook",
       "events": ["invitee.created"],
       "organization": "<organization_uri>",
       "scope": "organization"
     }'
   ```

3. Copy `resource.signing_key` from the response and set it in Vercel
   (Production + Preview):

   ```
   CALENDLY_WEBHOOK_SIGNING_KEY=<signing_key>
   ```

   Redeploy so the function picks it up.

## Close prerequisite

If the Close `Source` custom field is a **choice (dropdown)** field rather than
free text, add a `calendly-direct` option in the Close UI first, or creating a
direct-booking lead will fail.

## Verify

- Book a test event on the 30-min Calendly. Confirm in Close: the lead is
  **Call Booked** with a "Calendly booking confirmed" note. Check the
  `calendly_bookings` table got a row.
- Re-deliver the same event from Calendly's webhook log → handler returns 200
  `skipped: already processed` (no duplicate writes).
- A booking with a brand-new email creates a `calendly-direct` lead at Call
  Booked.

## Notes

- The link needs no params: Calendly's own booking form always collects the
  name + email, which is what we match on.
- Replay protection is the `calendly_bookings.invitee_uri` unique key, so the
  signature check deliberately does not enforce a timestamp window (that would
  reject Calendly's delayed retries).
