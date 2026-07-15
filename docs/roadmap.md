# Roadmap

## Now (hardening the MVP)

1. Password reauthentication fallback for switch approval on devices without biometrics.
2. Distributed rate limiting for Edge Functions and staff 2FA.
3. Expand pgTAP coverage: per-role matrices for every table, storage policies.
4. CI device farm runs for the Maestro flow; Playwright against a seeded ephemeral database.
5. Push notification delivery via Expo with per-category preferences.

## Next

- Renewal-date monitoring jobs that open cases automatically at the configured lead time.
- Mock extraction provider improvements (per-insurer document templates) and OCR as an optional
  provider behind the same interface.
- Multi-household support per account; invitations for household members.
- Reviewer console with side-by-side coverage diffing.
- Customer document e-signature for authorization forms.

## Later

- Real insurer integrations behind the quote-request abstraction (no scraping).
- Licensed-entity operating model per province; regulated disclosures.
- Savings analytics across the book of business.
- Dark mode and accessibility audit (deferred from MVP).
