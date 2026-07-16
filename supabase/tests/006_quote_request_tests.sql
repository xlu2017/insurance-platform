begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

-- Setup: operations user assigned to a case with a queued quote request.
insert into auth.users (id, email, raw_user_meta_data)
values
  ('60000000-0000-0000-0000-00000000a001', 'qrcustomer@example.com', '{"role":"customer"}'::jsonb),
  ('60000000-0000-0000-0000-00000000a002', 'qroperations@example.com', '{"role":"operations"}'::jsonb),
  ('60000000-0000-0000-0000-00000000a003', 'qrunassigned@example.com', '{"role":"operations"}'::jsonb);

insert into profiles (id, email, full_name, role)
values
  ('60000000-0000-0000-0000-00000000a001', 'qrcustomer@example.com', 'QR Customer', 'customer'),
  ('60000000-0000-0000-0000-00000000a002', 'qroperations@example.com', 'QR Operations', 'operations'),
  ('60000000-0000-0000-0000-00000000a003', 'qrunassigned@example.com', 'QR Unassigned', 'operations')
on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;

insert into households (id, name, province, owner_profile_id)
values ('60000000-0000-0000-0000-00000000b001', 'QR Household', 'AB', '60000000-0000-0000-0000-00000000a001');

insert into household_members (household_id, profile_id)
values ('60000000-0000-0000-0000-00000000b001', '60000000-0000-0000-0000-00000000a001');

insert into optimization_cases (id, household_id, state, created_by)
values ('60000000-0000-0000-0000-00000000c001', '60000000-0000-0000-0000-00000000b001', 'comparing_quotes', '60000000-0000-0000-0000-00000000a002');

insert into insurers (id, name, active, provinces, products, distribution, contact_method, email_supported, portal_supported, api_supported, bundle_supported)
values ('60000000-0000-0000-0000-000000000001', 'QR Insurer', true, '{AB}', '{auto,property}', 'direct', 'email', true, false, false, true);

insert into quote_requests (id, case_id, insurer_id, state, product_lines, inclusion_reason)
values ('60000000-0000-0000-0000-000000000101', '60000000-0000-0000-0000-00000000c001', '60000000-0000-0000-0000-000000000001', 'queued', '{auto,property}', 'competitive');

insert into case_assignments (case_id, assignee_profile_id, assignment_role)
values ('60000000-0000-0000-0000-00000000c001', '60000000-0000-0000-0000-00000000a002', 'operations');

set local role authenticated;

-- 1. Assigned operations can send the quote request.
set local request.jwt.claims to '{"sub":"60000000-0000-0000-0000-00000000a002","role":"authenticated"}';
select is(
  (select send_quote_request_email('60000000-0000-0000-0000-000000000101', 'outbox', true))::jsonb->>'sent',
  'true',
  'assigned operations can send quote request'
);

-- 2. Quote request is now in sent state.
select is(
  (select state from quote_requests where id = '60000000-0000-0000-0000-000000000101'),
  'sent',
  'quote request state becomes sent after send'
);

-- 3. Idempotency: a second send of the same quote request returns duplicate.
select is(
  ((select send_quote_request_email('60000000-0000-0000-0000-000000000101', 'outbox', true))::jsonb->>'duplicate')::boolean,
  true,
  'repeated quote request send is reported as duplicate'
);

-- 4. Customer cannot send a quote request.
set local request.jwt.claims to '{"sub":"60000000-0000-0000-0000-00000000a001","role":"authenticated"}';
select throws_like(
  $$select send_quote_request_email('60000000-0000-0000-0000-000000000101', 'outbox', true)$$,
  '%only operations or admins can send quote-request emails%',
  'customer cannot send quote request'
);

-- 5. Unassigned operations cannot send a quote request.
set local request.jwt.claims to '{"sub":"60000000-0000-0000-0000-00000000a003","role":"authenticated"}';
select throws_like(
  $$select send_quote_request_email('60000000-0000-0000-0000-000000000101', 'outbox', true)$$,
  '%not assigned to this case%',
  'unassigned operations cannot send quote request'
);

-- 6. Failed external provider does not mark the quote request as sent.
-- Create a fresh queued quote request first.
set local role none;
insert into quote_requests (id, case_id, insurer_id, state, product_lines, inclusion_reason)
values ('60000000-0000-0000-0000-000000000102', '60000000-0000-0000-0000-00000000c001', '60000000-0000-0000-0000-000000000001', 'queued', '{auto}', 'additional');

set local role authenticated;
set local request.jwt.claims to '{"sub":"60000000-0000-0000-0000-00000000a002","role":"authenticated"}';
select is(
  (select send_quote_request_email('60000000-0000-0000-0000-000000000102', 'resend', false))::jsonb->>'sent',
  'false',
  'failed external provider does not mark sent'
);

-- 7. After a failed send, the quote request can be retried.
select is(
  (select send_quote_request_email('60000000-0000-0000-0000-000000000102', 'outbox', true))::jsonb->>'sent',
  'true',
  'failed quote request can be retried and then marked sent'
);

select * from finish();
rollback;
