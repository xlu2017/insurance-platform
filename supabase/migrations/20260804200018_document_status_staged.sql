-- Allow policy documents to exist before they are attached to a processing batch.
alter type document_status add value if not exists 'staged';
