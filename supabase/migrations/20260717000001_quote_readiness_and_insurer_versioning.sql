-- Corrective Phase 1D-D: aggregate quote readiness and insurer metadata versioning.

-- Aggregate quote readiness view.
-- Exposes, per quote, whether the aggregate is ready to enter the engine.
-- Authority is server-side: this is a read-only view driven by the validated coverage rows.
create or replace view quote_readiness as
select
  q.id as quote_id,
  q.case_id,
  q.state,
  q.expires_at,
  q.is_incumbent,
  count(distinct qpc.id) as component_count,
  count(distinct qc.id) filter (where qc.validation_status = 'valid') as valid_component_count,
  count(distinct qc.id) filter (where qc.validation_status = 'incomplete') as incomplete_component_count,
  count(distinct qc.id) filter (where qc.validation_status = 'invalid') as invalid_component_count,
  count(distinct qc.id) filter (where qc.validation_status = 'draft') as draft_component_count,
  case
    when q.state in ('rejected') then 'unusable'
    when q.expires_at is not null and q.expires_at < now() then 'expired'
    when q.state not in ('bindable', 'conditional', 'estimate') then 'unusable'
    when q.state = 'estimate' then 'incomplete'
    when count(distinct qpc.id) = 0 then 'no_components'
    when count(distinct qc.id) filter (where qc.validation_status = 'valid') = count(distinct qpc.id)
         and count(distinct qc.id) filter (where qc.validation_status <> 'valid') = 0
         and q.state in ('bindable', 'conditional') then 'ready'
    when count(distinct qc.id) filter (where qc.validation_status = 'invalid') > 0 then 'invalid'
    else 'incomplete'
  end as readiness_status
from quotes q
left join quote_policy_components qpc on qpc.quote_id = q.id
left join quote_coverages qc
  on qc.quote_component_id = qpc.id
  and qc.validation_status is distinct from 'superseded'
group by q.id, q.case_id, q.state, q.expires_at, q.is_incumbent;

comment on view quote_readiness is
  'Read-only, server-side aggregate of quote readiness. Only quotes with readiness_status = ready should be fed to the recommendation engine.';

grant select on quote_readiness to service_role, authenticated;

-- Insurer metadata versioning.
-- Track a monotonic version on the insurer record so the engine/recommendation
-- snapshot can detect when the metadata used at evaluation time has been superseded.
alter table insurers
  add column if not exists version integer not null default 1,
  add column if not exists versioned_at timestamptz default now();

-- Authenticated users (and the trusted Edge Function acting on their behalf)
-- must be able to read the insurer version used in recommendation snapshots.
grant select (version, versioned_at) on insurers to authenticated;

-- Bump the version whenever material insurer metadata is changed.
create or replace function bump_insurer_version()
returns trigger as $$
begin
  if new.financial_strength_rating is distinct from old.financial_strength_rating
     or new.payment_frequencies is distinct from old.payment_frequencies
     or new.billing_methods is distinct from old.billing_methods
     or new.distribution is distinct from old.distribution
     or new.bundle_supported is distinct from old.bundle_supported then
    new.version := coalesce(old.version, 1) + 1;
    new.versioned_at := now();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists insurers_version_bump on insurers;
create trigger insurers_version_bump
  before update on insurers
  for each row
  execute function bump_insurer_version();

comment on column insurers.version is
  'Monotonically increasing version of insurer metadata; changes to rating, payment, billing, distribution or fees bump this value.';

-- Reject licensed review or customer approval if any insurer in the recommendation snapshot
-- has been versioned since the recommendation was generated.
create or replace function validate_recommendation_insurer_versions()
returns trigger as $$
declare
  v_quote jsonb;
begin
  if NEW.status in ('published','customer_approved','customer_declined')
     and OLD.status is distinct from NEW.status then
    for v_quote in select * from jsonb_array_elements(NEW.input_snapshot_json->'quotes') loop
      if (v_quote->>'insurerVersion') is not null then
        if exists (
          select 1
          from insurers i
          where i.id = (v_quote->>'insurerId')::uuid
            and i.version is distinct from (v_quote->>'insurerVersion')::int
        ) then
          raise exception 'insurer metadata changed for quote % since recommendation generation', v_quote->>'id';
        end if;
      end if;
    end loop;
  end if;
  return NEW;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists recommendations_insurer_staleness on recommendations;
create trigger recommendations_insurer_staleness
  before update on recommendations
  for each row
  execute function validate_recommendation_insurer_versions();
