-- Final pass on SECURITY DEFINER function execution privileges.
-- Internal trigger helpers and service-role-only RPCs are revoked from public/authenticated/anon.
-- RLS helpers keep an explicit grant to authenticated so row-security policies still work.

-- Service-role only: Stripe webhook processor.
revoke execute on function process_stripe_event(text, text, uuid, subscription_status, text, text, timestamptz) from public;
revoke execute on function process_stripe_event(text, text, uuid, subscription_status, text, text, timestamptz) from anon;
revoke execute on function process_stripe_event(text, text, uuid, subscription_status, text, text, timestamptz) from authenticated;
grant execute on function process_stripe_event(text, text, uuid, subscription_status, text, text, timestamptz) to service_role;

-- Internal helpers: called only by other SECURITY DEFINER functions (which run as the function owner).
revoke execute on function supersede_prior_recommendations(uuid) from public;
revoke execute on function supersede_prior_recommendations(uuid) from anon;
revoke execute on function supersede_prior_recommendations(uuid) from authenticated;

revoke execute on function require_household_member_for_recommendation(uuid) from public;
revoke execute on function require_household_member_for_recommendation(uuid) from anon;
revoke execute on function require_household_member_for_recommendation(uuid) from authenticated;

-- Trigger / audit helpers: they should never be invoked directly over PostgREST.
revoke execute on function handle_new_user() from public;
revoke execute on function handle_new_user() from anon;
revoke execute on function handle_new_user() from authenticated;

revoke execute on function log_audit(text, text, uuid, uuid, uuid, jsonb, jsonb) from public;
revoke execute on function log_audit(text, text, uuid, uuid, uuid, jsonb, jsonb) from anon;
revoke execute on function log_audit(text, text, uuid, uuid, uuid, jsonb, jsonb) from authenticated;

revoke execute on function audit_context() from public;
revoke execute on function audit_context() from anon;
revoke execute on function audit_context() from authenticated;

revoke execute on function audit_policy_document_insert() from public;
revoke execute on function audit_policy_document_insert() from anon;
revoke execute on function audit_policy_document_insert() from authenticated;

revoke execute on function audit_household_changes() from public;
revoke execute on function audit_household_changes() from anon;
revoke execute on function audit_household_changes() from authenticated;

revoke execute on function audit_coverage_requirements_change() from public;
revoke execute on function audit_coverage_requirements_change() from anon;
revoke execute on function audit_coverage_requirements_change() from authenticated;

revoke execute on function audit_switching_preferences_change() from public;
revoke execute on function audit_switching_preferences_change() from anon;
revoke execute on function audit_switching_preferences_change() from authenticated;

revoke execute on function audit_customer_question_insert() from public;
revoke execute on function audit_customer_question_insert() from anon;
revoke execute on function audit_customer_question_insert() from authenticated;

revoke execute on function set_household_updated_by() from public;
revoke execute on function set_household_updated_by() from anon;
revoke execute on function set_household_updated_by() from authenticated;

revoke execute on function set_coverage_requirements_updated_by() from public;
revoke execute on function set_coverage_requirements_updated_by() from anon;
revoke execute on function set_coverage_requirements_updated_by() from authenticated;

revoke execute on function set_switching_preferences_updated_by() from public;
revoke execute on function set_switching_preferences_updated_by() from anon;
revoke execute on function set_switching_preferences_updated_by() from authenticated;

revoke execute on function set_policy_document_uploaded_by() from public;
revoke execute on function set_policy_document_uploaded_by() from anon;
revoke execute on function set_policy_document_uploaded_by() from authenticated;

revoke execute on function set_customer_questions_created_by() from public;
revoke execute on function set_customer_questions_created_by() from anon;
revoke execute on function set_customer_questions_created_by() from authenticated;

-- State-machine validation triggers are also never RPCs.
revoke execute on function validate_case_transition() from public;
revoke execute on function validate_case_transition() from anon;
revoke execute on function validate_case_transition() from authenticated;

revoke execute on function validate_quote_request_transition() from public;
revoke execute on function validate_quote_request_transition() from anon;
revoke execute on function validate_quote_request_transition() from authenticated;

revoke execute on function validate_quote_transition() from public;
revoke execute on function validate_quote_transition() from anon;
revoke execute on function validate_quote_transition() from authenticated;

revoke execute on function validate_switch_transition() from public;
revoke execute on function validate_switch_transition() from anon;
revoke execute on function validate_switch_transition() from authenticated;

revoke execute on function reject_audit_mutation() from public;
revoke execute on function reject_audit_mutation() from anon;
revoke execute on function reject_audit_mutation() from authenticated;

-- RLS helper functions are used by policies, so authenticated must retain execute.
revoke execute on function app_role() from public;
revoke execute on function app_role() from anon;
grant execute on function app_role() to authenticated;

revoke execute on function is_staff() from public;
revoke execute on function is_staff() from anon;
grant execute on function is_staff() to authenticated;

revoke execute on function is_admin() from public;
revoke execute on function is_admin() from anon;
grant execute on function is_admin() to authenticated;

revoke execute on function is_household_member(uuid) from public;
revoke execute on function is_household_member(uuid) from anon;
grant execute on function is_household_member(uuid) to authenticated;

revoke execute on function staff_can_access_household(uuid) from public;
revoke execute on function staff_can_access_household(uuid) from anon;
grant execute on function staff_can_access_household(uuid) to authenticated;

revoke execute on function can_access_household(uuid) from public;
revoke execute on function can_access_household(uuid) from anon;
grant execute on function can_access_household(uuid) to authenticated;

revoke execute on function can_access_case(uuid) from public;
revoke execute on function can_access_case(uuid) from anon;
grant execute on function can_access_case(uuid) to authenticated;
