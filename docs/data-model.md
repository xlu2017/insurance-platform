# Data model

All tables use UUID primary keys, `created_at`/`updated_at` (UTC, trigger-maintained), and integer
Canadian cents for money. Statuses are explicit Postgres enums; soft deletion is not used — audit
history lives in `audit_events`.

```mermaid
erDiagram
  profiles ||--o{ households : owns
  households ||--o{ household_members : has
  households ||--o{ drivers : has
  households ||--o{ vehicles : has
  households ||--o{ properties : has
  households ||--o{ policies : has
  households ||--o{ policy_documents : has
  households ||--o{ coverage_requirements : versions
  households ||--o{ switching_preferences : versions
  households ||--o{ optimization_cases : opens
  optimization_cases ||--o{ case_assignments : assigned
  optimization_cases ||--o{ quote_requests : sends
  insurers ||--o{ quote_requests : receives
  insurers ||--o{ insurer_channels : contact
  optimization_cases ||--o{ quotes : receives
  quotes ||--o{ quote_policy_components : contains
  quote_policy_components ||--o{ quote_coverages : details
  optimization_cases ||--o{ customer_questions : asks
  optimization_cases ||--o{ recommendations : produces
  recommendations ||--o{ recommendation_options : ranks
  recommendations ||--o{ recommendation_approvals : approved_by
  optimization_cases ||--o{ switch_events : executes
  profiles ||--o{ consents : grants
  households ||--o{ subscriptions : pays
  profiles ||--o{ notifications : receives
  households ||--o{ audit_events : records
```

## Table groups

- **Identity & household**: `profiles` (role: customer/operations/reviewer/admin), `households`,
  `household_members`, `drivers`, `vehicles`, `properties`.
- **Policies & documents**: `policies` (current and historical), `policy_documents` (category,
  status, private storage path).
- **Mandate**: `coverage_requirements` and `switching_preferences`, versioned with `is_current`.
  `coverage_requirements` holds `auto_requirements`, `property_requirements`, `vehicle_mandates`
  and `property_mandates` (asset-specific overrides). `switching_preferences` adds `max_premium_increase_cents`,
  `max_deductible_increase_cents`, `allow_bundle_breakup`, `preferred_payment_frequency`,
  `preferred_billing_method`, `broker_direct_preference`, `minimum_insurer_financial_rating` and
  `switch_only_after_customer_approval`. `customer_approval_required` is constrained true.
- **Market**: `insurers` (8 fictional carriers), `insurer_channels`.
- **Workflow**: `optimization_cases`, `case_assignments`, `quote_requests`, `quotes`,
  `quote_policy_components`, `quote_coverages`, `customer_questions`.
- **Decision**: `recommendations` (versions, quote ids, mandate version, reason codes,
  comparison JSON), `recommendation_options`, `recommendation_approvals` (role, metadata incl.
  disclosure version). `comparison.materialDifferences` records human-readable coverage reductions.
- **Execution**: `switch_events` with `replacement_confirmed_at` / `incumbent_cancelled_at`;
  a trigger blocks cancellation states before replacement confirmation.
- **Billing & comms**: `subscriptions` (one per profile), `consents`, `notifications`,
  `email_outbox`, `quote_request_sends` (DB-backed send audit/rate limit), `stripe_webhook_events`
  (idempotency: `status`, `attempt_count`, `last_error`, `completed_at`).
- **Audit**: `audit_events` — append-only (trigger + revoked update/delete).

## State machines

Enforced by `security definer` triggers `validate_case_transition`,
`validate_quote_request_transition`, `validate_quote_transition`, `validate_switch_transition`;
the same maps are exported from `@autopilot/schemas` for clients and tests. Workflow mutations are
performed by `security definer` RPCs that validate the transition before applying it. See
`docs/architecture.md` for the case diagram.
