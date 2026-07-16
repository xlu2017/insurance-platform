-- Harden the Stripe webhook processor to resolve the affected profile from stored IDs,
-- fail closed when resolution fails, and be callable only by the service role.
create or replace function process_stripe_event(
  p_event_id text,
  p_event_type text,
  p_profile_id uuid,
  p_status subscription_status,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_current_period_end timestamptz
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  existing stripe_webhook_events%rowtype;
  resolved_profile_id uuid := p_profile_id;
  result jsonb;
begin
  -- Idempotency check first.
  select * into existing from stripe_webhook_events where id = p_event_id;
  if found and existing.status = 'completed' then
    return jsonb_build_object('success', true, 'already_processed', true);
  end if;

  -- Resolve profile from the most trusted sources first.
  if resolved_profile_id is null and p_stripe_subscription_id is not null then
    select profile_id into resolved_profile_id
    from subscriptions
    where stripe_subscription_id = p_stripe_subscription_id
    limit 1;
  end if;

  if resolved_profile_id is null and p_stripe_customer_id is not null then
    select profile_id into resolved_profile_id
    from subscriptions
    where stripe_customer_id = p_stripe_customer_id
    limit 1;
  end if;

  if resolved_profile_id is null then
    -- Unresolvable event: record a retryable failure and return non-2xx upstream.
    insert into stripe_webhook_events (id, event_type, status, attempt_count, last_error)
    values (p_event_id, p_event_type, 'failed', coalesce(existing.attempt_count, 0) + 1, 'could not resolve profile')
    on conflict (id) do update set
      status = 'failed',
      attempt_count = stripe_webhook_events.attempt_count + 1,
      last_error = excluded.last_error;
    return jsonb_build_object('success', false, 'error', 'could not resolve profile');
  end if;

  -- Upsert subscription. Keep existing Stripe IDs if the event did not provide them.
  insert into subscriptions (profile_id, status, stripe_customer_id, stripe_subscription_id, current_period_end)
  values (resolved_profile_id, p_status, p_stripe_customer_id, p_stripe_subscription_id, p_current_period_end)
  on conflict (profile_id) do update set
    status = excluded.status,
    stripe_customer_id = coalesce(excluded.stripe_customer_id, subscriptions.stripe_customer_id),
    stripe_subscription_id = coalesce(excluded.stripe_subscription_id, subscriptions.stripe_subscription_id),
    current_period_end = coalesce(excluded.current_period_end, subscriptions.current_period_end),
    updated_at = now();

  insert into audit_events (actor_profile_id, actor_role, action, entity_type, entity_id, after_summary)
  values (resolved_profile_id, 'customer', 'subscription_event', 'subscription', resolved_profile_id,
          jsonb_build_object('status', p_status, 'event_type', p_event_type));

  insert into stripe_webhook_events (id, event_type, status, attempt_count, completed_at, processed_at)
  values (p_event_id, p_event_type, 'completed', coalesce(existing.attempt_count, 0) + 1, now(), now())
  on conflict (id) do update set
    status = 'completed',
    attempt_count = stripe_webhook_events.attempt_count + 1,
    completed_at = now(),
    last_error = null;

  return jsonb_build_object('success', true);
exception when others then
  insert into stripe_webhook_events (id, event_type, status, attempt_count, last_error)
  values (p_event_id, p_event_type, 'failed', coalesce(existing.attempt_count, 0) + 1, SQLERRM)
  on conflict (id) do update set
    status = 'failed',
    attempt_count = stripe_webhook_events.attempt_count + 1,
    last_error = excluded.last_error;
  return jsonb_build_object('success', false, 'error', SQLERRM);
end $$;

-- Service-role only.
revoke execute on function process_stripe_event(text, text, uuid, subscription_status, text, text, timestamptz) from public;
revoke execute on function process_stripe_event(text, text, uuid, subscription_status, text, text, timestamptz) from anon;
revoke execute on function process_stripe_event(text, text, uuid, subscription_status, text, text, timestamptz) from authenticated;
grant execute on function process_stripe_event(text, text, uuid, subscription_status, text, text, timestamptz) to service_role;
