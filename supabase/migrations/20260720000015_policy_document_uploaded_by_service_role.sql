-- Allow service-role Edge Functions to insert policy_documents with an explicit uploaded_by.
-- auth.uid() is null inside service-role contexts, so the trigger must fall back to the value supplied by the caller.
create or replace function set_policy_document_uploaded_by()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  new.uploaded_by := coalesce(auth.uid(), new.uploaded_by);
  return new;
end $$;
