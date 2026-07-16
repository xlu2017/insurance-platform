-- Quote-request email delivery with idempotency and auditability.
-- The actual external provider call still happens in the Edge Function, but every state change
-- (pending / success / failed) is recorded atomically in the database.

alter table email_outbox
  add column if not exists status text not null default 'sent',
  add column if not exists error text;

-- Quote-request sends are already created by an earlier migration; this migration makes the
-- status tracking explicit and adds the atomic RPC used by the Edge Function.

create or replace function send_quote_request_email(
  p_quote_request_id uuid,
  p_provider text,
  p_external_success boolean default true
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  caller_role user_role;
  qr quote_requests%rowtype;
  oc optimization_cases%rowtype;
  existing_status text;
  to_email text;
  insurer_name text;
  product_lines text;
  email_subject text;
  email_body text;
begin
  if caller is null then raise exception 'not authenticated'; end if;

  select role into caller_role from profiles where id = caller;
  if caller_role is null or caller_role not in ('operations', 'admin') then
    raise exception 'only operations or admins can send quote-request emails';
  end if;

  select * into qr from quote_requests where id = p_quote_request_id;
  if not found then raise exception 'quote request not found'; end if;

  if caller_role <> 'admin' then
    if not exists (
      select 1 from case_assignments
      where case_id = qr.case_id and assignee_profile_id = caller
    ) then
      raise exception 'not assigned to this case';
    end if;
  end if;

  -- Idempotency: one send record per quote request.
  select status into existing_status
  from quote_request_sends
  where quote_request_id = p_quote_request_id;

  if existing_status = 'success' then
    return jsonb_build_object('sent', true, 'duplicate', true, 'provider', p_provider);
  end if;

  if qr.state <> 'queued' then
    raise exception 'quote request is not queued (state %)', qr.state;
  end if;

  if existing_status is null then
    insert into quote_request_sends (quote_request_id, created_by, provider, status)
    values (p_quote_request_id, caller, p_provider, 'pending');
  elsif existing_status <> 'pending' then
    -- A previous failed attempt can be retried; mark it pending again.
    update quote_request_sends
    set status = 'pending', provider = p_provider, created_by = caller, created_at = now()
    where quote_request_id = p_quote_request_id;
  end if;

  if not p_external_success then
    update quote_request_sends
    set status = 'failed', sent_at = now()
    where quote_request_id = p_quote_request_id;
    return jsonb_build_object('sent', false, 'provider', p_provider, 'error', 'external provider reported failure');
  end if;

  -- Compose email metadata from the quote request and insurer channel.
  to_email := coalesce(
    (select ic.address from insurer_channels ic
     where ic.insurer_id = qr.insurer_id and ic.channel_type = 'email' limit 1),
    'quotes@example.invalid'
  );
  insurer_name := coalesce(
    (select i.name from insurers i where i.id = qr.insurer_id),
    'the insurer'
  );

  product_lines := coalesce(array_to_string(qr.product_lines, ', '), 'auto, property');
  email_subject := format('Quote request %s — household insurance (%s)', p_quote_request_id, product_lines);
  email_body := format(
    'Hello,%s%sWe are requesting a quotation for a household insurance client through %s.%sProduct lines: %s%sReference: %s%s%sStructured details are available on request. This is a simulated message from the Insurance Autopilot demonstration platform.',
    E'\n', E'\n', insurer_name, E'\n', product_lines, E'\n', p_quote_request_id, E'\n', E'\n'
  );

  -- Mark sent atomically.
  update quote_requests
  set state = 'sent', sent_at = now(), updated_at = now()
  where id = p_quote_request_id;

  update quote_request_sends
  set status = 'success', sent_at = now()
  where quote_request_id = p_quote_request_id;

  insert into email_outbox (to_email, email_type, subject, body, provider, status)
  values (to_email, 'quote_request', email_subject, email_body, p_provider, 'sent');

  select * into oc from optimization_cases where id = qr.case_id;

  insert into audit_events (actor_profile_id, actor_role, action, entity_type, entity_id, household_id, case_id, after_summary)
  values (
    caller, caller_role, 'quote_request_sent', 'quote_request', p_quote_request_id, oc.household_id, qr.case_id,
    jsonb_build_object('provider', p_provider, 'to_email', to_email)
  );

  return jsonb_build_object('sent', true, 'provider', p_provider);
end $$;

grant execute on function send_quote_request_email(uuid, text, bool) to authenticated;
