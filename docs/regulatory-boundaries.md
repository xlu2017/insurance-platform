# Regulatory boundaries

Insurance Autopilot is a **demonstration and workflow platform**. This document states plainly
what the software does and does not claim, and why the workflow is shaped the way it is.

## What this platform is not

- **Not a licensed brokerage or agency.** No entity behind this demo holds an insurance license.
  Quotes and recommendations in this environment are simulated.
- **Not insurance advice.** The engine performs deterministic arithmetic against a
  customer-defined mandate; the platform requires a licensed-reviewer approval step before any
  recommendation reaches a customer, modelling — not replacing — the regulated human role.
- **Not binding.** Nothing here binds coverage. "Switching" is a simulated logistics workflow;
  real binding requires a licensed intermediary and insurer confirmation.
- **Not automatic cancellation.** Incumbent cancellation is recorded only after replacement
  coverage is confirmed, and only as a manual, human-confirmed step.

## Claims the product must never make

Guaranteed cheapest insurance · access to every insurer · licensed brokerage status · automatic
binding · automatic cancellation · regulatory approval · guaranteed savings.

## Where the disclaimer appears

The demonstration disclaimer is displayed on the mobile welcome screen, the customer profile
screen, the recommendation screen, and the admin console footer:

> Insurance Autopilot is currently a demonstration and workflow platform. Quotes, recommendations
> and switch statuses in this environment are simulated and do not constitute insurance advice,
> binding coverage or brokerage services.

## Design consequences

- Customer approval is mandatory for every switch (`customer_approval_required` is constrained
  true in the schema).
- Recommendations cannot be published to a customer without a licensed reviewer reviewing them in
  the `licensed_review` state.
- All recommendation metadata (quote versions, mandate version, disclosure version, approval
  timestamps) is retained for auditability.
- Seed data uses only fictional insurer names.

## Path to production (out of scope for the MVP)

Provincial licensing (e.g. AIC in Alberta), E&O insurance, insurer agreements/APIs, regulated
disclosure documents, and legal review of all customer-facing copy.
