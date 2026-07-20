-- Allow documents to be uploaded without pre-selecting auto/property.
-- The extraction LLM determines the document type and can emit multiple asset
-- candidates from a single file that contains both auto and property coverage.

alter type document_category add value if not exists 'auto_detect';
