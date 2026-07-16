begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

set local role service_role;

-- 1. Seeded valid quote coverage rows carry both raw and normalized coverage and a validator.
select is(
  (
    select count(*)::int
    from quote_coverages
    where validation_status = 'valid'
      and (raw_coverage is null or normalized_coverage is null or validated_by is null)
  ),
  0,
  'no seeded valid coverage row is missing raw, normalized or validator'
);

-- 2. Seeded coverage rows are attributed to a known data source.
select is(
  (
    select count(*)::int
    from quote_coverages
    where data_source is null
  ),
  0,
  'all quote coverages have a data_source'
);

-- 3. The quote readiness view reports seeded bindable quotes as ready.
select is(
  (
    select count(*)::int
    from quote_readiness
    where state = 'bindable' and readiness_status = 'ready'
  ),
  (
    select count(*)::int from quotes where state = 'bindable'
  ),
  'all bindable quotes are reported ready by the aggregate view'
);

-- 4. Direct authenticated DML on quote tables is revoked.
select ok(
  not has_table_privilege('authenticated', 'quotes', 'insert'),
  'authenticated cannot insert quotes'
);

select ok(
  not has_table_privilege('authenticated', 'quotes', 'update'),
  'authenticated cannot update quotes'
);

select ok(
  not has_table_privilege('authenticated', 'quote_policy_components', 'insert'),
  'authenticated cannot insert quote_policy_components'
);

select ok(
  not has_table_privilege('authenticated', 'quote_coverages', 'insert'),
  'authenticated cannot insert quote_coverages'
);

-- 5. Insurer metadata versioning columns exist and seeded insurers start at version 1.
select is(
  (
    select count(*)::int
    from insurers
    where version is null or version < 1
  ),
  0,
  'all insurers have a non-null version >= 1'
);

select * from finish();
rollback;
