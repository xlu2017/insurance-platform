export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
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
          property_requirements: Json;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          auto_requirements: Json;
          created_at?: string;
          created_by?: string | null;
          household_id: string;
          id?: string;
          is_current?: boolean;
          property_requirements: Json;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          auto_requirements?: Json;
          created_at?: string;
          created_by?: string | null;
          household_id?: string;
          id?: string;
          is_current?: boolean;
          property_requirements?: Json;
          updated_at?: string;
          updated_by?: string | null;
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
          id: string;
          provider: string;
          sent_at: string | null;
          subject: string;
          to_email: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          email_type: string;
          id?: string;
          provider?: string;
          sent_at?: string | null;
          subject: string;
          to_email: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          email_type?: string;
          id?: string;
          provider?: string;
          sent_at?: string | null;
          subject?: string;
          to_email?: string;
        };
        Relationships: [];
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
          bundle_supported: boolean;
          contact_method: string;
          created_at: string;
          distribution: string;
          email_supported: boolean;
          id: string;
          internal_notes: string;
          name: string;
          portal_supported: boolean;
          products: Database["public"]["Enums"]["product_line"][];
          provinces: string[];
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          api_supported?: boolean;
          bundle_supported?: boolean;
          contact_method?: string;
          created_at?: string;
          distribution?: string;
          email_supported?: boolean;
          id?: string;
          internal_notes?: string;
          name: string;
          portal_supported?: boolean;
          products?: Database["public"]["Enums"]["product_line"][];
          provinces?: string[];
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          api_supported?: boolean;
          bundle_supported?: boolean;
          contact_method?: string;
          created_at?: string;
          distribution?: string;
          email_supported?: boolean;
          id?: string;
          internal_notes?: string;
          name?: string;
          portal_supported?: boolean;
          products?: Database["public"]["Enums"]["product_line"][];
          provinces?: string[];
          updated_at?: string;
        };
        Relationships: [];
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
      policy_documents: {
        Row: {
          category: Database["public"]["Enums"]["document_category"];
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
          dwelling_type?: string;
          household_id: string;
          id?: string;
          owner_occupied?: boolean;
          postal_code: string;
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
      quote_coverages: {
        Row: {
          coverage: Json;
          created_at: string;
          id: string;
          quote_component_id: string;
          updated_at: string;
        };
        Insert: {
          coverage: Json;
          created_at?: string;
          id?: string;
          quote_component_id: string;
          updated_at?: string;
        };
        Update: {
          coverage?: Json;
          created_at?: string;
          id?: string;
          quote_component_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quote_coverages_quote_component_id_fkey";
            columns: ["quote_component_id"];
            isOneToOne: false;
            referencedRelation: "quote_policy_components";
            referencedColumns: ["id"];
          },
        ];
      };
      quote_policy_components: {
        Row: {
          annual_premium_cents: number;
          created_at: string;
          id: string;
          product_line: Database["public"]["Enums"]["product_line"];
          quote_id: string;
          updated_at: string;
        };
        Insert: {
          annual_premium_cents: number;
          created_at?: string;
          id?: string;
          product_line: Database["public"]["Enums"]["product_line"];
          quote_id: string;
          updated_at?: string;
        };
        Update: {
          annual_premium_cents?: number;
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
      recommendation_options: {
        Row: {
          auto_quote_id: string | null;
          bundled: boolean;
          created_at: string;
          eligible: boolean;
          id: string;
          net_savings_cents: number;
          property_quote_id: string | null;
          rank: number;
          reason_codes: string[];
          recommendation_id: string;
          total_cents: number;
          updated_at: string;
        };
        Insert: {
          auto_quote_id?: string | null;
          bundled?: boolean;
          created_at?: string;
          eligible?: boolean;
          id?: string;
          net_savings_cents: number;
          property_quote_id?: string | null;
          rank: number;
          reason_codes?: string[];
          recommendation_id: string;
          total_cents: number;
          updated_at?: string;
        };
        Update: {
          auto_quote_id?: string | null;
          bundled?: boolean;
          created_at?: string;
          eligible?: boolean;
          id?: string;
          net_savings_cents?: number;
          property_quote_id?: string | null;
          rank?: number;
          reason_codes?: string[];
          recommendation_id?: string;
          total_cents?: number;
          updated_at?: string;
        };
        Relationships: [
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
          id: string;
          mandate_version: number;
          net_savings_cents: number;
          proposed_total_cents: number;
          quote_ids: string[];
          reason_codes: string[];
          status: Database["public"]["Enums"]["recommendation_status"];
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
          id?: string;
          mandate_version?: number;
          net_savings_cents: number;
          proposed_total_cents: number;
          quote_ids?: string[];
          reason_codes?: string[];
          status?: Database["public"]["Enums"]["recommendation_status"];
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
          id?: string;
          mandate_version?: number;
          net_savings_cents?: number;
          proposed_total_cents?: number;
          quote_ids?: string[];
          reason_codes?: string[];
          status?: Database["public"]["Enums"]["recommendation_status"];
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
          min_net_annual_savings_cents: number;
          renewal_only_switching: boolean;
          split_insurers_allowed: boolean;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
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
          min_net_annual_savings_cents?: number;
          renewal_only_switching?: boolean;
          split_insurers_allowed?: boolean;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
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
          min_net_annual_savings_cents?: number;
          renewal_only_switching?: boolean;
          split_insurers_allowed?: boolean;
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
      vehicles: {
        Row: {
          annual_km: number | null;
          created_at: string;
          created_by: string | null;
          household_id: string;
          id: string;
          make: string;
          model: string;
          primary_use: string;
          updated_at: string;
          updated_by: string | null;
          vin: string | null;
          year: number;
        };
        Insert: {
          annual_km?: number | null;
          created_at?: string;
          created_by?: string | null;
          household_id: string;
          id?: string;
          make: string;
          model: string;
          primary_use?: string;
          updated_at?: string;
          updated_by?: string | null;
          vin?: string | null;
          year: number;
        };
        Update: {
          annual_km?: number | null;
          created_at?: string;
          created_by?: string | null;
          household_id?: string;
          id?: string;
          make?: string;
          model?: string;
          primary_use?: string;
          updated_at?: string;
          updated_by?: string | null;
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
    };
    Functions: {
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
      approve_customer_recommendation: {
        Args: {
          p_expected_mandate_version: number;
          p_expected_rec_version: number;
          p_recommendation_id: string;
        };
        Returns: Json;
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
      can_access_case: { Args: { cid: string }; Returns: boolean };
      can_access_household: { Args: { hid: string }; Returns: boolean };
      create_customer_support_question: {
        Args: { p_case_id: string; p_prompt: string };
        Returns: Json;
      };
      decline_customer_recommendation: {
        Args: {
          p_expected_mandate_version: number;
          p_expected_rec_version: number;
          p_recommendation_id: string;
        };
        Returns: Json;
      };
      is_admin: { Args: never; Returns: boolean };
      is_household_member: { Args: { hid: string }; Returns: boolean };
      is_staff: { Args: never; Returns: boolean };
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
      require_household_member_for_recommendation: {
        Args: { rec_id: string };
        Returns: string;
      };
      review_recommendation: {
        Args: {
          p_approved: boolean;
          p_notes: string;
          p_recommendation_id: string;
        };
        Returns: Json;
      };
      staff_can_access_household: { Args: { hid: string }; Returns: boolean };
    };
    Enums: {
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
      document_category:
        | "current_auto_policy"
        | "current_property_policy"
        | "renewal_notice"
        | "competing_quote"
        | "proof_of_insurance"
        | "signed_authorization"
        | "cancellation_confirmation"
        | "other";
      document_status: "uploaded" | "in_review" | "extracted" | "rejected";
      notification_channel: "push" | "email" | "local_log";
      product_line: "auto" | "property";
      question_status: "pending" | "answered" | "cancelled";
      question_type:
        | "yes_no"
        | "single_choice"
        | "multiple_choice"
        | "number"
        | "date"
        | "short_text";
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
      document_category: [
        "current_auto_policy",
        "current_property_policy",
        "renewal_notice",
        "competing_quote",
        "proof_of_insurance",
        "signed_authorization",
        "cancellation_confirmation",
        "other",
      ],
      document_status: ["uploaded", "in_review", "extracted", "rejected"],
      notification_channel: ["push", "email", "local_log"],
      product_line: ["auto", "property"],
      question_status: ["pending", "answered", "cancelled"],
      question_type: ["yes_no", "single_choice", "multiple_choice", "number", "date", "short_text"],
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
    },
  },
} as const;
