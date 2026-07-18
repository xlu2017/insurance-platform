-- Phase 1E-C: allow candidate decision to record an executed approval.

alter type candidate_decision add value if not exists 'approved';
