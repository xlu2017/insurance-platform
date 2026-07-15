# Demo walkthrough

Start the stack per the README (`supabase start && supabase db reset`, run admin + mobile).

## Accounts

See README table. All four accounts are seeded, email-confirmed, and demo-only.

## Golden path

The seed leaves the Miller household's active case in **licensed_review** with three quotes that
encode the bundle-loss scenario:

- Incumbent (Prairie Shield Mutual): auto C$2,000 + property C$1,200 − C$250 bundle = **C$2,950**
- Alternative A (Chinook Direct): auto C$1,700, but property re-rates to C$1,350 without the
  bundle → **C$3,050** — rejected despite the cheaper auto quote
- Alternative B (Aurora National): bundled auto + property **C$2,700** → net savings C$250,
  eligible at the C$200 threshold and recommended

1. **Reviewer** (`reviewer@example.com`): open the case → Recommendation tab → _Approve and
   publish to customer_. The case moves to `customer_decision`.
2. **Customer** (mobile, `customer@example.com`): Home shows "Action required" → answer the
   pending insurer question → Autopilot tab → _Review your recommendation_ → check savings,
   comparison and material differences → _Approve switch_ (reauthentication) → the timeline shows
   _Switch in progress_.
3. **Operations** (`operations@example.com`): case → Switching tab → advance
   `replacement_pending → replacement_confirmed → incumbent_cancellation_pending →
incumbent_cancelled → completed`. Trying to reach cancellation before replacement confirmation
   is blocked by the database.
4. **Customer**: Home now shows the new insurer, premium and cumulative savings.

## Other flows to try

- Fresh onboarding: register a new account in the mobile app and walk household → membership
  (bypassed locally) → document upload → mandate → preferences → consents → activation.
- Operations extraction: Documents tab → open a document → structured extraction form.
- Quote entry: Quotes tab → enter premiums/fees/deductibles; Comparison tab re-runs the engine
  live and shows reason codes for every configuration.
- Email outbox: send a quote-request email (Shortlist tab) and view it under Email outbox —
  no Resend key needed.
