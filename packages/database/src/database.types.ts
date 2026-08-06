export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      asset_candidates: {
        Row: {
          analysis_run_id: string | null;
          approved_asset_id: string | null;
          approved_asset_type: Database["public"]["Enums"]["candidate_asset_type"] | null;
          approved_policy_id: string | null;
          asset_type: Database["public"]["Enums"]["candidate_asset_type"];
          conflicts_json: Json;
          created_at: string;
          decision: Database["public"]["Enums"]["candidate_decision"];
          display_label: string;
          draft_decision: string | null;
          draft_existing_asset_id: string | null;
          draft_existing_asset_type: Database["public"]["Enums"]["candidate_asset_type"] | null;
          draft_identity_confirmed: boolean;
          draft_updated_at: string | null;
          draft_updated_by: string | null;
          household_id: string;
          id: string;
          identity_fingerprint: string;
          manual_reviewed_at: string | null;
          manual_reviewed_by: string | null;
          match_classification: Database["public"]["Enums"]["candidate_match_classification"];
          occupancy: string | null;
          parent_candidate_id: string | null;
          review_status: string;
          selected_facts_json: Json;
          session_id: string;
          source_document_ids: string[];
          updated_at: string;
        };
        Insert: {
          analysis_run_id?: string | null;
          approved_asset_id?: string | null;
          approved_asset_type?: Database["public"]["Enums"]["candidate_asset_type"] | null;
          approved_policy_id?: string | null;
          asset_type: Database["public"]["Enums"]["candidate_asset_type"];
          conflicts_json?: Json;
          created_at?: string;
          decision?: Database["public"]["Enums"]["candidate_decision"];
          display_label: string;
          draft_decision?: string | null;
          draft_existing_asset_id?: string | null;
          draft_existing_asset_type?: Database["public"]["Enums"]["candidate_asset_type"] | null;
          draft_identity_confirmed?: boolean;
          draft_updated_at?: string | null;
          draft_updated_by?: string | null;
          household_id: string;
          id?: string;
          identity_fingerprint: string;
          manual_reviewed_at?: string | null;
          manual_reviewed_by?: string | null;
          match_classification?: Database["public"]["Enums"]["candidate_match_classification"];
          occupancy?: string | null;
          parent_candidate_id?: string | null;
          review_status?: string;
          selected_facts_json?: Json;
          session_id: string;
          source_document_ids?: string[];
          updated_at?: string;
        };
        Update: {
          analysis_run_id?: string | null;
          approved_asset_id?: string | null;
          approved_asset_type?: Database["public"]["Enums"]["candidate_asset_type"] | null;
          approved_policy_id?: string | null;
          asset_type?: Database["public"]["Enums"]["candidate_asset_type"];
          conflicts_json?: Json;
          created_at?: string;
          decision?: Database["public"]["Enums"]["candidate_decision"];
          display_label?: string;
          draft_decision?: string | null;
          draft_existing_asset_id?: string | null;
          draft_existing_asset_type?: Database["public"]["Enums"]["candidate_asset_type"] | null;
          draft_identity_confirmed?: boolean;
          draft_updated_at?: string | null;
          draft_updated_by?: string | null;
          household_id?: string;
          id?: string;
          identity_fingerprint?: string;
          manual_reviewed_at?: string | null;
          manual_reviewed_by?: string | null;
          match_classification?: Database["public"]["Enums"]["candidate_match_classification"];
          occupancy?: string | null;
          parent_candidate_id?: string | null;
          review_status?: string;
          selected_facts_json?: Json;
          session_id?: string;
          source_document_ids?: string[];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "asset_candidates_analysis_run_id_fkey";
            columns: ["analysis_run_id"];
            isOneToOne: false;
            referencedRelation: "document_analysis_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "asset_candidates_approved_policy_id_fkey";
            columns: ["approved_policy_id"];
            isOneToOne: false;
            referencedRelation: "policies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "asset_candidates_draft_updated_by_fkey";
            columns: ["draft_updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "asset_candidates_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "asset_candidates_manual_reviewed_by_fkey";
            columns: ["manual_reviewed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "asset_candidates_parent_candidate_id_fkey";
            columns: ["parent_candidate_id"];
            isOneToOne: false;
            referencedRelation: "asset_candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "asset_candidates_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "document_extraction_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_events: {
        Row: {
          action: string;
          actor_profile_id: string | null;
          actor_role: Database["public"]["Enums"]["user_role"] | null;
          after_summary: Json | null;
          before_summary: Json | null;
          case_id: string | null;
          correlation_id: string | null;
          created_at: string;
          entity_id: string | null;
          entity_type: string;
          household_id: string | null;
          id: string;
        };
        Insert: {
          action: string;
          actor_profile_id?: string | null;
          actor_role?: Database["public"]["Enums"]["user_role"] | null;
          after_summary?: Json | null;
          before_summary?: Json | null;
          case_id?: string | null;
          correlation_id?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type: string;
          household_id?: string | null;
          id?: string;
        };
        Update: {
          action?: string;
          actor_profile_id?: string | null;
          actor_role?: Database["public"]["Enums"]["user_role"] | null;
          after_summary?: Json | null;
          before_summary?: Json | null;
          case_id?: string | null;
          correlation_id?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string;
          household_id?: string | null;
          id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_events_actor_profile_id_fkey";
            columns: ["actor_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "audit_events_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "optimization_cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "audit_events_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
        ];
      };
      candidate_approvals: {
        Row: {
          actor_profile_id: string | null;
          client_request_id: string;
          created_at: string;
          household_id: string;
          id: string;
          result_json: Json;
          status: string;
        };
        Insert: {
          actor_profile_id?: string | null;
          client_request_id: string;
          created_at?: string;
          household_id: string;
          id?: string;
          result_json?: Json;
          status?: string;
        };
        Update: {
          actor_profile_id?: string | null;
          client_request_id?: string;
          created_at?: string;
          household_id?: string;
          id?: string;
          result_json?: Json;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "candidate_approvals_actor_profile_id_fkey";
            columns: ["actor_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "candidate_approvals_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
        ];
      };
      candidate_conflicts: {
        Row: {
          assertion_ids: string[];
          candidate_id: string;
          created_at: string;
          field_path: string;
          id: string;
          reason: string;
          selected_assertion_id: string | null;
        };
        Insert: {
          assertion_ids: string[];
          candidate_id: string;
          created_at?: string;
          field_path: string;
          id?: string;
          reason: string;
          selected_assertion_id?: string | null;
        };
        Update: {
          assertion_ids?: string[];
          candidate_id?: string;
          created_at?: string;
          field_path?: string;
          id?: string;
          reason?: string;
          selected_assertion_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "candidate_conflicts_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "asset_candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "candidate_conflicts_selected_assertion_id_fkey";
            columns: ["selected_assertion_id"];
            isOneToOne: false;
            referencedRelation: "extracted_fact_assertions";
            referencedColumns: ["id"];
          },
        ];
      };
      candidate_field_review_versions: {
        Row: {
          action: Database["public"]["Enums"]["candidate_field_review_action"];
          actor_profile_id: string | null;
          candidate_id: string;
          corrected_value: Json | null;
          correction_reason: string | null;
          created_at: string;
          current_mandate_value: Json | null;
          household_id: string;
          id: string;
          review_id: string;
          snapshot_json: Json;
        };
        Insert: {
          action: Database["public"]["Enums"]["candidate_field_review_action"];
          actor_profile_id?: string | null;
          candidate_id: string;
          corrected_value?: Json | null;
          correction_reason?: string | null;
          created_at?: string;
          current_mandate_value?: Json | null;
          household_id: string;
          id?: string;
          review_id: string;
          snapshot_json: Json;
        };
        Update: {
          action?: Database["public"]["Enums"]["candidate_field_review_action"];
          actor_profile_id?: string | null;
          candidate_id?: string;
          corrected_value?: Json | null;
          correction_reason?: string | null;
          created_at?: string;
          current_mandate_value?: Json | null;
          household_id?: string;
          id?: string;
          review_id?: string;
          snapshot_json?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "candidate_field_review_versions_actor_profile_id_fkey";
            columns: ["actor_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "candidate_field_review_versions_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "asset_candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "candidate_field_review_versions_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "candidate_field_review_versions_review_id_fkey";
            columns: ["review_id"];
            isOneToOne: false;
            referencedRelation: "candidate_field_reviews";
            referencedColumns: ["id"];
          },
        ];
      };
      candidate_field_reviews: {
        Row: {
          action: Database["public"]["Enums"]["candidate_field_review_action"];
          batch_id: string | null;
          candidate_id: string;
          completed_at: string | null;
          confidence: number | null;
          conflict_values_json: Json;
          corrected_value: Json | null;
          correction_reason: string | null;
          created_at: string;
          current_mandate_value: Json | null;
          document_implied_mandate_value: Json | null;
          document_implied_value: Json | null;
          field_path: string;
          household_id: string;
          id: string;
          is_complete: boolean;
          mandate_path: string | null;
          mandate_rule_json: Json | null;
          material_conflict: boolean;
          original_extracted_value: Json | null;
          prior_mandate_value: Json | null;
          reviewed_by: string | null;
          source_document_id: string | null;
          source_page_number: number | null;
          source_section: string | null;
          specification_title: string | null;
          updated_at: string;
          value_state: string | null;
        };
        Insert: {
          action: Database["public"]["Enums"]["candidate_field_review_action"];
          batch_id?: string | null;
          candidate_id: string;
          completed_at?: string | null;
          confidence?: number | null;
          conflict_values_json?: Json;
          corrected_value?: Json | null;
          correction_reason?: string | null;
          created_at?: string;
          current_mandate_value?: Json | null;
          document_implied_mandate_value?: Json | null;
          document_implied_value?: Json | null;
          field_path: string;
          household_id: string;
          id?: string;
          is_complete?: boolean;
          mandate_path?: string | null;
          mandate_rule_json?: Json | null;
          material_conflict?: boolean;
          original_extracted_value?: Json | null;
          prior_mandate_value?: Json | null;
          reviewed_by?: string | null;
          source_document_id?: string | null;
          source_page_number?: number | null;
          source_section?: string | null;
          specification_title?: string | null;
          updated_at?: string;
          value_state?: string | null;
        };
        Update: {
          action?: Database["public"]["Enums"]["candidate_field_review_action"];
          batch_id?: string | null;
          candidate_id?: string;
          completed_at?: string | null;
          confidence?: number | null;
          conflict_values_json?: Json;
          corrected_value?: Json | null;
          correction_reason?: string | null;
          created_at?: string;
          current_mandate_value?: Json | null;
          document_implied_mandate_value?: Json | null;
          document_implied_value?: Json | null;
          field_path?: string;
          household_id?: string;
          id?: string;
          is_complete?: boolean;
          mandate_path?: string | null;
          mandate_rule_json?: Json | null;
          material_conflict?: boolean;
          original_extracted_value?: Json | null;
          prior_mandate_value?: Json | null;
          reviewed_by?: string | null;
          source_document_id?: string | null;
          source_page_number?: number | null;
          source_section?: string | null;
          specification_title?: string | null;
          updated_at?: string;
          value_state?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "candidate_field_reviews_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "document_processing_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "candidate_field_reviews_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "asset_candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "candidate_field_reviews_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "candidate_field_reviews_reviewed_by_fkey";
            columns: ["reviewed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "candidate_field_reviews_source_document_id_fkey";
            columns: ["source_document_id"];
            isOneToOne: false;
            referencedRelation: "policy_documents";
            referencedColumns: ["id"];
          },
        ];
      };
      case_assignments: {
        Row: {
          assignee_profile_id: string;
          assignment_role: string;
          case_id: string;
          created_at: string;
          id: string;
          updated_at: string;
        };
        Insert: {
          assignee_profile_id: string;
          assignment_role?: string;
          case_id: string;
          created_at?: string;
          id?: string;
          updated_at?: string;
        };
        Update: {
          assignee_profile_id?: string;
          assignment_role?: string;
          case_id?: string;
          created_at?: string;
          id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "case_assignments_assignee_profile_id_fkey";
            columns: ["assignee_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_assignments_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "optimization_cases";
            referencedColumns: ["id"];
          },
        ];
      };
      cleanup_readiness_status: {
        Row: {
          checked_at: string;
          checks: Json;
          id: string;
          permanent_failure_count: number;
          ready: boolean;
          stale_deleting_count: number;
        };
        Insert: {
          checked_at?: string;
          checks?: Json;
          id?: string;
          permanent_failure_count?: number;
          ready?: boolean;
          stale_deleting_count?: number;
        };
        Update: {
          checked_at?: string;
          checks?: Json;
          id?: string;
          permanent_failure_count?: number;
          ready?: boolean;
          stale_deleting_count?: number;
        };
        Relationships: [];
      };
      cleanup_readiness_synthetic: {
        Row: {
          attempts: number;
          claimed_at: string | null;
          created_at: string;
          id: string;
          resolved_at: string | null;
          worker_id: string | null;
        };
        Insert: {
          attempts?: number;
          claimed_at?: string | null;
          created_at?: string;
          id?: string;
          resolved_at?: string | null;
          worker_id?: string | null;
        };
        Update: {
          attempts?: number;
          claimed_at?: string | null;
          created_at?: string;
          id?: string;
          resolved_at?: string | null;
          worker_id?: string | null;
        };
        Relationships: [];
      };
      consents: {
        Row: {
          consent_type: Database["public"]["Enums"]["consent_type"];
          created_at: string;
          disclosure_version: string;
          granted: boolean;
          granted_at: string;
          household_id: string | null;
          id: string;
          profile_id: string;
        };
        Insert: {
          consent_type: Database["public"]["Enums"]["consent_type"];
          created_at?: string;
          disclosure_version?: string;
          granted: boolean;
          granted_at?: string;
          household_id?: string | null;
          id?: string;
          profile_id: string;
        };
        Update: {
          consent_type?: Database["public"]["Enums"]["consent_type"];
          created_at?: string;
          disclosure_version?: string;
          granted?: boolean;
          granted_at?: string;
          household_id?: string | null;
          id?: string;
          profile_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "consents_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "consents_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      coverage_requirements: {
        Row: {
          auto_requirements: Json;
          created_at: string;
          created_by: string | null;
          household_id: string;
          id: string;
          is_current: boolean;
          property_mandates: Json;
          property_requirements: Json;
          updated_at: string;
          updated_by: string | null;
          vehicle_mandates: Json;
          version: number;
        };
        Insert: {
          auto_requirements: Json;
          created_at?: string;
          created_by?: string | null;
          household_id: string;
          id?: string;
          is_current?: boolean;
          property_mandates?: Json;
          property_requirements: Json;
          updated_at?: string;
          updated_by?: string | null;
          vehicle_mandates?: Json;
          version?: number;
        };
        Update: {
          auto_requirements?: Json;
          created_at?: string;
          created_by?: string | null;
          household_id?: string;
          id?: string;
          is_current?: boolean;
          property_mandates?: Json;
          property_requirements?: Json;
          updated_at?: string;
          updated_by?: string | null;
          vehicle_mandates?: Json;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "coverage_requirements_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "coverage_requirements_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "coverage_requirements_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      customer_questions: {
        Row: {
          answer: string | null;
          answered_at: string | null;
          answered_by: string | null;
          case_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          options: string[] | null;
          prompt: string;
          question_type: Database["public"]["Enums"]["question_type"];
          status: Database["public"]["Enums"]["question_status"];
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          answer?: string | null;
          answered_at?: string | null;
          answered_by?: string | null;
          case_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          options?: string[] | null;
          prompt: string;
          question_type: Database["public"]["Enums"]["question_type"];
          status?: Database["public"]["Enums"]["question_status"];
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          answer?: string | null;
          answered_at?: string | null;
          answered_by?: string | null;
          case_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          options?: string[] | null;
          prompt?: string;
          question_type?: Database["public"]["Enums"]["question_type"];
          status?: Database["public"]["Enums"]["question_status"];
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "customer_questions_answered_by_fkey";
            columns: ["answered_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_questions_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "optimization_cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_questions_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_questions_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      document_analysis_cleanup_attempts: {
        Row: {
          attempted_at: string;
          failure_category: string | null;
          file_id: string;
          id: string;
          next_attempt_at: string | null;
          status_code: number | null;
          success: boolean;
        };
        Insert: {
          attempted_at?: string;
          failure_category?: string | null;
          file_id: string;
          id?: string;
          next_attempt_at?: string | null;
          status_code?: number | null;
          success?: boolean;
        };
        Update: {
          attempted_at?: string;
          failure_category?: string | null;
          file_id?: string;
          id?: string;
          next_attempt_at?: string | null;
          status_code?: number | null;
          success?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "document_analysis_cleanup_attempts_file_id_fkey";
            columns: ["file_id"];
            isOneToOne: false;
            referencedRelation: "document_analysis_provider_files";
            referencedColumns: ["id"];
          },
        ];
      };
      document_analysis_emergency_cleanup: {
        Row: {
          cleanup_claimed_at: string | null;
          cleanup_lease_expires_at: string | null;
          cleanup_status: string;
          cleanup_worker_id: string | null;
          created_at: string;
          failure_category: string | null;
          id: string;
          last_attempt_at: string | null;
          last_failure_category: string | null;
          next_attempt_at: string | null;
          operator_action_required: boolean;
          policy_document_id: string | null;
          provider_file_id: string;
          resolved_at: string | null;
          retries: number;
        };
        Insert: {
          cleanup_claimed_at?: string | null;
          cleanup_lease_expires_at?: string | null;
          cleanup_status?: string;
          cleanup_worker_id?: string | null;
          created_at?: string;
          failure_category?: string | null;
          id?: string;
          last_attempt_at?: string | null;
          last_failure_category?: string | null;
          next_attempt_at?: string | null;
          operator_action_required?: boolean;
          policy_document_id?: string | null;
          provider_file_id: string;
          resolved_at?: string | null;
          retries?: number;
        };
        Update: {
          cleanup_claimed_at?: string | null;
          cleanup_lease_expires_at?: string | null;
          cleanup_status?: string;
          cleanup_worker_id?: string | null;
          created_at?: string;
          failure_category?: string | null;
          id?: string;
          last_attempt_at?: string | null;
          last_failure_category?: string | null;
          next_attempt_at?: string | null;
          operator_action_required?: boolean;
          policy_document_id?: string | null;
          provider_file_id?: string;
          resolved_at?: string | null;
          retries?: number;
        };
        Relationships: [];
      };
      document_analysis_provider_files: {
        Row: {
          analysis_request_id: string | null;
          authorization_id: string;
          cleanup_claimed_at: string | null;
          cleanup_lease_expires_at: string | null;
          cleanup_worker_id: string | null;
          created_at: string;
          deleted_at: string | null;
          deletion_attempts: number;
          deletion_status: string | null;
          id: string;
          last_deletion_error_category: string | null;
          next_deletion_attempt_at: string | null;
          policy_document_id: string;
          processing_status: string | null;
          provider_file_id: string;
          updated_at: string;
          upload_completed_at: string | null;
          upload_started_at: string;
          upload_status: string;
        };
        Insert: {
          analysis_request_id?: string | null;
          authorization_id: string;
          cleanup_claimed_at?: string | null;
          cleanup_lease_expires_at?: string | null;
          cleanup_worker_id?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          deletion_attempts?: number;
          deletion_status?: string | null;
          id?: string;
          last_deletion_error_category?: string | null;
          next_deletion_attempt_at?: string | null;
          policy_document_id: string;
          processing_status?: string | null;
          provider_file_id: string;
          updated_at?: string;
          upload_completed_at?: string | null;
          upload_started_at?: string;
          upload_status?: string;
        };
        Update: {
          analysis_request_id?: string | null;
          authorization_id?: string;
          cleanup_claimed_at?: string | null;
          cleanup_lease_expires_at?: string | null;
          cleanup_worker_id?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          deletion_attempts?: number;
          deletion_status?: string | null;
          id?: string;
          last_deletion_error_category?: string | null;
          next_deletion_attempt_at?: string | null;
          policy_document_id?: string;
          processing_status?: string | null;
          provider_file_id?: string;
          updated_at?: string;
          upload_completed_at?: string | null;
          upload_started_at?: string;
          upload_status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_analysis_provider_files_authorization_id_fkey";
            columns: ["authorization_id"];
            isOneToOne: false;
            referencedRelation: "document_processing_authorizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_analysis_provider_files_policy_document_id_fkey";
            columns: ["policy_document_id"];
            isOneToOne: false;
            referencedRelation: "policy_documents";
            referencedColumns: ["id"];
          },
        ];
      };
      document_analysis_runs: {
        Row: {
          attempt_count: number;
          attempted_model_id: string | null;
          attempted_model_provider: string | null;
          authorization_id: string | null;
          client_request_id: string;
          consent_id: string | null;
          created_at: string;
          fallback_reason: string | null;
          household_id: string;
          id: string;
          model_id: string;
          model_provider: string;
          output_schema_version: string;
          prompt_version: string;
          provider_metadata_json: Json;
          raw_response_json: Json | null;
          session_id: string | null;
          validated_output_json: Json;
          warnings_json: Json;
        };
        Insert: {
          attempt_count?: number;
          attempted_model_id?: string | null;
          attempted_model_provider?: string | null;
          authorization_id?: string | null;
          client_request_id: string;
          consent_id?: string | null;
          created_at?: string;
          fallback_reason?: string | null;
          household_id: string;
          id?: string;
          model_id: string;
          model_provider: string;
          output_schema_version?: string;
          prompt_version?: string;
          provider_metadata_json?: Json;
          raw_response_json?: Json | null;
          session_id?: string | null;
          validated_output_json: Json;
          warnings_json?: Json;
        };
        Update: {
          attempt_count?: number;
          attempted_model_id?: string | null;
          attempted_model_provider?: string | null;
          authorization_id?: string | null;
          client_request_id?: string;
          consent_id?: string | null;
          created_at?: string;
          fallback_reason?: string | null;
          household_id?: string;
          id?: string;
          model_id?: string;
          model_provider?: string;
          output_schema_version?: string;
          prompt_version?: string;
          provider_metadata_json?: Json;
          raw_response_json?: Json | null;
          session_id?: string | null;
          validated_output_json?: Json;
          warnings_json?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "document_analysis_runs_authorization_id_fkey";
            columns: ["authorization_id"];
            isOneToOne: false;
            referencedRelation: "document_processing_authorizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_analysis_runs_consent_id_fkey";
            columns: ["consent_id"];
            isOneToOne: false;
            referencedRelation: "document_processing_consent";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_analysis_runs_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_analysis_runs_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "document_extraction_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      document_asset_overlap_assessments: {
        Row: {
          asset_id: string | null;
          asset_type: Database["public"]["Enums"]["candidate_asset_type"] | null;
          batch_id: string;
          classification: Database["public"]["Enums"]["document_asset_overlap_classification"];
          confidence: number | null;
          created_at: string;
          details_json: Json;
          existing_policy_id: string | null;
          id: string;
          normalization_id: string;
          normalized_entity_key: string;
          updated_at: string;
        };
        Insert: {
          asset_id?: string | null;
          asset_type?: Database["public"]["Enums"]["candidate_asset_type"] | null;
          batch_id: string;
          classification: Database["public"]["Enums"]["document_asset_overlap_classification"];
          confidence?: number | null;
          created_at?: string;
          details_json?: Json;
          existing_policy_id?: string | null;
          id?: string;
          normalization_id: string;
          normalized_entity_key: string;
          updated_at?: string;
        };
        Update: {
          asset_id?: string | null;
          asset_type?: Database["public"]["Enums"]["candidate_asset_type"] | null;
          batch_id?: string;
          classification?: Database["public"]["Enums"]["document_asset_overlap_classification"];
          confidence?: number | null;
          created_at?: string;
          details_json?: Json;
          existing_policy_id?: string | null;
          id?: string;
          normalization_id?: string;
          normalized_entity_key?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_asset_overlap_assessments_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "document_processing_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_asset_overlap_assessments_existing_policy_id_fkey";
            columns: ["existing_policy_id"];
            isOneToOne: false;
            referencedRelation: "policies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_asset_overlap_assessments_normalization_id_fkey";
            columns: ["normalization_id"];
            isOneToOne: false;
            referencedRelation: "document_normalizations";
            referencedColumns: ["id"];
          },
        ];
      };
      document_extraction_sessions: {
        Row: {
          case_id: string | null;
          created_at: string;
          created_by: string | null;
          household_id: string;
          id: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          case_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          household_id: string;
          id?: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          case_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          household_id?: string;
          id?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_extraction_sessions_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "optimization_cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_extraction_sessions_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_extraction_sessions_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
        ];
      };
      document_normalizations: {
        Row: {
          analyzer_version: string;
          classification: string;
          completed_at: string | null;
          conflicts_json: Json;
          content_sha256: string;
          created_at: string;
          evidence_json: Json;
          failure_code: string | null;
          household_id: string;
          id: string;
          model_id: string | null;
          model_provider: string | null;
          normalization_schema_version: string;
          normalized_entities_json: Json;
          normalized_output_json: Json;
          policy_document_id: string;
          prompt_version: string | null;
          status: string;
        };
        Insert: {
          analyzer_version: string;
          classification: string;
          completed_at?: string | null;
          conflicts_json?: Json;
          content_sha256: string;
          created_at?: string;
          evidence_json?: Json;
          failure_code?: string | null;
          household_id: string;
          id?: string;
          model_id?: string | null;
          model_provider?: string | null;
          normalization_schema_version: string;
          normalized_entities_json?: Json;
          normalized_output_json?: Json;
          policy_document_id: string;
          prompt_version?: string | null;
          status: string;
        };
        Update: {
          analyzer_version?: string;
          classification?: string;
          completed_at?: string | null;
          conflicts_json?: Json;
          content_sha256?: string;
          created_at?: string;
          evidence_json?: Json;
          failure_code?: string | null;
          household_id?: string;
          id?: string;
          model_id?: string | null;
          model_provider?: string | null;
          normalization_schema_version?: string;
          normalized_entities_json?: Json;
          normalized_output_json?: Json;
          policy_document_id?: string;
          prompt_version?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_normalizations_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_normalizations_policy_document_id_fkey";
            columns: ["policy_document_id"];
            isOneToOne: false;
            referencedRelation: "policy_documents";
            referencedColumns: ["id"];
          },
        ];
      };
      document_processing_authorizations: {
        Row: {
          actor_profile_id: string;
          analysis_request_id: string | null;
          authorization_result: string;
          authorized_at: string;
          automated_processing_acknowledged: boolean;
          consent_id: string | null;
          created_at: string;
          external_processing_enabled: boolean;
          foreign_processing_acknowledged: boolean;
          household_id: string;
          id: string;
          privacy_notice_version: string;
          processor_contract_version: string;
          purpose: string;
          raw_processing_approved: boolean;
        };
        Insert: {
          actor_profile_id: string;
          analysis_request_id?: string | null;
          authorization_result?: string;
          authorized_at?: string;
          automated_processing_acknowledged?: boolean;
          consent_id?: string | null;
          created_at?: string;
          external_processing_enabled?: boolean;
          foreign_processing_acknowledged?: boolean;
          household_id: string;
          id?: string;
          privacy_notice_version: string;
          processor_contract_version: string;
          purpose?: string;
          raw_processing_approved?: boolean;
        };
        Update: {
          actor_profile_id?: string;
          analysis_request_id?: string | null;
          authorization_result?: string;
          authorized_at?: string;
          automated_processing_acknowledged?: boolean;
          consent_id?: string | null;
          created_at?: string;
          external_processing_enabled?: boolean;
          foreign_processing_acknowledged?: boolean;
          household_id?: string;
          id?: string;
          privacy_notice_version?: string;
          processor_contract_version?: string;
          purpose?: string;
          raw_processing_approved?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "document_processing_authorizations_actor_profile_id_fkey";
            columns: ["actor_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_processing_authorizations_consent_id_fkey";
            columns: ["consent_id"];
            isOneToOne: false;
            referencedRelation: "document_processing_consent";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_processing_authorizations_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
        ];
      };
      document_processing_batch_items: {
        Row: {
          batch_id: string;
          category: Database["public"]["Enums"]["document_category"];
          client_item_id: string;
          content_sha256: string;
          created_at: string;
          deduplicated: boolean;
          duplicate_of_policy_document_id: string | null;
          household_id: string;
          id: string;
          policy_document_id: string;
          review_status: string;
          selected_file_name: string;
          status: string;
        };
        Insert: {
          batch_id: string;
          category: Database["public"]["Enums"]["document_category"];
          client_item_id: string;
          content_sha256: string;
          created_at?: string;
          deduplicated?: boolean;
          duplicate_of_policy_document_id?: string | null;
          household_id: string;
          id?: string;
          policy_document_id: string;
          review_status?: string;
          selected_file_name: string;
          status: string;
        };
        Update: {
          batch_id?: string;
          category?: Database["public"]["Enums"]["document_category"];
          client_item_id?: string;
          content_sha256?: string;
          created_at?: string;
          deduplicated?: boolean;
          duplicate_of_policy_document_id?: string | null;
          household_id?: string;
          id?: string;
          policy_document_id?: string;
          review_status?: string;
          selected_file_name?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_processing_batch_ite_duplicate_of_policy_document_fkey";
            columns: ["duplicate_of_policy_document_id"];
            isOneToOne: false;
            referencedRelation: "policy_documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_processing_batch_items_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "document_processing_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_processing_batch_items_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_processing_batch_items_policy_document_id_fkey";
            columns: ["policy_document_id"];
            isOneToOne: false;
            referencedRelation: "policy_documents";
            referencedColumns: ["id"];
          },
        ];
      };
      document_processing_batch_normalizations: {
        Row: {
          batch_id: string;
          batch_item_id: string;
          created_at: string;
          normalization_id: string;
          updated_at: string;
          use_status: string;
        };
        Insert: {
          batch_id: string;
          batch_item_id: string;
          created_at?: string;
          normalization_id: string;
          updated_at?: string;
          use_status: string;
        };
        Update: {
          batch_id?: string;
          batch_item_id?: string;
          created_at?: string;
          normalization_id?: string;
          updated_at?: string;
          use_status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_processing_batch_normalizations_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "document_processing_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_processing_batch_normalizations_batch_item_id_fkey";
            columns: ["batch_item_id"];
            isOneToOne: false;
            referencedRelation: "document_processing_batch_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_processing_batch_normalizations_normalization_id_fkey";
            columns: ["normalization_id"];
            isOneToOne: false;
            referencedRelation: "document_normalizations";
            referencedColumns: ["id"];
          },
        ];
      };
      document_processing_batches: {
        Row: {
          authorization_id: string | null;
          cancellation_requested_at: string | null;
          case_id: string | null;
          client_request_id: string;
          completed_at: string | null;
          configured_model_id: string | null;
          configured_provider: string | null;
          consent_id: string | null;
          continuation_choice: string | null;
          continuation_chosen_at: string | null;
          continuation_chosen_by: string | null;
          continuation_request_id: string | null;
          created_at: string;
          created_by: string;
          deduplicated_count: number;
          depends_on_batch_id: string | null;
          disclosure_version: string | null;
          document_count: number;
          error_code: string | null;
          estimated_lower_seconds: number | null;
          estimated_upper_seconds: number | null;
          expected_processing_generation: number | null;
          household_id: string;
          id: string;
          manual_case_id: string | null;
          mode_snapshot: string;
          next_retry_at: string | null;
          processing_generation: number;
          processing_started_at: string | null;
          retry_count: number;
          retryable: boolean;
          session_id: string;
          settings_version: number;
          status: string;
          submitted_at: string | null;
          superseded_at: string | null;
          superseded_by_batch_id: string | null;
          unique_document_count: number;
          updated_at: string;
          worker_claimed_at: string | null;
          worker_lease_expires_at: string | null;
        };
        Insert: {
          authorization_id?: string | null;
          cancellation_requested_at?: string | null;
          case_id?: string | null;
          client_request_id: string;
          completed_at?: string | null;
          configured_model_id?: string | null;
          configured_provider?: string | null;
          consent_id?: string | null;
          continuation_choice?: string | null;
          continuation_chosen_at?: string | null;
          continuation_chosen_by?: string | null;
          continuation_request_id?: string | null;
          created_at?: string;
          created_by: string;
          deduplicated_count?: number;
          depends_on_batch_id?: string | null;
          disclosure_version?: string | null;
          document_count?: number;
          error_code?: string | null;
          estimated_lower_seconds?: number | null;
          estimated_upper_seconds?: number | null;
          expected_processing_generation?: number | null;
          household_id: string;
          id?: string;
          manual_case_id?: string | null;
          mode_snapshot: string;
          next_retry_at?: string | null;
          processing_generation?: number;
          processing_started_at?: string | null;
          retry_count?: number;
          retryable?: boolean;
          session_id: string;
          settings_version: number;
          status?: string;
          submitted_at?: string | null;
          superseded_at?: string | null;
          superseded_by_batch_id?: string | null;
          unique_document_count?: number;
          updated_at?: string;
          worker_claimed_at?: string | null;
          worker_lease_expires_at?: string | null;
        };
        Update: {
          authorization_id?: string | null;
          cancellation_requested_at?: string | null;
          case_id?: string | null;
          client_request_id?: string;
          completed_at?: string | null;
          configured_model_id?: string | null;
          configured_provider?: string | null;
          consent_id?: string | null;
          continuation_choice?: string | null;
          continuation_chosen_at?: string | null;
          continuation_chosen_by?: string | null;
          continuation_request_id?: string | null;
          created_at?: string;
          created_by?: string;
          deduplicated_count?: number;
          depends_on_batch_id?: string | null;
          disclosure_version?: string | null;
          document_count?: number;
          error_code?: string | null;
          estimated_lower_seconds?: number | null;
          estimated_upper_seconds?: number | null;
          expected_processing_generation?: number | null;
          household_id?: string;
          id?: string;
          manual_case_id?: string | null;
          mode_snapshot?: string;
          next_retry_at?: string | null;
          processing_generation?: number;
          processing_started_at?: string | null;
          retry_count?: number;
          retryable?: boolean;
          session_id?: string;
          settings_version?: number;
          status?: string;
          submitted_at?: string | null;
          superseded_at?: string | null;
          superseded_by_batch_id?: string | null;
          unique_document_count?: number;
          updated_at?: string;
          worker_claimed_at?: string | null;
          worker_lease_expires_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "document_processing_batches_authorization_id_fkey";
            columns: ["authorization_id"];
            isOneToOne: false;
            referencedRelation: "document_processing_authorizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_processing_batches_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "optimization_cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_processing_batches_consent_id_fkey";
            columns: ["consent_id"];
            isOneToOne: false;
            referencedRelation: "document_processing_consent";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_processing_batches_continuation_chosen_by_fkey";
            columns: ["continuation_chosen_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_processing_batches_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_processing_batches_depends_on_batch_id_fkey";
            columns: ["depends_on_batch_id"];
            isOneToOne: false;
            referencedRelation: "document_processing_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_processing_batches_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_processing_batches_manual_case_id_fkey";
            columns: ["manual_case_id"];
            isOneToOne: false;
            referencedRelation: "optimization_cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_processing_batches_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "document_extraction_sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_processing_batches_superseded_by_batch_id_fkey";
            columns: ["superseded_by_batch_id"];
            isOneToOne: false;
            referencedRelation: "document_processing_batches";
            referencedColumns: ["id"];
          },
        ];
      };
      document_processing_consent: {
        Row: {
          authority_basis: string;
          automated_processing_acknowledged: boolean;
          consented_at: string;
          created_at: string;
          foreign_processing_acknowledged: boolean;
          household_id: string;
          id: string;
          privacy_notice_version: string;
          processor_contract_version: string;
          profile_id: string;
          purpose: string;
          raw_processing_approved: boolean;
          status: string;
          superseded_by: string | null;
          updated_at: string;
          withdrawn_at: string | null;
        };
        Insert: {
          authority_basis?: string;
          automated_processing_acknowledged?: boolean;
          consented_at?: string;
          created_at?: string;
          foreign_processing_acknowledged?: boolean;
          household_id: string;
          id?: string;
          privacy_notice_version: string;
          processor_contract_version: string;
          profile_id: string;
          purpose?: string;
          raw_processing_approved?: boolean;
          status?: string;
          superseded_by?: string | null;
          updated_at?: string;
          withdrawn_at?: string | null;
        };
        Update: {
          authority_basis?: string;
          automated_processing_acknowledged?: boolean;
          consented_at?: string;
          created_at?: string;
          foreign_processing_acknowledged?: boolean;
          household_id?: string;
          id?: string;
          privacy_notice_version?: string;
          processor_contract_version?: string;
          profile_id?: string;
          purpose?: string;
          raw_processing_approved?: boolean;
          status?: string;
          superseded_by?: string | null;
          updated_at?: string;
          withdrawn_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "document_processing_consent_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_processing_consent_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_processing_consent_superseded_by_fkey";
            columns: ["superseded_by"];
            isOneToOne: false;
            referencedRelation: "document_processing_consent";
            referencedColumns: ["id"];
          },
        ];
      };
      drivers: {
        Row: {
          created_at: string;
          created_by: string | null;
          date_of_birth: string;
          full_name: string;
          household_id: string;
          id: string;
          licence_class: string;
          updated_at: string;
          updated_by: string | null;
          years_licensed: number;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          date_of_birth: string;
          full_name: string;
          household_id: string;
          id?: string;
          licence_class?: string;
          updated_at?: string;
          updated_by?: string | null;
          years_licensed?: number;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          date_of_birth?: string;
          full_name?: string;
          household_id?: string;
          id?: string;
          licence_class?: string;
          updated_at?: string;
          updated_by?: string | null;
          years_licensed?: number;
        };
        Relationships: [
          {
            foreignKeyName: "drivers_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "drivers_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "drivers_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      email_outbox: {
        Row: {
          body: string;
          created_at: string;
          email_type: string;
          error: string | null;
          id: string;
          provider: string;
          sent_at: string | null;
          status: string;
          subject: string;
          to_email: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          email_type: string;
          error?: string | null;
          id?: string;
          provider?: string;
          sent_at?: string | null;
          status?: string;
          subject: string;
          to_email: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          email_type?: string;
          error?: string | null;
          id?: string;
          provider?: string;
          sent_at?: string | null;
          status?: string;
          subject?: string;
          to_email?: string;
        };
        Relationships: [];
      };
      extracted_documents: {
        Row: {
          analysis_run_id: string | null;
          classification: string;
          created_at: string;
          extracted_at: string;
          file_digest: string;
          household_id: string;
          id: string;
          page_count: number;
          pages_json: Json;
          parser_id: string | null;
          parser_version: string | null;
          policy_document_id: string | null;
          session_id: string;
          updated_at: string;
        };
        Insert: {
          analysis_run_id?: string | null;
          classification?: string;
          created_at?: string;
          extracted_at?: string;
          file_digest: string;
          household_id: string;
          id?: string;
          page_count?: number;
          pages_json?: Json;
          parser_id?: string | null;
          parser_version?: string | null;
          policy_document_id?: string | null;
          session_id: string;
          updated_at?: string;
        };
        Update: {
          analysis_run_id?: string | null;
          classification?: string;
          created_at?: string;
          extracted_at?: string;
          file_digest?: string;
          household_id?: string;
          id?: string;
          page_count?: number;
          pages_json?: Json;
          parser_id?: string | null;
          parser_version?: string | null;
          policy_document_id?: string | null;
          session_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "extracted_documents_analysis_run_id_fkey";
            columns: ["analysis_run_id"];
            isOneToOne: false;
            referencedRelation: "document_analysis_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "extracted_documents_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "extracted_documents_policy_document_id_fkey";
            columns: ["policy_document_id"];
            isOneToOne: false;
            referencedRelation: "policy_documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "extracted_documents_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "document_extraction_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      extracted_fact_assertions: {
        Row: {
          authority: Database["public"]["Enums"]["assertion_authority"];
          candidate_id: string | null;
          confidence: number;
          confirmation_status: Database["public"]["Enums"]["assertion_confirmation_status"];
          confirmed_at: string | null;
          confirmed_by: string | null;
          created_at: string;
          document_id: string;
          entity_scope: string;
          field_path: string;
          id: string;
          normalized_value: Json | null;
          page_number: number;
          parsed_value: Json | null;
          parser_id: string;
          parser_version: string;
          raw_text: string;
        };
        Insert: {
          authority: Database["public"]["Enums"]["assertion_authority"];
          candidate_id?: string | null;
          confidence: number;
          confirmation_status?: Database["public"]["Enums"]["assertion_confirmation_status"];
          confirmed_at?: string | null;
          confirmed_by?: string | null;
          created_at?: string;
          document_id: string;
          entity_scope: string;
          field_path: string;
          id?: string;
          normalized_value?: Json | null;
          page_number: number;
          parsed_value?: Json | null;
          parser_id: string;
          parser_version: string;
          raw_text: string;
        };
        Update: {
          authority?: Database["public"]["Enums"]["assertion_authority"];
          candidate_id?: string | null;
          confidence?: number;
          confirmation_status?: Database["public"]["Enums"]["assertion_confirmation_status"];
          confirmed_at?: string | null;
          confirmed_by?: string | null;
          created_at?: string;
          document_id?: string;
          entity_scope?: string;
          field_path?: string;
          id?: string;
          normalized_value?: Json | null;
          page_number?: number;
          parsed_value?: Json | null;
          parser_id?: string;
          parser_version?: string;
          raw_text?: string;
        };
        Relationships: [
          {
            foreignKeyName: "extracted_fact_assertions_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "asset_candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "extracted_fact_assertions_confirmed_by_fkey";
            columns: ["confirmed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "extracted_fact_assertions_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "extracted_documents";
            referencedColumns: ["id"];
          },
        ];
      };
      household_coverage_mandates: {
        Row: {
          created_at: string;
          created_by: string | null;
          effective_from: string;
          household_auto_defaults: Json;
          household_id: string;
          household_property_defaults: Json;
          id: string;
          is_current: boolean;
          jurisdiction: string;
          schema_version: number;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          effective_from: string;
          household_auto_defaults?: Json;
          household_id: string;
          household_property_defaults?: Json;
          id?: string;
          is_current?: boolean;
          jurisdiction: string;
          schema_version: number;
          updated_at?: string;
          updated_by?: string | null;
          version: number;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          effective_from?: string;
          household_auto_defaults?: Json;
          household_id?: string;
          household_property_defaults?: Json;
          id?: string;
          is_current?: boolean;
          jurisdiction?: string;
          schema_version?: number;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "household_coverage_mandates_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "household_coverage_mandates_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "household_coverage_mandates_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      household_document_processing_setting_events: {
        Row: {
          actor_profile_id: string;
          automated_processing_acknowledged: boolean;
          configured_model_id: string | null;
          configured_provider: string | null;
          created_at: string;
          disclosure_version: string | null;
          enabled_state: boolean;
          event_type: string;
          foreign_processing_acknowledged: boolean;
          household_id: string;
          id: string;
          raw_processing_approved: boolean;
          reauthenticated_at: string | null;
        };
        Insert: {
          actor_profile_id: string;
          automated_processing_acknowledged?: boolean;
          configured_model_id?: string | null;
          configured_provider?: string | null;
          created_at?: string;
          disclosure_version?: string | null;
          enabled_state: boolean;
          event_type: string;
          foreign_processing_acknowledged?: boolean;
          household_id: string;
          id?: string;
          raw_processing_approved?: boolean;
          reauthenticated_at?: string | null;
        };
        Update: {
          actor_profile_id?: string;
          automated_processing_acknowledged?: boolean;
          configured_model_id?: string | null;
          configured_provider?: string | null;
          created_at?: string;
          disclosure_version?: string | null;
          enabled_state?: boolean;
          event_type?: string;
          foreign_processing_acknowledged?: boolean;
          household_id?: string;
          id?: string;
          raw_processing_approved?: boolean;
          reauthenticated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "household_document_processing_setting_eve_actor_profile_id_fkey";
            columns: ["actor_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "household_document_processing_setting_events_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
        ];
      };
      household_document_processing_settings: {
        Row: {
          configured_model_id: string | null;
          configured_provider: string | null;
          created_at: string;
          dangerous_mode_enabled: boolean;
          disabled_at: string | null;
          disclosure_version: string | null;
          enabled_at: string | null;
          enabled_by: string | null;
          household_id: string;
          setting_version: number;
          updated_at: string;
        };
        Insert: {
          configured_model_id?: string | null;
          configured_provider?: string | null;
          created_at?: string;
          dangerous_mode_enabled?: boolean;
          disabled_at?: string | null;
          disclosure_version?: string | null;
          enabled_at?: string | null;
          enabled_by?: string | null;
          household_id: string;
          setting_version?: number;
          updated_at?: string;
        };
        Update: {
          configured_model_id?: string | null;
          configured_provider?: string | null;
          created_at?: string;
          dangerous_mode_enabled?: boolean;
          disabled_at?: string | null;
          disclosure_version?: string | null;
          enabled_at?: string | null;
          enabled_by?: string | null;
          household_id?: string;
          setting_version?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "household_document_processing_settings_enabled_by_fkey";
            columns: ["enabled_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "household_document_processing_settings_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: true;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
        ];
      };
      household_members: {
        Row: {
          created_at: string;
          household_id: string;
          id: string;
          member_role: string;
          profile_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          household_id: string;
          id?: string;
          member_role?: string;
          profile_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          household_id?: string;
          id?: string;
          member_role?: string;
          profile_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "household_members_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "household_members_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      households: {
        Row: {
          autopilot_active: boolean;
          created_at: string;
          created_by: string | null;
          id: string;
          name: string;
          onboarding_step: string;
          owner_profile_id: string;
          province: string;
          timezone: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          autopilot_active?: boolean;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name: string;
          onboarding_step?: string;
          owner_profile_id: string;
          province?: string;
          timezone?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          autopilot_active?: boolean;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name?: string;
          onboarding_step?: string;
          owner_profile_id?: string;
          province?: string;
          timezone?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "households_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "households_owner_profile_id_fkey";
            columns: ["owner_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "households_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      insurer_channels: {
        Row: {
          address: string;
          channel_type: string;
          created_at: string;
          id: string;
          insurer_id: string;
          notes: string;
          updated_at: string;
        };
        Insert: {
          address: string;
          channel_type: string;
          created_at?: string;
          id?: string;
          insurer_id: string;
          notes?: string;
          updated_at?: string;
        };
        Update: {
          address?: string;
          channel_type?: string;
          created_at?: string;
          id?: string;
          insurer_id?: string;
          notes?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "insurer_channels_insurer_id_fkey";
            columns: ["insurer_id"];
            isOneToOne: false;
            referencedRelation: "insurer_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "insurer_channels_insurer_id_fkey";
            columns: ["insurer_id"];
            isOneToOne: false;
            referencedRelation: "insurers";
            referencedColumns: ["id"];
          },
        ];
      };
      insurers: {
        Row: {
          active: boolean;
          api_supported: boolean;
          billing_methods: Database["public"]["Enums"]["billing_method"][];
          bundle_supported: boolean;
          contact_method: string;
          created_at: string;
          distribution: string;
          email_supported: boolean;
          financial_strength_rating: Database["public"]["Enums"]["financial_rating"];
          id: string;
          internal_notes: string;
          name: string;
          payment_frequencies: Database["public"]["Enums"]["payment_frequency"][];
          portal_supported: boolean;
          products: Database["public"]["Enums"]["product_line"][];
          provinces: string[];
          updated_at: string;
          version: number;
          versioned_at: string | null;
        };
        Insert: {
          active?: boolean;
          api_supported?: boolean;
          billing_methods?: Database["public"]["Enums"]["billing_method"][];
          bundle_supported?: boolean;
          contact_method?: string;
          created_at?: string;
          distribution?: string;
          email_supported?: boolean;
          financial_strength_rating?: Database["public"]["Enums"]["financial_rating"];
          id?: string;
          internal_notes?: string;
          name: string;
          payment_frequencies?: Database["public"]["Enums"]["payment_frequency"][];
          portal_supported?: boolean;
          products?: Database["public"]["Enums"]["product_line"][];
          provinces?: string[];
          updated_at?: string;
          version?: number;
          versioned_at?: string | null;
        };
        Update: {
          active?: boolean;
          api_supported?: boolean;
          billing_methods?: Database["public"]["Enums"]["billing_method"][];
          bundle_supported?: boolean;
          contact_method?: string;
          created_at?: string;
          distribution?: string;
          email_supported?: boolean;
          financial_strength_rating?: Database["public"]["Enums"]["financial_rating"];
          id?: string;
          internal_notes?: string;
          name?: string;
          payment_frequencies?: Database["public"]["Enums"]["payment_frequency"][];
          portal_supported?: boolean;
          products?: Database["public"]["Enums"]["product_line"][];
          provinces?: string[];
          updated_at?: string;
          version?: number;
          versioned_at?: string | null;
        };
        Relationships: [];
      };
      manual_entry_idempotency: {
        Row: {
          batch_id: string;
          client_request_id: string;
          created_at: string;
          household_id: string;
          id: string;
          operation_type: string;
          result_id: string | null;
          result_json: Json;
        };
        Insert: {
          batch_id: string;
          client_request_id: string;
          created_at?: string;
          household_id: string;
          id?: string;
          operation_type: string;
          result_id?: string | null;
          result_json?: Json;
        };
        Update: {
          batch_id?: string;
          client_request_id?: string;
          created_at?: string;
          household_id?: string;
          id?: string;
          operation_type?: string;
          result_id?: string | null;
          result_json?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "manual_entry_idempotency_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "document_processing_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "manual_entry_idempotency_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
        ];
      };
      manual_policy_reviews: {
        Row: {
          actor_profile_id: string;
          candidate_id: string;
          client_request_id: string;
          created_at: string;
          household_id: string;
          id: string;
          result_json: Json;
        };
        Insert: {
          actor_profile_id: string;
          candidate_id: string;
          client_request_id: string;
          created_at?: string;
          household_id: string;
          id?: string;
          result_json?: Json;
        };
        Update: {
          actor_profile_id?: string;
          candidate_id?: string;
          client_request_id?: string;
          created_at?: string;
          household_id?: string;
          id?: string;
          result_json?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "manual_policy_reviews_actor_profile_id_fkey";
            columns: ["actor_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "manual_policy_reviews_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "asset_candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "manual_policy_reviews_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          action_url: string | null;
          body: string;
          channel: Database["public"]["Enums"]["notification_channel"];
          created_at: string;
          id: string;
          profile_id: string;
          read_at: string | null;
          title: string;
        };
        Insert: {
          action_url?: string | null;
          body: string;
          channel?: Database["public"]["Enums"]["notification_channel"];
          created_at?: string;
          id?: string;
          profile_id: string;
          read_at?: string | null;
          title: string;
        };
        Update: {
          action_url?: string | null;
          body?: string;
          channel?: Database["public"]["Enums"]["notification_channel"];
          created_at?: string;
          id?: string;
          profile_id?: string;
          read_at?: string | null;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      optimization_cases: {
        Row: {
          closed_from_state: Database["public"]["Enums"]["case_state"] | null;
          created_at: string;
          created_by: string | null;
          household_id: string;
          id: string;
          notes: string;
          renewal_date: string | null;
          state: Database["public"]["Enums"]["case_state"];
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          closed_from_state?: Database["public"]["Enums"]["case_state"] | null;
          created_at?: string;
          created_by?: string | null;
          household_id: string;
          id?: string;
          notes?: string;
          renewal_date?: string | null;
          state?: Database["public"]["Enums"]["case_state"];
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          closed_from_state?: Database["public"]["Enums"]["case_state"] | null;
          created_at?: string;
          created_by?: string | null;
          household_id?: string;
          id?: string;
          notes?: string;
          renewal_date?: string | null;
          state?: Database["public"]["Enums"]["case_state"];
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "optimization_cases_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "optimization_cases_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "optimization_cases_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      policies: {
        Row: {
          annual_premium_cents: number;
          base_deductible_cents: number | null;
          bundle_discount_cents: number;
          collision_deductible_cents: number | null;
          comprehensive_deductible_cents: number | null;
          coverage_details: Json;
          created_at: string;
          created_by: string | null;
          dwelling_limit_cents: number | null;
          household_id: string;
          id: string;
          insurer_id: string | null;
          insurer_name: string;
          is_current: boolean;
          liability_limit_cents: number | null;
          policy_number: string | null;
          product_line: Database["public"]["Enums"]["product_line"];
          renewal_date: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          annual_premium_cents?: number;
          base_deductible_cents?: number | null;
          bundle_discount_cents?: number;
          collision_deductible_cents?: number | null;
          comprehensive_deductible_cents?: number | null;
          coverage_details?: Json;
          created_at?: string;
          created_by?: string | null;
          dwelling_limit_cents?: number | null;
          household_id: string;
          id?: string;
          insurer_id?: string | null;
          insurer_name: string;
          is_current?: boolean;
          liability_limit_cents?: number | null;
          policy_number?: string | null;
          product_line: Database["public"]["Enums"]["product_line"];
          renewal_date?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          annual_premium_cents?: number;
          base_deductible_cents?: number | null;
          bundle_discount_cents?: number;
          collision_deductible_cents?: number | null;
          comprehensive_deductible_cents?: number | null;
          coverage_details?: Json;
          created_at?: string;
          created_by?: string | null;
          dwelling_limit_cents?: number | null;
          household_id?: string;
          id?: string;
          insurer_id?: string | null;
          insurer_name?: string;
          is_current?: boolean;
          liability_limit_cents?: number | null;
          policy_number?: string | null;
          product_line?: Database["public"]["Enums"]["product_line"];
          renewal_date?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "policies_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "policies_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "policies_insurer_id_fkey";
            columns: ["insurer_id"];
            isOneToOne: false;
            referencedRelation: "insurer_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "policies_insurer_id_fkey";
            columns: ["insurer_id"];
            isOneToOne: false;
            referencedRelation: "insurers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "policies_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      policy_asset_links: {
        Row: {
          asset_id: string;
          asset_type: Database["public"]["Enums"]["candidate_asset_type"];
          candidate_id: string | null;
          created_at: string;
          effective_from: string | null;
          effective_to: string | null;
          household_id: string;
          is_current: boolean;
          policy_id: string;
          product_line: Database["public"]["Enums"]["product_line"];
          updated_at: string;
        };
        Insert: {
          asset_id: string;
          asset_type: Database["public"]["Enums"]["candidate_asset_type"];
          candidate_id?: string | null;
          created_at?: string;
          effective_from?: string | null;
          effective_to?: string | null;
          household_id: string;
          is_current?: boolean;
          policy_id: string;
          product_line: Database["public"]["Enums"]["product_line"];
          updated_at?: string;
        };
        Update: {
          asset_id?: string;
          asset_type?: Database["public"]["Enums"]["candidate_asset_type"];
          candidate_id?: string | null;
          created_at?: string;
          effective_from?: string | null;
          effective_to?: string | null;
          household_id?: string;
          is_current?: boolean;
          policy_id?: string;
          product_line?: Database["public"]["Enums"]["product_line"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "policy_asset_links_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "asset_candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "policy_asset_links_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "policy_asset_links_policy_id_fkey";
            columns: ["policy_id"];
            isOneToOne: true;
            referencedRelation: "policies";
            referencedColumns: ["id"];
          },
        ];
      };
      policy_document_policy_links: {
        Row: {
          candidate_id: string | null;
          created_at: string;
          id: string;
          policy_document_id: string;
          policy_id: string;
          relationship_type: string;
        };
        Insert: {
          candidate_id?: string | null;
          created_at?: string;
          id?: string;
          policy_document_id: string;
          policy_id: string;
          relationship_type?: string;
        };
        Update: {
          candidate_id?: string | null;
          created_at?: string;
          id?: string;
          policy_document_id?: string;
          policy_id?: string;
          relationship_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "policy_document_policy_links_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "asset_candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "policy_document_policy_links_policy_document_id_fkey";
            columns: ["policy_document_id"];
            isOneToOne: false;
            referencedRelation: "policy_documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "policy_document_policy_links_policy_id_fkey";
            columns: ["policy_id"];
            isOneToOne: false;
            referencedRelation: "policies";
            referencedColumns: ["id"];
          },
        ];
      };
      policy_documents: {
        Row: {
          category: Database["public"]["Enums"]["document_category"];
          content_sha256: string | null;
          created_at: string;
          file_name: string;
          household_id: string;
          id: string;
          mime_type: string;
          policy_id: string | null;
          size_bytes: number;
          status: Database["public"]["Enums"]["document_status"];
          storage_path: string;
          updated_at: string;
          uploaded_by: string;
        };
        Insert: {
          category?: Database["public"]["Enums"]["document_category"];
          content_sha256?: string | null;
          created_at?: string;
          file_name: string;
          household_id: string;
          id?: string;
          mime_type: string;
          policy_id?: string | null;
          size_bytes?: number;
          status?: Database["public"]["Enums"]["document_status"];
          storage_path: string;
          updated_at?: string;
          uploaded_by: string;
        };
        Update: {
          category?: Database["public"]["Enums"]["document_category"];
          content_sha256?: string | null;
          created_at?: string;
          file_name?: string;
          household_id?: string;
          id?: string;
          mime_type?: string;
          policy_id?: string | null;
          size_bytes?: number;
          status?: Database["public"]["Enums"]["document_status"];
          storage_path?: string;
          updated_at?: string;
          uploaded_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "policy_documents_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "policy_documents_policy_id_fkey";
            columns: ["policy_id"];
            isOneToOne: false;
            referencedRelation: "policies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "policy_documents_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          email: string;
          full_name: string;
          id: string;
          role: Database["public"]["Enums"]["user_role"];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          full_name?: string;
          id: string;
          role?: Database["public"]["Enums"]["user_role"];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          full_name?: string;
          id?: string;
          role?: Database["public"]["Enums"]["user_role"];
          updated_at?: string;
        };
        Relationships: [];
      };
      properties: {
        Row: {
          address_line1: string;
          city: string;
          created_at: string;
          created_by: string | null;
          dwelling_type: string;
          household_id: string;
          id: string;
          owner_occupied: boolean;
          postal_code: string;
          property_type: Database["public"]["Enums"]["property_type"];
          province: string;
          updated_at: string;
          updated_by: string | null;
          year_built: number | null;
        };
        Insert: {
          address_line1: string;
          city: string;
          created_at?: string;
          created_by?: string | null;
          dwelling_type: string;
          household_id: string;
          id?: string;
          owner_occupied?: boolean;
          postal_code: string;
          property_type?: Database["public"]["Enums"]["property_type"];
          province?: string;
          updated_at?: string;
          updated_by?: string | null;
          year_built?: number | null;
        };
        Update: {
          address_line1?: string;
          city?: string;
          created_at?: string;
          created_by?: string | null;
          dwelling_type?: string;
          household_id?: string;
          id?: string;
          owner_occupied?: boolean;
          postal_code?: string;
          property_type?: Database["public"]["Enums"]["property_type"];
          province?: string;
          updated_at?: string;
          updated_by?: string | null;
          year_built?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "properties_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "properties_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "properties_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      property_mandate_overrides: {
        Row: {
          created_at: string;
          id: string;
          mandate_id: string;
          override_values: Json;
          property_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          mandate_id: string;
          override_values?: Json;
          property_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          mandate_id?: string;
          override_values?: Json;
          property_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "property_mandate_overrides_mandate_id_fkey";
            columns: ["mandate_id"];
            isOneToOne: false;
            referencedRelation: "household_coverage_mandates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "property_mandate_overrides_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
        ];
      };
      quote_coverages: {
        Row: {
          coverage: Json;
          coverage_schema_version: number;
          created_at: string;
          data_source: Database["public"]["Enums"]["quote_data_source"] | null;
          field_provenance: Json | null;
          id: string;
          normalized_coverage: Json | null;
          quote_component_id: string;
          raw_coverage: Json | null;
          updated_at: string;
          validated_at: string | null;
          validated_by: string | null;
          validation_errors: Json;
          validation_status: Database["public"]["Enums"]["quote_validation_status"];
        };
        Insert: {
          coverage: Json;
          coverage_schema_version?: number;
          created_at?: string;
          data_source?: Database["public"]["Enums"]["quote_data_source"] | null;
          field_provenance?: Json | null;
          id?: string;
          normalized_coverage?: Json | null;
          quote_component_id: string;
          raw_coverage?: Json | null;
          updated_at?: string;
          validated_at?: string | null;
          validated_by?: string | null;
          validation_errors?: Json;
          validation_status?: Database["public"]["Enums"]["quote_validation_status"];
        };
        Update: {
          coverage?: Json;
          coverage_schema_version?: number;
          created_at?: string;
          data_source?: Database["public"]["Enums"]["quote_data_source"] | null;
          field_provenance?: Json | null;
          id?: string;
          normalized_coverage?: Json | null;
          quote_component_id?: string;
          raw_coverage?: Json | null;
          updated_at?: string;
          validated_at?: string | null;
          validated_by?: string | null;
          validation_errors?: Json;
          validation_status?: Database["public"]["Enums"]["quote_validation_status"];
        };
        Relationships: [
          {
            foreignKeyName: "quote_coverages_quote_component_id_fkey";
            columns: ["quote_component_id"];
            isOneToOne: false;
            referencedRelation: "quote_policy_components";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quote_coverages_validated_by_fkey";
            columns: ["validated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      quote_policy_components: {
        Row: {
          annual_premium_cents: number;
          asset_id: string;
          created_at: string;
          id: string;
          product_line: Database["public"]["Enums"]["product_line"];
          quote_id: string;
          updated_at: string;
        };
        Insert: {
          annual_premium_cents: number;
          asset_id: string;
          created_at?: string;
          id?: string;
          product_line: Database["public"]["Enums"]["product_line"];
          quote_id: string;
          updated_at?: string;
        };
        Update: {
          annual_premium_cents?: number;
          asset_id?: string;
          created_at?: string;
          id?: string;
          product_line?: Database["public"]["Enums"]["product_line"];
          quote_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quote_policy_components_quote_id_fkey";
            columns: ["quote_id"];
            isOneToOne: false;
            referencedRelation: "quote_readiness";
            referencedColumns: ["quote_id"];
          },
          {
            foreignKeyName: "quote_policy_components_quote_id_fkey";
            columns: ["quote_id"];
            isOneToOne: false;
            referencedRelation: "quotes";
            referencedColumns: ["id"];
          },
        ];
      };
      quote_request_sends: {
        Row: {
          created_at: string;
          created_by: string | null;
          provider: string;
          quote_request_id: string;
          sent_at: string;
          status: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          provider?: string;
          quote_request_id: string;
          sent_at?: string;
          status?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          provider?: string;
          quote_request_id?: string;
          sent_at?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quote_request_sends_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quote_request_sends_quote_request_id_fkey";
            columns: ["quote_request_id"];
            isOneToOne: true;
            referencedRelation: "quote_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      quote_requests: {
        Row: {
          case_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          inclusion_reason: string;
          insurer_id: string;
          product_lines: Database["public"]["Enums"]["product_line"][];
          sent_at: string | null;
          state: Database["public"]["Enums"]["quote_request_state"];
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          case_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          inclusion_reason?: string;
          insurer_id: string;
          product_lines?: Database["public"]["Enums"]["product_line"][];
          sent_at?: string | null;
          state?: Database["public"]["Enums"]["quote_request_state"];
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          case_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          inclusion_reason?: string;
          insurer_id?: string;
          product_lines?: Database["public"]["Enums"]["product_line"][];
          sent_at?: string | null;
          state?: Database["public"]["Enums"]["quote_request_state"];
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "quote_requests_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "optimization_cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quote_requests_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quote_requests_insurer_id_fkey";
            columns: ["insurer_id"];
            isOneToOne: false;
            referencedRelation: "insurer_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quote_requests_insurer_id_fkey";
            columns: ["insurer_id"];
            isOneToOne: false;
            referencedRelation: "insurers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quote_requests_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      quotes: {
        Row: {
          bundle_discount_cents: number;
          cancellation_charge_cents: number;
          case_id: string;
          created_at: string;
          created_by: string | null;
          document_id: string | null;
          expires_at: string | null;
          id: string;
          insurer_id: string;
          is_incumbent: boolean;
          payment_fees_cents: number;
          policy_fees_cents: number;
          quote_request_id: string | null;
          state: Database["public"]["Enums"]["quote_state"];
          underwriting_conditions: string[];
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          bundle_discount_cents?: number;
          cancellation_charge_cents?: number;
          case_id: string;
          created_at?: string;
          created_by?: string | null;
          document_id?: string | null;
          expires_at?: string | null;
          id?: string;
          insurer_id: string;
          is_incumbent?: boolean;
          payment_fees_cents?: number;
          policy_fees_cents?: number;
          quote_request_id?: string | null;
          state?: Database["public"]["Enums"]["quote_state"];
          underwriting_conditions?: string[];
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          bundle_discount_cents?: number;
          cancellation_charge_cents?: number;
          case_id?: string;
          created_at?: string;
          created_by?: string | null;
          document_id?: string | null;
          expires_at?: string | null;
          id?: string;
          insurer_id?: string;
          is_incumbent?: boolean;
          payment_fees_cents?: number;
          policy_fees_cents?: number;
          quote_request_id?: string | null;
          state?: Database["public"]["Enums"]["quote_state"];
          underwriting_conditions?: string[];
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "quotes_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "optimization_cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quotes_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quotes_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "policy_documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quotes_insurer_id_fkey";
            columns: ["insurer_id"];
            isOneToOne: false;
            referencedRelation: "insurer_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quotes_insurer_id_fkey";
            columns: ["insurer_id"];
            isOneToOne: false;
            referencedRelation: "insurers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quotes_quote_request_id_fkey";
            columns: ["quote_request_id"];
            isOneToOne: false;
            referencedRelation: "quote_requests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quotes_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      recommendation_approvals: {
        Row: {
          approved: boolean;
          approver_profile_id: string;
          approver_role: Database["public"]["Enums"]["user_role"];
          created_at: string;
          device_info: string | null;
          id: string;
          notes: string;
          recommendation_id: string;
          session_info: string | null;
        };
        Insert: {
          approved: boolean;
          approver_profile_id: string;
          approver_role: Database["public"]["Enums"]["user_role"];
          created_at?: string;
          device_info?: string | null;
          id?: string;
          notes?: string;
          recommendation_id: string;
          session_info?: string | null;
        };
        Update: {
          approved?: boolean;
          approver_profile_id?: string;
          approver_role?: Database["public"]["Enums"]["user_role"];
          created_at?: string;
          device_info?: string | null;
          id?: string;
          notes?: string;
          recommendation_id?: string;
          session_info?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "recommendation_approvals_approver_profile_id_fkey";
            columns: ["approver_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recommendation_approvals_recommendation_id_fkey";
            columns: ["recommendation_id"];
            isOneToOne: false;
            referencedRelation: "recommendations";
            referencedColumns: ["id"];
          },
        ];
      };
      recommendation_generation_attempts: {
        Row: {
          actor_profile_id: string | null;
          case_id: string;
          completed_at: string | null;
          created_at: string;
          engine_output_digest: string | null;
          engine_source_hash: string | null;
          engine_version: string | null;
          error_code: string | null;
          id: string;
          input_snapshot_digest: string | null;
          mandate_id: string | null;
          mandate_version: number | null;
          recommendation_id: string | null;
          safe_error_message: string | null;
          started_at: string;
          status: string;
          switching_preferences_id: string | null;
          switching_preferences_version: number | null;
        };
        Insert: {
          actor_profile_id?: string | null;
          case_id: string;
          completed_at?: string | null;
          created_at?: string;
          engine_output_digest?: string | null;
          engine_source_hash?: string | null;
          engine_version?: string | null;
          error_code?: string | null;
          id?: string;
          input_snapshot_digest?: string | null;
          mandate_id?: string | null;
          mandate_version?: number | null;
          recommendation_id?: string | null;
          safe_error_message?: string | null;
          started_at?: string;
          status?: string;
          switching_preferences_id?: string | null;
          switching_preferences_version?: number | null;
        };
        Update: {
          actor_profile_id?: string | null;
          case_id?: string;
          completed_at?: string | null;
          created_at?: string;
          engine_output_digest?: string | null;
          engine_source_hash?: string | null;
          engine_version?: string | null;
          error_code?: string | null;
          id?: string;
          input_snapshot_digest?: string | null;
          mandate_id?: string | null;
          mandate_version?: number | null;
          recommendation_id?: string | null;
          safe_error_message?: string | null;
          started_at?: string;
          status?: string;
          switching_preferences_id?: string | null;
          switching_preferences_version?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "recommendation_generation_attempts_actor_profile_id_fkey";
            columns: ["actor_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recommendation_generation_attempts_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "optimization_cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recommendation_generation_attempts_recommendation_id_fkey";
            columns: ["recommendation_id"];
            isOneToOne: false;
            referencedRelation: "recommendations";
            referencedColumns: ["id"];
          },
        ];
      };
      recommendation_options: {
        Row: {
          auto_asset_id: string | null;
          auto_component_id: string | null;
          auto_quote_id: string | null;
          bundled: boolean;
          created_at: string;
          deductible_total_cents: number | null;
          eligible: boolean;
          id: string;
          net_savings_cents: number;
          preference_alignment: Json | null;
          property_asset_id: string | null;
          property_component_id: string | null;
          property_quote_id: string | null;
          rank: number;
          ranking_factors: Json | null;
          reason_codes: string[];
          recommendation_id: string;
          total_cents: number;
          underwriting_condition_count: number | null;
          updated_at: string;
        };
        Insert: {
          auto_asset_id?: string | null;
          auto_component_id?: string | null;
          auto_quote_id?: string | null;
          bundled?: boolean;
          created_at?: string;
          deductible_total_cents?: number | null;
          eligible?: boolean;
          id?: string;
          net_savings_cents: number;
          preference_alignment?: Json | null;
          property_asset_id?: string | null;
          property_component_id?: string | null;
          property_quote_id?: string | null;
          rank: number;
          ranking_factors?: Json | null;
          reason_codes?: string[];
          recommendation_id: string;
          total_cents: number;
          underwriting_condition_count?: number | null;
          updated_at?: string;
        };
        Update: {
          auto_asset_id?: string | null;
          auto_component_id?: string | null;
          auto_quote_id?: string | null;
          bundled?: boolean;
          created_at?: string;
          deductible_total_cents?: number | null;
          eligible?: boolean;
          id?: string;
          net_savings_cents?: number;
          preference_alignment?: Json | null;
          property_asset_id?: string | null;
          property_component_id?: string | null;
          property_quote_id?: string | null;
          rank?: number;
          ranking_factors?: Json | null;
          reason_codes?: string[];
          recommendation_id?: string;
          total_cents?: number;
          underwriting_condition_count?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "recommendation_options_auto_quote_id_fkey";
            columns: ["auto_quote_id"];
            isOneToOne: false;
            referencedRelation: "quote_readiness";
            referencedColumns: ["quote_id"];
          },
          {
            foreignKeyName: "recommendation_options_auto_quote_id_fkey";
            columns: ["auto_quote_id"];
            isOneToOne: false;
            referencedRelation: "quotes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recommendation_options_property_quote_id_fkey";
            columns: ["property_quote_id"];
            isOneToOne: false;
            referencedRelation: "quote_readiness";
            referencedColumns: ["quote_id"];
          },
          {
            foreignKeyName: "recommendation_options_property_quote_id_fkey";
            columns: ["property_quote_id"];
            isOneToOne: false;
            referencedRelation: "quotes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recommendation_options_recommendation_id_fkey";
            columns: ["recommendation_id"];
            isOneToOne: false;
            referencedRelation: "recommendations";
            referencedColumns: ["id"];
          },
        ];
      };
      recommendations: {
        Row: {
          case_id: string;
          comparison: Json;
          created_at: string;
          created_by: string | null;
          current_total_cents: number;
          disclosure_version: string;
          effective_date: string | null;
          engine_output_digest: string | null;
          engine_output_json: Json | null;
          engine_version: string;
          id: string;
          input_snapshot_digest: string | null;
          input_snapshot_json: Json | null;
          mandate_id: string | null;
          mandate_jurisdiction: string | null;
          mandate_schema_version: number | null;
          mandate_version: number;
          net_savings_cents: number;
          proposed_total_cents: number;
          quote_ids: string[];
          quote_snapshot: Json;
          reason_codes: string[];
          rejected_options_json: Json | null;
          status: Database["public"]["Enums"]["recommendation_status"];
          switching_preferences_id: string | null;
          switching_preferences_version: number;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          case_id: string;
          comparison?: Json;
          created_at?: string;
          created_by?: string | null;
          current_total_cents: number;
          disclosure_version?: string;
          effective_date?: string | null;
          engine_output_digest?: string | null;
          engine_output_json?: Json | null;
          engine_version?: string;
          id?: string;
          input_snapshot_digest?: string | null;
          input_snapshot_json?: Json | null;
          mandate_id?: string | null;
          mandate_jurisdiction?: string | null;
          mandate_schema_version?: number | null;
          mandate_version?: number;
          net_savings_cents: number;
          proposed_total_cents: number;
          quote_ids?: string[];
          quote_snapshot?: Json;
          reason_codes?: string[];
          rejected_options_json?: Json | null;
          status?: Database["public"]["Enums"]["recommendation_status"];
          switching_preferences_id?: string | null;
          switching_preferences_version?: number;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          case_id?: string;
          comparison?: Json;
          created_at?: string;
          created_by?: string | null;
          current_total_cents?: number;
          disclosure_version?: string;
          effective_date?: string | null;
          engine_output_digest?: string | null;
          engine_output_json?: Json | null;
          engine_version?: string;
          id?: string;
          input_snapshot_digest?: string | null;
          input_snapshot_json?: Json | null;
          mandate_id?: string | null;
          mandate_jurisdiction?: string | null;
          mandate_schema_version?: number | null;
          mandate_version?: number;
          net_savings_cents?: number;
          proposed_total_cents?: number;
          quote_ids?: string[];
          quote_snapshot?: Json;
          reason_codes?: string[];
          rejected_options_json?: Json | null;
          status?: Database["public"]["Enums"]["recommendation_status"];
          switching_preferences_id?: string | null;
          switching_preferences_version?: number;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "recommendations_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "optimization_cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recommendations_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recommendations_mandate_id_fkey";
            columns: ["mandate_id"];
            isOneToOne: false;
            referencedRelation: "household_coverage_mandates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recommendations_switching_preferences_id_fkey";
            columns: ["switching_preferences_id"];
            isOneToOne: false;
            referencedRelation: "switching_preferences";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recommendations_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      stripe_webhook_events: {
        Row: {
          attempt_count: number;
          completed_at: string | null;
          event_type: string;
          id: string;
          last_error: string | null;
          processed_at: string;
          status: string;
        };
        Insert: {
          attempt_count?: number;
          completed_at?: string | null;
          event_type: string;
          id: string;
          last_error?: string | null;
          processed_at?: string;
          status?: string;
        };
        Update: {
          attempt_count?: number;
          completed_at?: string | null;
          event_type?: string;
          id?: string;
          last_error?: string | null;
          processed_at?: string;
          status?: string;
        };
        Relationships: [];
      };
      subscriptions: {
        Row: {
          created_at: string;
          current_period_end: string | null;
          id: string;
          profile_id: string;
          status: Database["public"]["Enums"]["subscription_status"];
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          current_period_end?: string | null;
          id?: string;
          profile_id: string;
          status?: Database["public"]["Enums"]["subscription_status"];
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          current_period_end?: string | null;
          id?: string;
          profile_id?: string;
          status?: Database["public"]["Enums"]["subscription_status"];
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "subscriptions_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      switch_events: {
        Row: {
          case_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          incumbent_cancelled_at: string | null;
          recommendation_id: string | null;
          replacement_confirmed_at: string | null;
          state: Database["public"]["Enums"]["switch_state"];
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          case_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          incumbent_cancelled_at?: string | null;
          recommendation_id?: string | null;
          replacement_confirmed_at?: string | null;
          state?: Database["public"]["Enums"]["switch_state"];
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          case_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          incumbent_cancelled_at?: string | null;
          recommendation_id?: string | null;
          replacement_confirmed_at?: string | null;
          state?: Database["public"]["Enums"]["switch_state"];
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "switch_events_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "optimization_cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "switch_events_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "switch_events_recommendation_id_fkey";
            columns: ["recommendation_id"];
            isOneToOne: false;
            referencedRelation: "recommendations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "switch_events_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      switching_preferences: {
        Row: {
          allow_bundle_breakup: boolean;
          broker_direct_preference: Database["public"]["Enums"]["broker_direct_preference"];
          created_at: string;
          created_by: string | null;
          customer_approval_required: boolean;
          deductible_increases_allowed: boolean;
          excluded_insurer_ids: string[];
          household_id: string;
          household_optimization_enabled: boolean;
          id: string;
          is_current: boolean;
          material_coverage_reductions_allowed: boolean;
          max_deductible_increase_cents: number;
          max_premium_increase_cents: number;
          min_net_annual_savings_cents: number;
          minimum_insurer_financial_rating: Database["public"]["Enums"]["financial_rating"];
          preferred_billing_method: Database["public"]["Enums"]["billing_method"];
          preferred_payment_frequency: Database["public"]["Enums"]["payment_frequency"];
          renewal_only_switching: boolean;
          split_insurers_allowed: boolean;
          switch_only_after_customer_approval: boolean;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          allow_bundle_breakup?: boolean;
          broker_direct_preference?: Database["public"]["Enums"]["broker_direct_preference"];
          created_at?: string;
          created_by?: string | null;
          customer_approval_required?: boolean;
          deductible_increases_allowed?: boolean;
          excluded_insurer_ids?: string[];
          household_id: string;
          household_optimization_enabled?: boolean;
          id?: string;
          is_current?: boolean;
          material_coverage_reductions_allowed?: boolean;
          max_deductible_increase_cents?: number;
          max_premium_increase_cents?: number;
          min_net_annual_savings_cents?: number;
          minimum_insurer_financial_rating?: Database["public"]["Enums"]["financial_rating"];
          preferred_billing_method?: Database["public"]["Enums"]["billing_method"];
          preferred_payment_frequency?: Database["public"]["Enums"]["payment_frequency"];
          renewal_only_switching?: boolean;
          split_insurers_allowed?: boolean;
          switch_only_after_customer_approval?: boolean;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          allow_bundle_breakup?: boolean;
          broker_direct_preference?: Database["public"]["Enums"]["broker_direct_preference"];
          created_at?: string;
          created_by?: string | null;
          customer_approval_required?: boolean;
          deductible_increases_allowed?: boolean;
          excluded_insurer_ids?: string[];
          household_id?: string;
          household_optimization_enabled?: boolean;
          id?: string;
          is_current?: boolean;
          material_coverage_reductions_allowed?: boolean;
          max_deductible_increase_cents?: number;
          max_premium_increase_cents?: number;
          min_net_annual_savings_cents?: number;
          minimum_insurer_financial_rating?: Database["public"]["Enums"]["financial_rating"];
          preferred_billing_method?: Database["public"]["Enums"]["billing_method"];
          preferred_payment_frequency?: Database["public"]["Enums"]["payment_frequency"];
          renewal_only_switching?: boolean;
          split_insurers_allowed?: boolean;
          switch_only_after_customer_approval?: boolean;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "switching_preferences_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "switching_preferences_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "switching_preferences_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      vehicle_mandate_overrides: {
        Row: {
          created_at: string;
          id: string;
          mandate_id: string;
          override_values: Json;
          updated_at: string;
          vehicle_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          mandate_id: string;
          override_values?: Json;
          updated_at?: string;
          vehicle_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          mandate_id?: string;
          override_values?: Json;
          updated_at?: string;
          vehicle_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vehicle_mandate_overrides_mandate_id_fkey";
            columns: ["mandate_id"];
            isOneToOne: false;
            referencedRelation: "household_coverage_mandates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vehicle_mandate_overrides_vehicle_id_fkey";
            columns: ["vehicle_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id"];
          },
        ];
      };
      vehicles: {
        Row: {
          annual_km: number | null;
          created_at: string;
          created_by: string | null;
          financing_status: Database["public"]["Enums"]["financing_status"];
          household_id: string;
          id: string;
          is_classic: boolean;
          is_modified: boolean;
          make: string;
          model: string;
          primary_use: string;
          updated_at: string;
          updated_by: string | null;
          vehicle_use_class: Database["public"]["Enums"]["vehicle_use_class"];
          vin: string | null;
          year: number;
        };
        Insert: {
          annual_km?: number | null;
          created_at?: string;
          created_by?: string | null;
          financing_status?: Database["public"]["Enums"]["financing_status"];
          household_id: string;
          id?: string;
          is_classic?: boolean;
          is_modified?: boolean;
          make: string;
          model: string;
          primary_use: string;
          updated_at?: string;
          updated_by?: string | null;
          vehicle_use_class?: Database["public"]["Enums"]["vehicle_use_class"];
          vin?: string | null;
          year: number;
        };
        Update: {
          annual_km?: number | null;
          created_at?: string;
          created_by?: string | null;
          financing_status?: Database["public"]["Enums"]["financing_status"];
          household_id?: string;
          id?: string;
          is_classic?: boolean;
          is_modified?: boolean;
          make?: string;
          model?: string;
          primary_use?: string;
          updated_at?: string;
          updated_by?: string | null;
          vehicle_use_class?: Database["public"]["Enums"]["vehicle_use_class"];
          vin?: string | null;
          year?: number;
        };
        Relationships: [
          {
            foreignKeyName: "vehicles_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vehicles_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vehicles_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      insurer_directory: {
        Row: {
          active: boolean | null;
          api_supported: boolean | null;
          bundle_supported: boolean | null;
          contact_method: string | null;
          created_at: string | null;
          distribution: string | null;
          email_supported: boolean | null;
          id: string | null;
          internal_notes: string | null;
          name: string | null;
          portal_supported: boolean | null;
          products: Database["public"]["Enums"]["product_line"][] | null;
          provinces: string[] | null;
          updated_at: string | null;
        };
        Insert: {
          active?: boolean | null;
          api_supported?: boolean | null;
          bundle_supported?: boolean | null;
          contact_method?: string | null;
          created_at?: string | null;
          distribution?: string | null;
          email_supported?: boolean | null;
          id?: string | null;
          internal_notes?: string | null;
          name?: string | null;
          portal_supported?: boolean | null;
          products?: Database["public"]["Enums"]["product_line"][] | null;
          provinces?: string[] | null;
          updated_at?: string | null;
        };
        Update: {
          active?: boolean | null;
          api_supported?: boolean | null;
          bundle_supported?: boolean | null;
          contact_method?: string | null;
          created_at?: string | null;
          distribution?: string | null;
          email_supported?: boolean | null;
          id?: string | null;
          internal_notes?: string | null;
          name?: string | null;
          portal_supported?: boolean | null;
          products?: Database["public"]["Enums"]["product_line"][] | null;
          provinces?: string[] | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      quote_readiness: {
        Row: {
          case_id: string | null;
          component_count: number | null;
          draft_component_count: number | null;
          expires_at: string | null;
          incomplete_component_count: number | null;
          invalid_component_count: number | null;
          is_incumbent: boolean | null;
          quote_id: string | null;
          readiness_status: string | null;
          state: Database["public"]["Enums"]["quote_state"] | null;
          valid_component_count: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "quotes_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "optimization_cases";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      activate_autopilot: { Args: { p_household_id: string }; Returns: Json };
      advance_successor_batch_v1: {
        Args: { p_household_id: string; p_predecessor_batch_id: string };
        Returns: Json;
      };
      advance_switch_event: {
        Args: {
          p_switch_event_id: string;
          p_target_state: Database["public"]["Enums"]["switch_state"];
        };
        Returns: Json;
      };
      answer_customer_question: {
        Args: { p_answer: string; p_question_id: string };
        Returns: Json;
      };
      app_role: {
        Args: never;
        Returns: Database["public"]["Enums"]["user_role"];
      };
      approve_candidate_assets_v1: {
        Args: {
          p_actor_profile_id: string;
          p_candidate_ids: string[];
          p_client_request_id: string;
          p_household_auto_defaults?: Json;
          p_household_id: string;
          p_household_property_defaults?: Json;
          p_jurisdiction?: string;
          p_switching_preferences?: Json;
        };
        Returns: Json;
      };
      approve_candidate_assets_v2: {
        Args: {
          p_actor_profile_id: string;
          p_client_request_id: string;
          p_decisions: Json;
          p_household_auto_defaults?: Json;
          p_household_id: string;
          p_household_property_defaults?: Json;
          p_jurisdiction?: string;
          p_switching_preferences?: Json;
        };
        Returns: Json;
      };
      approve_customer_recommendation: {
        Args: { p_expected_rec_version: number; p_recommendation_id: string };
        Returns: Json;
      };
      assert_document_batch_generation_v1: {
        Args: {
          p_batch_id: string;
          p_household_id: string;
          p_processing_generation: number;
          p_session_id: string;
        };
        Returns: boolean;
      };
      assign_staff_role: {
        Args: {
          assigner_profile_id: string;
          target_profile_id: string;
          target_role: Database["public"]["Enums"]["user_role"];
        };
        Returns: undefined;
      };
      audit_context: {
        Args: never;
        Returns: {
          actor_id: string;
          actor_role: Database["public"]["Enums"]["user_role"];
        }[];
      };
      backfill_coverage_mandate_v2: { Args: never; Returns: undefined };
      can_access_case: { Args: { cid: string }; Returns: boolean };
      can_access_case_for_profile: {
        Args: { p_case_id: string; p_profile_id: string };
        Returns: boolean;
      };
      can_access_household: { Args: { hid: string }; Returns: boolean };
      canonicalize_quote_auto_coverage: { Args: { input: Json }; Returns: Json };
      canonicalize_quote_property_coverage: {
        Args: { input: Json };
        Returns: Json;
      };
      canonicalize_v2_monetary_rules: { Args: { input: Json }; Returns: Json };
      check_cleanup_readiness: { Args: never; Returns: Json };
      claim_document_processing_batch_v1: {
        Args: {
          p_batch_id: string;
          p_household_id: string;
          p_lease_seconds?: number;
        };
        Returns: boolean;
      };
      complete_customer_manual_entry_v1: {
        Args: {
          p_batch_id: string;
          p_case_id: string;
          p_client_request_id: string;
          p_household_id: string;
          p_session_id: string;
          p_skipped_document_ids?: string[];
        };
        Returns: Json;
      };
      complete_manual_review_v1: {
        Args: {
          p_actor_profile_id: string;
          p_batch_id: string;
          p_candidate_ids: string[];
          p_case_id: string;
          p_client_request_id?: string;
          p_household_id: string;
          p_session_id: string;
          p_skipped_document_ids?: string[];
        };
        Returns: Json;
      };
      complete_recommendation_generation_attempt: {
        Args: {
          p_attempt_id: string;
          p_engine_output_digest?: string;
          p_engine_source_hash?: string;
          p_engine_version?: string;
          p_error_code?: string;
          p_input_snapshot_digest?: string;
          p_mandate_id?: string;
          p_mandate_version?: number;
          p_recommendation_id?: string;
          p_safe_error_message?: string;
          p_status: string;
          p_switching_preferences_id?: string;
          p_switching_preferences_version?: number;
        };
        Returns: undefined;
      };
      confirm_customer_case_details: {
        Args: { p_case_id: string };
        Returns: Json;
      };
      create_customer_support_question: {
        Args: { p_case_id: string; p_prompt: string };
        Returns: Json;
      };
      create_document_processing_batch: {
        Args: {
          p_actor_id?: string;
          p_case_id?: string;
          p_client_request_id?: string;
          p_household_id?: string;
        };
        Returns: Json;
      };
      create_successor_document_batch_v1: {
        Args: {
          p_actor_id?: string;
          p_continuation_request_id?: string;
          p_expected_generation?: number;
          p_household_id: string;
          p_new_policy_document_ids?: string[];
          p_predecessor_batch_id: string;
        };
        Returns: Json;
      };
      decline_customer_recommendation: {
        Args: { p_expected_rec_version: number; p_recommendation_id: string };
        Returns: Json;
      };
      delete_manual_entry_candidate_v1: {
        Args: {
          p_batch_id: string;
          p_candidate_id: string;
          p_household_id: string;
        };
        Returns: Json;
      };
      derive_candidates_from_normalization_v1: {
        Args: {
          p_analysis_run_id: string;
          p_batch_id: string;
          p_household_id: string;
          p_normalization_id: string;
          p_processing_generation: number;
          p_session_id: string;
        };
        Returns: Json;
      };
      disable_dangerous_mode_v1: {
        Args: { p_household_id: string };
        Returns: Json;
      };
      enable_dangerous_mode_v1: {
        Args: {
          p_automated_processing_acknowledged: boolean;
          p_configured_model_id: string;
          p_configured_provider: string;
          p_disclosure_version: string;
          p_explicit_confirmation: boolean;
          p_foreign_processing_acknowledged: boolean;
          p_household_id: string;
          p_processor_contract_version: string;
          p_raw_processing_approved: boolean;
        };
        Returns: Json;
      };
      extract_extracted_value: {
        Args: { input: Json };
        Returns: Record<string, unknown>;
      };
      fail_recommendation_generation_attempt: {
        Args: {
          p_attempt_id: string;
          p_error_code?: string;
          p_safe_error_message?: string;
        };
        Returns: undefined;
      };
      household_advisory_lock_key: {
        Args: { p_household_id: string };
        Returns: number;
      };
      is_admin: { Args: never; Returns: boolean };
      is_household_member: { Args: { hid: string }; Returns: boolean };
      is_staff: { Args: never; Returns: boolean };
      jsonb_is_array: { Args: { p: Json }; Returns: boolean };
      jsonb_is_object: { Args: { p: Json }; Returns: boolean };
      log_audit: {
        Args: {
          action: string;
          after_summary: Json;
          before_summary: Json;
          case_id: string;
          entity_id: string;
          entity_type: string;
          household_id: string;
        };
        Returns: undefined;
      };
      merge_jsonb_objects_v1: {
        Args: { p_base: Json; p_patch: Json };
        Returns: Json;
      };
      persist_case_quote_v2: {
        Args: {
          p_actor_profile_id: string;
          p_bundle_discount_cents?: number;
          p_cancellation_charge_cents?: number;
          p_case_id: string;
          p_components: Json;
          p_data_source: Database["public"]["Enums"]["quote_data_source"];
          p_expected_version?: number;
          p_expires_at?: string;
          p_insurer_id: string;
          p_is_incumbent: boolean;
          p_payment_fees_cents?: number;
          p_policy_fees_cents?: number;
          p_quote_id?: string;
          p_state: Database["public"]["Enums"]["quote_state"];
          p_underwriting_conditions?: string[];
        };
        Returns: Json;
      };
      persist_document_analysis_v1: {
        Args: {
          p_analysis_json?: Json;
          p_analysis_run_id?: string;
          p_authorization_id?: string;
          p_candidates_json?: Json;
          p_client_request_id: string;
          p_consent_id?: string;
          p_documents_json?: Json;
          p_household_id: string;
          p_session_id: string;
        };
        Returns: Json;
      };
      persist_document_batch_analysis_v1: {
        Args: {
          p_analysis_json?: Json;
          p_analysis_run_id?: string;
          p_authorization_id?: string;
          p_batch_id: string;
          p_candidates_json?: Json;
          p_client_request_id: string;
          p_consent_id?: string;
          p_documents_json?: Json;
          p_household_id: string;
          p_processing_generation?: number;
          p_reviews_json?: Json;
          p_session_id: string;
        };
        Returns: Json;
      };
      persist_document_normalization_for_batch_v1: {
        Args: {
          p_analyzer_version: string;
          p_batch_id: string;
          p_batch_item_id: string;
          p_classification: string;
          p_conflicts_json: Json;
          p_content_sha256: string;
          p_evidence_json: Json;
          p_household_id: string;
          p_model_id: string;
          p_model_provider: string;
          p_normalization_schema_version: string;
          p_normalized_entities_json: Json;
          p_normalized_output_json: Json;
          p_policy_document_id: string;
          p_processing_generation: number;
          p_prompt_version: string;
        };
        Returns: Json;
      };
      persist_document_normalization_v1: {
        Args: {
          p_analyzer_version: string;
          p_classification: string;
          p_conflicts_json: Json;
          p_content_sha256: string;
          p_evidence_json: Json;
          p_household_id: string;
          p_model_id: string;
          p_model_provider: string;
          p_normalization_schema_version: string;
          p_normalized_entities_json: Json;
          p_normalized_output_json: Json;
          p_policy_document_id: string;
          p_prompt_version: string;
        };
        Returns: Json;
      };
      persist_engine_recommendation_v2: {
        Args: {
          p_actor_profile_id: string;
          p_case_id: string;
          p_comparison_json?: Json;
          p_current_total_cents: number;
          p_disclosure_version?: string;
          p_engine_output_canonical: string;
          p_engine_output_digest: string;
          p_engine_output_json: Json;
          p_engine_source_hash: string;
          p_engine_version: string;
          p_input_snapshot_canonical: string;
          p_input_snapshot_digest: string;
          p_input_snapshot_json: Json;
          p_mandate_id: string;
          p_mandate_jurisdiction: string;
          p_mandate_schema_version: number;
          p_mandate_version: number;
          p_net_savings_cents: number;
          p_proposed_total_cents: number;
          p_ranked_options_json: Json;
          p_reason_codes: string[];
          p_recommended_option_json: Json;
          p_rejected_options_json?: Json;
          p_switching_preferences_id: string;
          p_switching_preferences_version: number;
        };
        Returns: Json;
      };
      persist_household_mandate_v2: {
        Args: {
          p_created_by?: string;
          p_expected_mandate_version: number;
          p_expected_switching_version: number;
          p_household_auto_defaults: Json;
          p_household_id: string;
          p_household_property_defaults: Json;
          p_jurisdiction: string;
          p_property_overrides: Json;
          p_switching_preferences: Json;
          p_vehicle_overrides: Json;
        };
        Returns: Json;
      };
      plan_document_upload_v1: {
        Args: {
          p_actor_id?: string;
          p_case_id?: string;
          p_continuation_request_id?: string;
          p_household_id: string;
          p_new_policy_document_ids?: string[];
        };
        Returns: Json;
      };
      process_stripe_event: {
        Args: {
          p_current_period_end: string;
          p_event_id: string;
          p_event_type: string;
          p_profile_id: string;
          p_status: Database["public"]["Enums"]["subscription_status"];
          p_stripe_customer_id: string;
          p_stripe_subscription_id: string;
        };
        Returns: Json;
      };
      record_document_asset_overlap_v1: {
        Args: {
          p_asset_id: string;
          p_asset_type: Database["public"]["Enums"]["candidate_asset_type"];
          p_batch_id: string;
          p_classification: Database["public"]["Enums"]["document_asset_overlap_classification"];
          p_confidence: number;
          p_details_json: Json;
          p_existing_policy_id: string;
          p_normalization_id: string;
          p_normalized_entity_key: string;
        };
        Returns: string;
      };
      record_document_processing_consent: {
        Args: {
          p_authority_basis?: string;
          p_automated_processing_acknowledged: boolean;
          p_foreign_processing_acknowledged: boolean;
          p_household_id: string;
          p_privacy_notice_version: string;
          p_processor_contract_version: string;
          p_profile_id: string;
          p_purpose: string;
          p_raw_processing_approved: boolean;
        };
        Returns: string;
      };
      require_household_member_for_recommendation: {
        Args: { rec_id: string };
        Returns: string;
      };
      require_household_member_or_service_role:
        | { Args: { p_household_id: string }; Returns: string }
        | {
            Args: { p_household_id: string; p_supplied_actor_id: string };
            Returns: string;
          };
      review_recommendation: {
        Args: {
          p_approved: boolean;
          p_notes?: string;
          p_recommendation_id: string;
        };
        Returns: Json;
      };
      save_candidate_review_draft_v1: {
        Args: {
          p_candidate_id: string;
          p_decision: string;
          p_existing_asset_id?: string;
          p_existing_asset_type?: Database["public"]["Enums"]["candidate_asset_type"];
          p_household_id: string;
          p_identity_confirmed?: boolean;
        };
        Returns: Json;
      };
      save_customer_manual_policy_review_v1: {
        Args: {
          p_asset_type: Database["public"]["Enums"]["candidate_asset_type"];
          p_batch_id: string;
          p_case_id: string;
          p_client_request_id: string;
          p_display_label: string;
          p_household_id: string;
          p_identity_fingerprint: string;
          p_match_classification?: Database["public"]["Enums"]["candidate_match_classification"];
          p_occupancy?: string;
          p_selected_facts_json?: Json;
          p_session_id: string;
          p_source_document_ids: string[];
        };
        Returns: Json;
      };
      save_mandate_review_item_v1: {
        Args: {
          p_action: Database["public"]["Enums"]["candidate_field_review_action"];
          p_corrected_value?: Json;
          p_correction_reason?: string;
          p_current_mandate_value: Json;
          p_household_id: string;
          p_is_complete?: boolean;
          p_review_id: string;
        };
        Returns: Json;
      };
      save_manual_policy_review_v1: {
        Args: {
          p_actor_profile_id: string;
          p_asset_type: Database["public"]["Enums"]["candidate_asset_type"];
          p_candidate_id?: string;
          p_client_request_id: string;
          p_display_label: string;
          p_household_id: string;
          p_identity_fingerprint: string;
          p_match_classification?: Database["public"]["Enums"]["candidate_match_classification"];
          p_occupancy?: string;
          p_policy_document_id: string;
          p_provenance_json?: Json;
          p_selected_facts_json?: Json;
          p_session_id?: string;
        };
        Returns: Json;
      };
      save_staff_manual_policy_candidate_v1: {
        Args: {
          p_asset_type: Database["public"]["Enums"]["candidate_asset_type"];
          p_batch_id: string;
          p_case_id: string;
          p_client_request_id: string;
          p_display_label: string;
          p_household_id: string;
          p_identity_fingerprint: string;
          p_match_classification?: Database["public"]["Enums"]["candidate_match_classification"];
          p_occupancy?: string;
          p_selected_facts_json?: Json;
          p_session_id: string;
          p_source_document_ids: string[];
        };
        Returns: Json;
      };
      send_quote_request_email: {
        Args: {
          p_external_success?: boolean;
          p_provider: string;
          p_quote_request_id: string;
        };
        Returns: Json;
      };
      set_manual_entry_document_status_v1: {
        Args: {
          p_batch_id: string;
          p_household_id: string;
          p_policy_document_id: string;
          p_status: string;
        };
        Returns: Json;
      };
      staff_can_access_household: { Args: { hid: string }; Returns: boolean };
      start_recommendation_generation_attempt: {
        Args: { p_actor_profile_id: string; p_case_id: string };
        Returns: string;
      };
      supersede_prior_recommendations: {
        Args: { p_case_id: string };
        Returns: undefined;
      };
      supersede_processing_batch_v1: {
        Args: {
          p_active_batch_id: string;
          p_actor_id?: string;
          p_continuation_request_id?: string;
          p_expected_generation?: number;
          p_household_id: string;
          p_new_policy_document_ids?: string[];
        };
        Returns: Json;
      };
      update_candidate_display_label_v1: {
        Args: {
          p_candidate_id: string;
          p_display_label: string;
          p_household_id: string;
        };
        Returns: Json;
      };
      update_case_state: {
        Args: {
          p_case_id: string;
          p_target_state: Database["public"]["Enums"]["case_state"];
        };
        Returns: Json;
      };
      update_manual_entry_candidate_v1: {
        Args: {
          p_asset_type: Database["public"]["Enums"]["candidate_asset_type"];
          p_batch_id: string;
          p_candidate_id: string;
          p_case_id: string;
          p_client_request_id: string;
          p_display_label: string;
          p_household_id: string;
          p_identity_fingerprint: string;
          p_match_classification?: Database["public"]["Enums"]["candidate_match_classification"];
          p_occupancy?: string;
          p_selected_facts_json?: Json;
          p_session_id: string;
          p_source_document_ids: string[];
        };
        Returns: Json;
      };
      validate_candidate_approval_ready: {
        Args: {
          p_asset_type: Database["public"]["Enums"]["candidate_asset_type"];
          p_selected_facts_json: Json;
        };
        Returns: undefined;
      };
      validate_candidate_completion_ready: {
        Args: { p_candidate_id: string; p_household_id: string };
        Returns: undefined;
      };
      validate_candidate_policy_ready: {
        Args: {
          p_asset_type: Database["public"]["Enums"]["candidate_asset_type"];
          p_selected_facts_json: Json;
        };
        Returns: undefined;
      };
      validate_new_asset_identity_ready: {
        Args: {
          p_asset_type: Database["public"]["Enums"]["candidate_asset_type"];
          p_selected_facts_json: Json;
        };
        Returns: undefined;
      };
      withdraw_document_processing_consent: {
        Args: {
          p_household_id: string;
          p_profile_id: string;
          p_purpose: string;
        };
        Returns: string;
      };
    };
    Enums: {
      assertion_authority:
        | "coverage_summary"
        | "insurance_certificate"
        | "endorsement"
        | "invoice"
        | "renewal_overview"
        | "notice"
        | "header_footer";
      assertion_confirmation_status:
        | "extracted"
        | "confirmed"
        | "corrected"
        | "unknown"
        | "not_applicable"
        | "conflicting";
      auto_coverage_form:
        | "liability_only"
        | "collision"
        | "comprehensive"
        | "specified_perils"
        | "all_perils";
      billing_method: "automatic_bank" | "credit_card" | "mail";
      broker_direct_preference: "broker" | "direct" | "indifferent";
      candidate_asset_type: "property" | "vehicle";
      candidate_decision:
        | "undecided"
        | "approve_new"
        | "link_existing"
        | "skip"
        | "not_sure"
        | "approved"
        | "needs_correction";
      candidate_field_review_action:
        | "confirm"
        | "correct"
        | "unknown"
        | "change_mandate"
        | "reset_mandate_to_current"
        | "not_applicable"
        | "pending"
        | "keep_current"
        | "use_document_value"
        | "use_corrected_document_value"
        | "unresolved";
      candidate_match_classification:
        | "new"
        | "exact_existing_match"
        | "possible_existing_match"
        | "new_identity_confirmation_required";
      case_state:
        | "draft"
        | "awaiting_documents"
        | "extracting_information"
        | "awaiting_customer_confirmation"
        | "ready_for_market_search"
        | "requesting_quotes"
        | "awaiting_quotes"
        | "comparing_quotes"
        | "licensed_review"
        | "recommendation_ready"
        | "customer_decision"
        | "switching"
        | "completed"
        | "retained_incumbent"
        | "cancelled";
      consent_type:
        | "store_documents"
        | "share_for_quotation"
        | "generate_recommendations"
        | "electronic_communications";
      coverage_preference: "required" | "preferred" | "indifferent" | "prohibited";
      deductible_rule: "minimum" | "maximum" | "exact" | "match_current_or_better" | "any";
      document_asset_overlap_classification:
        | "exact_file_duplicate"
        | "same_asset_same_policy_term"
        | "same_asset_newer_policy_term"
        | "same_asset_supporting_document"
        | "same_asset_conflicting_information"
        | "possible_asset_match"
        | "new_asset";
      document_category:
        | "current_auto_policy"
        | "current_property_policy"
        | "renewal_notice"
        | "competing_quote"
        | "proof_of_insurance"
        | "signed_authorization"
        | "cancellation_confirmation"
        | "other"
        | "auto_detect";
      document_status: "uploaded" | "in_review" | "extracted" | "rejected" | "staged";
      financial_rating: "A_plus" | "A" | "A_minus" | "B_plus" | "B_or_lower" | "any";
      financing_status: "owned" | "financed" | "leased";
      limit_rule: "minimum" | "maximum" | "exact" | "match_current_or_better" | "any";
      notification_channel: "push" | "email" | "local_log";
      payment_frequency: "monthly" | "quarterly" | "semi_annual" | "annual";
      product_line: "auto" | "property";
      property_coverage_form: "comprehensive" | "broad" | "named_perils" | "basic";
      property_settlement:
        | "replacement_cost"
        | "guaranteed_replacement_cost"
        | "extended_replacement_cost"
        | "actual_cash_value";
      property_type:
        | "homeowner"
        | "condo"
        | "tenant"
        | "landlord"
        | "seasonal"
        | "secondary_residence";
      question_status: "pending" | "answered" | "cancelled";
      question_type:
        | "yes_no"
        | "single_choice"
        | "multiple_choice"
        | "number"
        | "date"
        | "short_text";
      quote_data_source:
        | "manual_entry"
        | "insurer_document"
        | "insurer_portal"
        | "api"
        | "customer_confirmed"
        | "migration_unknown";
      quote_request_state:
        | "draft"
        | "queued"
        | "sent"
        | "additional_information_required"
        | "response_received"
        | "declined"
        | "no_response"
        | "cancelled";
      quote_state: "estimate" | "conditional" | "bindable" | "expired" | "rejected" | "selected";
      quote_validation_status: "draft" | "incomplete" | "valid" | "invalid" | "superseded";
      recommendation_status:
        | "draft"
        | "awaiting_review"
        | "approved"
        | "rejected"
        | "published"
        | "customer_approved"
        | "customer_declined"
        | "superseded";
      subscription_status: "inactive" | "pending" | "active" | "past_due" | "cancelled";
      switch_state:
        | "customer_approved"
        | "replacement_pending"
        | "replacement_confirmed"
        | "incumbent_cancellation_pending"
        | "incumbent_cancelled"
        | "completed"
        | "failed";
      user_role: "customer" | "operations" | "reviewer" | "admin";
      vehicle_use_class: "personal" | "commercial" | "classic" | "modified";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      assertion_authority: [
        "coverage_summary",
        "insurance_certificate",
        "endorsement",
        "invoice",
        "renewal_overview",
        "notice",
        "header_footer",
      ],
      assertion_confirmation_status: [
        "extracted",
        "confirmed",
        "corrected",
        "unknown",
        "not_applicable",
        "conflicting",
      ],
      auto_coverage_form: [
        "liability_only",
        "collision",
        "comprehensive",
        "specified_perils",
        "all_perils",
      ],
      billing_method: ["automatic_bank", "credit_card", "mail"],
      broker_direct_preference: ["broker", "direct", "indifferent"],
      candidate_asset_type: ["property", "vehicle"],
      candidate_decision: [
        "undecided",
        "approve_new",
        "link_existing",
        "skip",
        "not_sure",
        "approved",
        "needs_correction",
      ],
      candidate_field_review_action: [
        "confirm",
        "correct",
        "unknown",
        "change_mandate",
        "reset_mandate_to_current",
        "not_applicable",
        "pending",
        "keep_current",
        "use_document_value",
        "use_corrected_document_value",
        "unresolved",
      ],
      candidate_match_classification: [
        "new",
        "exact_existing_match",
        "possible_existing_match",
        "new_identity_confirmation_required",
      ],
      case_state: [
        "draft",
        "awaiting_documents",
        "extracting_information",
        "awaiting_customer_confirmation",
        "ready_for_market_search",
        "requesting_quotes",
        "awaiting_quotes",
        "comparing_quotes",
        "licensed_review",
        "recommendation_ready",
        "customer_decision",
        "switching",
        "completed",
        "retained_incumbent",
        "cancelled",
      ],
      consent_type: [
        "store_documents",
        "share_for_quotation",
        "generate_recommendations",
        "electronic_communications",
      ],
      coverage_preference: ["required", "preferred", "indifferent", "prohibited"],
      deductible_rule: ["minimum", "maximum", "exact", "match_current_or_better", "any"],
      document_asset_overlap_classification: [
        "exact_file_duplicate",
        "same_asset_same_policy_term",
        "same_asset_newer_policy_term",
        "same_asset_supporting_document",
        "same_asset_conflicting_information",
        "possible_asset_match",
        "new_asset",
      ],
      document_category: [
        "current_auto_policy",
        "current_property_policy",
        "renewal_notice",
        "competing_quote",
        "proof_of_insurance",
        "signed_authorization",
        "cancellation_confirmation",
        "other",
        "auto_detect",
      ],
      document_status: ["uploaded", "in_review", "extracted", "rejected", "staged"],
      financial_rating: ["A_plus", "A", "A_minus", "B_plus", "B_or_lower", "any"],
      financing_status: ["owned", "financed", "leased"],
      limit_rule: ["minimum", "maximum", "exact", "match_current_or_better", "any"],
      notification_channel: ["push", "email", "local_log"],
      payment_frequency: ["monthly", "quarterly", "semi_annual", "annual"],
      product_line: ["auto", "property"],
      property_coverage_form: ["comprehensive", "broad", "named_perils", "basic"],
      property_settlement: [
        "replacement_cost",
        "guaranteed_replacement_cost",
        "extended_replacement_cost",
        "actual_cash_value",
      ],
      property_type: [
        "homeowner",
        "condo",
        "tenant",
        "landlord",
        "seasonal",
        "secondary_residence",
      ],
      question_status: ["pending", "answered", "cancelled"],
      question_type: ["yes_no", "single_choice", "multiple_choice", "number", "date", "short_text"],
      quote_data_source: [
        "manual_entry",
        "insurer_document",
        "insurer_portal",
        "api",
        "customer_confirmed",
        "migration_unknown",
      ],
      quote_request_state: [
        "draft",
        "queued",
        "sent",
        "additional_information_required",
        "response_received",
        "declined",
        "no_response",
        "cancelled",
      ],
      quote_state: ["estimate", "conditional", "bindable", "expired", "rejected", "selected"],
      quote_validation_status: ["draft", "incomplete", "valid", "invalid", "superseded"],
      recommendation_status: [
        "draft",
        "awaiting_review",
        "approved",
        "rejected",
        "published",
        "customer_approved",
        "customer_declined",
        "superseded",
      ],
      subscription_status: ["inactive", "pending", "active", "past_due", "cancelled"],
      switch_state: [
        "customer_approved",
        "replacement_pending",
        "replacement_confirmed",
        "incumbent_cancellation_pending",
        "incumbent_cancelled",
        "completed",
        "failed",
      ],
      user_role: ["customer", "operations", "reviewer", "admin"],
      vehicle_use_class: ["personal", "commercial", "classic", "modified"],
    },
  },
} as const;
