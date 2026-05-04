export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      ai_citations: {
        Row: {
          chunk_id: string | null
          created_at: string
          file_id: string | null
          id: string
          message_id: string | null
          relevance_score: number | null
          snippet: string
          suggestion_id: string | null
        }
        Insert: {
          chunk_id?: string | null
          created_at?: string
          file_id?: string | null
          id?: string
          message_id?: string | null
          relevance_score?: number | null
          snippet: string
          suggestion_id?: string | null
        }
        Update: {
          chunk_id?: string | null
          created_at?: string
          file_id?: string | null
          id?: string
          message_id?: string | null
          relevance_score?: number | null
          snippet?: string
          suggestion_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_citations_chunk_id_fkey"
            columns: ["chunk_id"]
            isOneToOne: false
            referencedRelation: "knowledge_chunks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_citations_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "knowledge_files"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_feedback: {
        Row: {
          created_at: string
          edited_text: string | null
          id: string
          outcome: string | null
          rating: string
          suggestion_id: string
          used_as_is: boolean | null
          user_id: string
        }
        Insert: {
          created_at?: string
          edited_text?: string | null
          id?: string
          outcome?: string | null
          rating: string
          suggestion_id: string
          used_as_is?: boolean | null
          user_id: string
        }
        Update: {
          created_at?: string
          edited_text?: string | null
          id?: string
          outcome?: string | null
          rating?: string
          suggestion_id?: string
          used_as_is?: boolean | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_feedback_suggestion_id_fkey"
            columns: ["suggestion_id"]
            isOneToOne: false
            referencedRelation: "ai_suggestions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_suggestions: {
        Row: {
          confidence: number | null
          content: Json
          conversation_id: string
          created_at: string
          id: string
          mode: string | null
          status: string | null
          suggestion_type: string
        }
        Insert: {
          confidence?: number | null
          content?: Json
          conversation_id: string
          created_at?: string
          id?: string
          mode?: string | null
          status?: string | null
          suggestion_type?: string
        }
        Update: {
          confidence?: number | null
          content?: Json
          conversation_id?: string
          created_at?: string
          id?: string
          mode?: string | null
          status?: string | null
          suggestion_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_suggestions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_trainer_rules: {
        Row: {
          created_at: string
          created_by: string | null
          enabled: boolean
          id: string
          instruction: string
          notes: string | null
          priority: Database["public"]["Enums"]["trainer_priority"]
          product: string | null
          title: string
          triggers: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          instruction: string
          notes?: string | null
          priority?: Database["public"]["Enums"]["trainer_priority"]
          product?: string | null
          title: string
          triggers?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          instruction?: string
          notes?: string | null
          priority?: Database["public"]["Enums"]["trainer_priority"]
          product?: string | null
          title?: string
          triggers?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      auto_reply_events: {
        Row: {
          action_taken: string
          conversation_id: string
          created_at: string
          id: string
          inbound_message_id: string | null
          knowledge_found: boolean | null
          knowledge_query: string | null
          menu_option: string | null
          reason: string | null
          template_used: string | null
        }
        Insert: {
          action_taken: string
          conversation_id: string
          created_at?: string
          id?: string
          inbound_message_id?: string | null
          knowledge_found?: boolean | null
          knowledge_query?: string | null
          menu_option?: string | null
          reason?: string | null
          template_used?: string | null
        }
        Update: {
          action_taken?: string
          conversation_id?: string
          created_at?: string
          id?: string
          inbound_message_id?: string | null
          knowledge_found?: boolean | null
          knowledge_query?: string | null
          menu_option?: string | null
          reason?: string | null
          template_used?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "auto_reply_events_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      automations: {
        Row: {
          action_description: string
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          last_run_at: string | null
          last_synced_at: string | null
          name: string
          run_count: number
          trigger_condition: string
          updated_at: string
        }
        Insert: {
          action_description: string
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          last_run_at?: string | null
          last_synced_at?: string | null
          name: string
          run_count?: number
          trigger_condition: string
          updated_at?: string
        }
        Update: {
          action_description?: string
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          last_run_at?: string | null
          last_synced_at?: string | null
          name?: string
          run_count?: number
          trigger_condition?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_activity: {
        Row: {
          contact_id: string
          created_at: string
          id: string
          metadata: Json | null
          performed_by: string
          type: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          id?: string
          metadata?: Json | null
          performed_by: string
          type: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          performed_by?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_activity_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          assigned_to: string | null
          avatar_url: string | null
          contact_confidence: string
          contact_source: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          do_not_contact: boolean
          do_not_contact_at: string | null
          do_not_contact_reason: string | null
          email: string | null
          first_name: string | null
          id: string
          interest: Database["public"]["Enums"]["interest_level"]
          is_deleted: boolean
          last_name: string | null
          last_synced_at: string | null
          lead_type: Database["public"]["Enums"]["lead_type"]
          name: string
          name_needs_confirmation: boolean
          notes: string | null
          phone: string
          phone_normalized: string | null
          phone_raw: string | null
          stage_id: string | null
          tags: string[] | null
          temperature: Database["public"]["Enums"]["lead_temperature"]
          updated_at: string
          whatsapp_display_name: string | null
          whatsapp_id: string | null
        }
        Insert: {
          assigned_to?: string | null
          avatar_url?: string | null
          contact_confidence?: string
          contact_source?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          do_not_contact?: boolean
          do_not_contact_at?: string | null
          do_not_contact_reason?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          interest?: Database["public"]["Enums"]["interest_level"]
          is_deleted?: boolean
          last_name?: string | null
          last_synced_at?: string | null
          lead_type?: Database["public"]["Enums"]["lead_type"]
          name: string
          name_needs_confirmation?: boolean
          notes?: string | null
          phone: string
          phone_normalized?: string | null
          phone_raw?: string | null
          stage_id?: string | null
          tags?: string[] | null
          temperature?: Database["public"]["Enums"]["lead_temperature"]
          updated_at?: string
          whatsapp_display_name?: string | null
          whatsapp_id?: string | null
        }
        Update: {
          assigned_to?: string | null
          avatar_url?: string | null
          contact_confidence?: string
          contact_source?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          do_not_contact?: boolean
          do_not_contact_at?: string | null
          do_not_contact_reason?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          interest?: Database["public"]["Enums"]["interest_level"]
          is_deleted?: boolean
          last_name?: string | null
          last_synced_at?: string | null
          lead_type?: Database["public"]["Enums"]["lead_type"]
          name?: string
          name_needs_confirmation?: boolean
          notes?: string | null
          phone?: string
          phone_normalized?: string | null
          phone_raw?: string | null
          stage_id?: string | null
          tags?: string[] | null
          temperature?: Database["public"]["Enums"]["lead_temperature"]
          updated_at?: string
          whatsapp_display_name?: string | null
          whatsapp_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          contact_id: string
          created_at: string
          id: string
          last_inbound_at: string | null
          last_message: string | null
          last_message_at: string | null
          last_outbound_at: string | null
          last_synced_at: string | null
          status: Database["public"]["Enums"]["comm_status"]
          unread_count: number
          updated_at: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          id?: string
          last_inbound_at?: string | null
          last_message?: string | null
          last_message_at?: string | null
          last_outbound_at?: string | null
          last_synced_at?: string | null
          status?: Database["public"]["Enums"]["comm_status"]
          unread_count?: number
          updated_at?: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          id?: string
          last_inbound_at?: string | null
          last_message?: string | null
          last_message_at?: string | null
          last_outbound_at?: string | null
          last_synced_at?: string | null
          status?: Database["public"]["Enums"]["comm_status"]
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      followup_logs: {
        Row: {
          contact_id: string
          conversation_id: string | null
          created_at: string
          delivery: string
          error: string | null
          id: string
          intent_state: string | null
          message_text: string | null
          missed_inquiry_id: string | null
          outcome: string | null
          phone: string | null
          provider_message_id: string | null
          send_mode: string
          step_number: number | null
          template_id: string | null
          topic: string | null
        }
        Insert: {
          contact_id: string
          conversation_id?: string | null
          created_at?: string
          delivery?: string
          error?: string | null
          id?: string
          intent_state?: string | null
          message_text?: string | null
          missed_inquiry_id?: string | null
          outcome?: string | null
          phone?: string | null
          provider_message_id?: string | null
          send_mode: string
          step_number?: number | null
          template_id?: string | null
          topic?: string | null
        }
        Update: {
          contact_id?: string
          conversation_id?: string | null
          created_at?: string
          delivery?: string
          error?: string | null
          id?: string
          intent_state?: string | null
          message_text?: string | null
          missed_inquiry_id?: string | null
          outcome?: string | null
          phone?: string | null
          provider_message_id?: string | null
          send_mode?: string
          step_number?: number | null
          template_id?: string | null
          topic?: string | null
        }
        Relationships: []
      }
      followup_templates: {
        Row: {
          created_at: string
          delay_hours: number
          enabled: boolean
          id: string
          intent_state: string
          notes: string | null
          send_mode: string
          step_number: number
          template_text: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          delay_hours: number
          enabled?: boolean
          id?: string
          intent_state: string
          notes?: string | null
          send_mode?: string
          step_number: number
          template_text: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          delay_hours?: number
          enabled?: boolean
          id?: string
          intent_state?: string
          notes?: string | null
          send_mode?: string
          step_number?: number
          template_text?: string
          updated_at?: string
        }
        Relationships: []
      }
      group_admin_actions: {
        Row: {
          action_type: string
          error: string | null
          finished_at: string | null
          group_jid: string | null
          group_name: string | null
          id: string
          performed_by: string | null
          result: Json
          send_activity_attempted: boolean
          started_at: string
        }
        Insert: {
          action_type: string
          error?: string | null
          finished_at?: string | null
          group_jid?: string | null
          group_name?: string | null
          id?: string
          performed_by?: string | null
          result?: Json
          send_activity_attempted?: boolean
          started_at?: string
        }
        Update: {
          action_type?: string
          error?: string | null
          finished_at?: string | null
          group_jid?: string | null
          group_name?: string | null
          id?: string
          performed_by?: string | null
          result?: Json
          send_activity_attempted?: boolean
          started_at?: string
        }
        Relationships: []
      }
      group_health_reports: {
        Row: {
          created_at: string
          group_id: string | null
          group_jid: string | null
          group_name: string | null
          id: string
          report: Json
        }
        Insert: {
          created_at?: string
          group_id?: string | null
          group_jid?: string | null
          group_name?: string | null
          id?: string
          report?: Json
        }
        Update: {
          created_at?: string
          group_id?: string | null
          group_jid?: string | null
          group_name?: string | null
          id?: string
          report?: Json
        }
        Relationships: []
      }
      integration_settings: {
        Row: {
          id: string
          key: string
          last_synced_at: string | null
          updated_at: string
          updated_by: string | null
          value: string
        }
        Insert: {
          id?: string
          key: string
          last_synced_at?: string | null
          updated_at?: string
          updated_by?: string | null
          value?: string
        }
        Update: {
          id?: string
          key?: string
          last_synced_at?: string | null
          updated_at?: string
          updated_by?: string | null
          value?: string
        }
        Relationships: []
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          last_synced_at: string | null
          status: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          last_synced_at?: string | null
          status?: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          last_synced_at?: string | null
          status?: string
          token?: string
        }
        Relationships: []
      }
      knowledge_chunks: {
        Row: {
          chunk_index: number
          chunk_text: string
          created_at: string
          file_id: string
          id: string
          search_vector: unknown
          token_count: number | null
        }
        Insert: {
          chunk_index: number
          chunk_text: string
          created_at?: string
          file_id: string
          id?: string
          search_vector?: unknown
          token_count?: number | null
        }
        Update: {
          chunk_index?: number
          chunk_text?: string
          created_at?: string
          file_id?: string
          id?: string
          search_vector?: unknown
          token_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_chunks_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "knowledge_files"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_files: {
        Row: {
          collection: string
          created_at: string
          created_by: string | null
          effective_date: string | null
          expiry_date: string | null
          file_name: string
          id: string
          mode: string
          status: string
          storage_path: string | null
          tags: string[] | null
          title: string
          updated_at: string
          version: number | null
        }
        Insert: {
          collection: string
          created_at?: string
          created_by?: string | null
          effective_date?: string | null
          expiry_date?: string | null
          file_name: string
          id?: string
          mode?: string
          status?: string
          storage_path?: string | null
          tags?: string[] | null
          title: string
          updated_at?: string
          version?: number | null
        }
        Update: {
          collection?: string
          created_at?: string
          created_by?: string | null
          effective_date?: string | null
          expiry_date?: string | null
          file_name?: string
          id?: string
          mode?: string
          status?: string
          storage_path?: string | null
          tags?: string[] | null
          title?: string
          updated_at?: string
          version?: number | null
        }
        Relationships: []
      }
      learning_metrics: {
        Row: {
          agent_id: string | null
          avg_response_time_minutes: number | null
          calls_booked: number | null
          created_at: string
          follow_ups_completed: number | null
          id: string
          lead_type: string | null
          recommendations: Json | null
          sales_closed: number | null
          source: string | null
          stage_movements: number | null
          suggestions_accepted: number | null
          suggestions_rejected: number | null
          total_conversations: number | null
          total_messages_received: number | null
          total_messages_sent: number | null
          week_start: string
        }
        Insert: {
          agent_id?: string | null
          avg_response_time_minutes?: number | null
          calls_booked?: number | null
          created_at?: string
          follow_ups_completed?: number | null
          id?: string
          lead_type?: string | null
          recommendations?: Json | null
          sales_closed?: number | null
          source?: string | null
          stage_movements?: number | null
          suggestions_accepted?: number | null
          suggestions_rejected?: number | null
          total_conversations?: number | null
          total_messages_received?: number | null
          total_messages_sent?: number | null
          week_start: string
        }
        Update: {
          agent_id?: string | null
          avg_response_time_minutes?: number | null
          calls_booked?: number | null
          created_at?: string
          follow_ups_completed?: number | null
          id?: string
          lead_type?: string | null
          recommendations?: Json | null
          sales_closed?: number | null
          source?: string | null
          stage_movements?: number | null
          suggestions_accepted?: number | null
          suggestions_rejected?: number | null
          total_conversations?: number | null
          total_messages_received?: number | null
          total_messages_sent?: number | null
          week_start?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          delivered_at: string | null
          error: string | null
          id: string
          is_outbound: boolean
          last_synced_at: string | null
          message_type: Database["public"]["Enums"]["message_type"]
          provider: string | null
          provider_message_id: string | null
          read_at: string | null
          sent_by: string | null
          status: Database["public"]["Enums"]["message_status"] | null
          status_raw: string | null
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          delivered_at?: string | null
          error?: string | null
          id?: string
          is_outbound?: boolean
          last_synced_at?: string | null
          message_type?: Database["public"]["Enums"]["message_type"]
          provider?: string | null
          provider_message_id?: string | null
          read_at?: string | null
          sent_by?: string | null
          status?: Database["public"]["Enums"]["message_status"] | null
          status_raw?: string | null
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          delivered_at?: string | null
          error?: string | null
          id?: string
          is_outbound?: boolean
          last_synced_at?: string | null
          message_type?: Database["public"]["Enums"]["message_type"]
          provider?: string | null
          provider_message_id?: string | null
          read_at?: string | null
          sent_by?: string | null
          status?: Database["public"]["Enums"]["message_status"] | null
          status_raw?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      missed_inquiries: {
        Row: {
          attempts: Json
          auto_followup_enabled: boolean
          cadence: string
          channel: string
          contact_id: string
          conversation_id: string | null
          created_at: string
          current_step: number
          flagged_at: string
          flagged_reason: string
          id: string
          intent_state: string | null
          last_error: string | null
          last_inbound_at: string | null
          last_inbound_snippet: string | null
          next_send_at: string | null
          send_mode: string
          status: string
          topic: string | null
          updated_at: string
        }
        Insert: {
          attempts?: Json
          auto_followup_enabled?: boolean
          cadence?: string
          channel?: string
          contact_id: string
          conversation_id?: string | null
          created_at?: string
          current_step?: number
          flagged_at?: string
          flagged_reason?: string
          id?: string
          intent_state?: string | null
          last_error?: string | null
          last_inbound_at?: string | null
          last_inbound_snippet?: string | null
          next_send_at?: string | null
          send_mode?: string
          status?: string
          topic?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: Json
          auto_followup_enabled?: boolean
          cadence?: string
          channel?: string
          contact_id?: string
          conversation_id?: string | null
          created_at?: string
          current_step?: number
          flagged_at?: string
          flagged_reason?: string
          id?: string
          intent_state?: string | null
          last_error?: string | null
          last_inbound_at?: string | null
          last_inbound_snippet?: string | null
          next_send_at?: string | null
          send_mode?: string
          status?: string
          topic?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      option_b_audit_log: {
        Row: {
          attempt_outcome: string
          channel: string
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          delivery_status: string
          error_code: string | null
          error_message: string | null
          governance_flags: Json
          id: string
          message_preview: string | null
          message_text: string | null
          operating_mode: string
          phone_normalized: string | null
          provider_message_id: string | null
          reason_allowed: string | null
          safety_checks_passed: Json
          template_id: string | null
          template_label: string | null
          trigger_type: string
        }
        Insert: {
          attempt_outcome?: string
          channel: string
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          delivery_status?: string
          error_code?: string | null
          error_message?: string | null
          governance_flags?: Json
          id?: string
          message_preview?: string | null
          message_text?: string | null
          operating_mode?: string
          phone_normalized?: string | null
          provider_message_id?: string | null
          reason_allowed?: string | null
          safety_checks_passed?: Json
          template_id?: string | null
          template_label?: string | null
          trigger_type: string
        }
        Update: {
          attempt_outcome?: string
          channel?: string
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          delivery_status?: string
          error_code?: string | null
          error_message?: string | null
          governance_flags?: Json
          id?: string
          message_preview?: string | null
          message_text?: string | null
          operating_mode?: string
          phone_normalized?: string | null
          provider_message_id?: string | null
          reason_allowed?: string | null
          safety_checks_passed?: Json
          template_id?: string | null
          template_label?: string | null
          trigger_type?: string
        }
        Relationships: []
      }
      pipeline_stages: {
        Row: {
          color: string | null
          created_at: string
          id: string
          last_synced_at: string | null
          name: string
          stage_order: number
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          last_synced_at?: string | null
          name: string
          stage_order?: number
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          last_synced_at?: string | null
          name?: string
          stage_order?: number
        }
        Relationships: []
      }
      playbooks: {
        Row: {
          approved: boolean | null
          category: string
          content: string
          conversion_count: number | null
          created_at: string
          created_by: string | null
          id: string
          title: string
          updated_at: string
          usage_count: number | null
          version: number | null
        }
        Insert: {
          approved?: boolean | null
          category: string
          content: string
          conversion_count?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          title: string
          updated_at?: string
          usage_count?: number | null
          version?: number | null
        }
        Update: {
          approved?: boolean | null
          category?: string
          content?: string
          conversion_count?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          title?: string
          updated_at?: string
          usage_count?: number | null
          version?: number | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          last_synced_at: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          last_synced_at?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          last_synced_at?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      prospector_damage_audit: {
        Row: {
          contact_id: string
          contact_name: string | null
          contact_phone: string | null
          contact_source: string | null
          conversation_id: string
          created_at: string
          damage_score: string
          dictated_at: string | null
          duplicate_messages: boolean
          duplicate_outbound: number
          first_outbound_snippet: string | null
          had_aplgo_header: boolean
          had_local_number: boolean
          had_proof_url: boolean
          had_shop_link: boolean
          handled_at: string | null
          handled_by: string | null
          id: string
          inbound_total: number
          intent: string
          interest_topic: string | null
          last_inbound_at: string | null
          last_inbound_snippet: string | null
          last_outbound_at: string | null
          last_outbound_snippet: string | null
          manually_sent_at: string | null
          name_confirmed_at: string | null
          name_known: boolean
          outbound_24h: number
          outbound_total: number
          premature_money_push: boolean
          price_leak_detected: boolean
          price_leak_text: string | null
          recommended_action: string | null
          recoverable: boolean
          recovery_angle: string | null
          recovery_draft: string | null
          recovery_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          scanned_at: string
          temperature: string
          updated_at: string
          vanto_step_in: boolean
          vcard_saved_at: string | null
          weak_first_touch: boolean
        }
        Insert: {
          contact_id: string
          contact_name?: string | null
          contact_phone?: string | null
          contact_source?: string | null
          conversation_id: string
          created_at?: string
          damage_score?: string
          dictated_at?: string | null
          duplicate_messages?: boolean
          duplicate_outbound?: number
          first_outbound_snippet?: string | null
          had_aplgo_header?: boolean
          had_local_number?: boolean
          had_proof_url?: boolean
          had_shop_link?: boolean
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          inbound_total?: number
          intent?: string
          interest_topic?: string | null
          last_inbound_at?: string | null
          last_inbound_snippet?: string | null
          last_outbound_at?: string | null
          last_outbound_snippet?: string | null
          manually_sent_at?: string | null
          name_confirmed_at?: string | null
          name_known?: boolean
          outbound_24h?: number
          outbound_total?: number
          premature_money_push?: boolean
          price_leak_detected?: boolean
          price_leak_text?: string | null
          recommended_action?: string | null
          recoverable?: boolean
          recovery_angle?: string | null
          recovery_draft?: string | null
          recovery_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          scanned_at?: string
          temperature?: string
          updated_at?: string
          vanto_step_in?: boolean
          vcard_saved_at?: string | null
          weak_first_touch?: boolean
        }
        Update: {
          contact_id?: string
          contact_name?: string | null
          contact_phone?: string | null
          contact_source?: string | null
          conversation_id?: string
          created_at?: string
          damage_score?: string
          dictated_at?: string | null
          duplicate_messages?: boolean
          duplicate_outbound?: number
          first_outbound_snippet?: string | null
          had_aplgo_header?: boolean
          had_local_number?: boolean
          had_proof_url?: boolean
          had_shop_link?: boolean
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          inbound_total?: number
          intent?: string
          interest_topic?: string | null
          last_inbound_at?: string | null
          last_inbound_snippet?: string | null
          last_outbound_at?: string | null
          last_outbound_snippet?: string | null
          manually_sent_at?: string | null
          name_confirmed_at?: string | null
          name_known?: boolean
          outbound_24h?: number
          outbound_total?: number
          premature_money_push?: boolean
          price_leak_detected?: boolean
          price_leak_text?: string | null
          recommended_action?: string | null
          recoverable?: boolean
          recovery_angle?: string | null
          recovery_draft?: string | null
          recovery_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          scanned_at?: string
          temperature?: string
          updated_at?: string
          vanto_step_in?: boolean
          vcard_saved_at?: string | null
          weak_first_touch?: boolean
        }
        Relationships: []
      }
      scheduled_group_posts: {
        Row: {
          attempt_count: number
          created_at: string
          failure_reason: string | null
          fallback_message: string | null
          id: string
          image_url: string | null
          last_attempt_at: string | null
          message_content: string
          preview_checked_at: string | null
          preview_image_url: string | null
          preview_status: string | null
          provider_message_id: string | null
          scheduled_at: string
          status: string
          target_group_jid: string | null
          target_group_name: string
          user_id: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          failure_reason?: string | null
          fallback_message?: string | null
          id?: string
          image_url?: string | null
          last_attempt_at?: string | null
          message_content: string
          preview_checked_at?: string | null
          preview_image_url?: string | null
          preview_status?: string | null
          provider_message_id?: string | null
          scheduled_at: string
          status?: string
          target_group_jid?: string | null
          target_group_name: string
          user_id: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          failure_reason?: string | null
          fallback_message?: string | null
          id?: string
          image_url?: string | null
          last_attempt_at?: string | null
          message_content?: string
          preview_checked_at?: string | null
          preview_image_url?: string | null
          preview_status?: string | null
          provider_message_id?: string | null
          scheduled_at?: string
          status?: string
          target_group_jid?: string | null
          target_group_name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_group_posts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_runs: {
        Row: {
          errors: string[]
          finished_at: string | null
          id: string
          last_synced_at: string | null
          skipped: number
          source: string
          started_at: string
          synced: number
          total: number
          user_id: string | null
        }
        Insert: {
          errors?: string[]
          finished_at?: string | null
          id?: string
          last_synced_at?: string | null
          skipped?: number
          source: string
          started_at?: string
          synced?: number
          total?: number
          user_id?: string | null
        }
        Update: {
          errors?: string[]
          finished_at?: string | null
          id?: string
          last_synced_at?: string | null
          skipped?: number
          source?: string
          started_at?: string
          synced?: number
          total?: number
          user_id?: string | null
        }
        Relationships: []
      }
      user_ai_settings: {
        Row: {
          api_key_encrypted: string | null
          created_at: string
          is_enabled: boolean
          key_last4: string | null
          model: string | null
          provider: string
          updated_at: string
          user_id: string
        }
        Insert: {
          api_key_encrypted?: string | null
          created_at?: string
          is_enabled?: boolean
          key_last4?: string | null
          model?: string | null
          provider?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          api_key_encrypted?: string | null
          created_at?: string
          is_enabled?: boolean
          key_last4?: string | null
          model?: string | null
          provider?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          last_synced_at: string | null
          role: Database["public"]["Enums"]["user_role"]
          user_id: string
        }
        Insert: {
          id?: string
          last_synced_at?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          user_id: string
        }
        Update: {
          id?: string
          last_synced_at?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          user_id?: string
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          action: string
          attempts: number
          created_at: string
          dead_lettered_at: string | null
          delivered_at: string | null
          direction: string
          error: string | null
          event_type: string | null
          id: string
          last_attempt_at: string | null
          last_status_code: number | null
          last_synced_at: string | null
          max_attempts: number
          next_retry_at: string | null
          payload: Json | null
          source: string
          status: string
        }
        Insert: {
          action: string
          attempts?: number
          created_at?: string
          dead_lettered_at?: string | null
          delivered_at?: string | null
          direction?: string
          error?: string | null
          event_type?: string | null
          id?: string
          last_attempt_at?: string | null
          last_status_code?: number | null
          last_synced_at?: string | null
          max_attempts?: number
          next_retry_at?: string | null
          payload?: Json | null
          source: string
          status?: string
        }
        Update: {
          action?: string
          attempts?: number
          created_at?: string
          dead_lettered_at?: string | null
          delivered_at?: string | null
          direction?: string
          error?: string | null
          event_type?: string | null
          id?: string
          last_attempt_at?: string | null
          last_status_code?: number | null
          last_synced_at?: string | null
          max_attempts?: number
          next_retry_at?: string | null
          payload?: Json | null
          source?: string
          status?: string
        }
        Relationships: []
      }
      webhook_idempotency_keys: {
        Row: {
          action: string
          created_at: string
          id: string
          idempotency_key: string
          payload_hash: string | null
          response: Json | null
          status_code: number | null
          user_identity: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          idempotency_key: string
          payload_hash?: string | null
          response?: Json | null
          status_code?: number | null
          user_identity?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          payload_hash?: string | null
          response?: Json | null
          status_code?: number | null
          user_identity?: string | null
        }
        Relationships: []
      }
      whatsapp_group_members: {
        Row: {
          classification: string | null
          contact_id: string | null
          crm_last_activity_at: string | null
          evidence: Json
          first_seen_at: string
          group_jid: string
          id: string
          last_scanned_at: string
          last_seen_in_group_status: string
          phone_normalized: string
          role: string | null
        }
        Insert: {
          classification?: string | null
          contact_id?: string | null
          crm_last_activity_at?: string | null
          evidence?: Json
          first_seen_at?: string
          group_jid: string
          id?: string
          last_scanned_at?: string
          last_seen_in_group_status?: string
          phone_normalized: string
          role?: string | null
        }
        Update: {
          classification?: string | null
          contact_id?: string | null
          crm_last_activity_at?: string | null
          evidence?: Json
          first_seen_at?: string
          group_jid?: string
          id?: string
          last_scanned_at?: string
          last_seen_in_group_status?: string
          phone_normalized?: string
          role?: string | null
        }
        Relationships: []
      }
      whatsapp_groups: {
        Row: {
          created_at: string
          dedup_at: string | null
          dedup_note: string | null
          duplicate_of: string | null
          group_jid: string | null
          group_name: string
          id: string
          is_active: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          dedup_at?: string | null
          dedup_note?: string | null
          duplicate_of?: string | null
          group_jid?: string | null
          group_name: string
          id?: string
          is_active?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          dedup_at?: string | null
          dedup_note?: string | null
          duplicate_of?: string | null
          group_jid?: string | null
          group_name?: string
          id?: string
          is_active?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_groups_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      workflows: {
        Row: {
          active: boolean
          contact_count: number
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          last_synced_at: string | null
          name: string
          steps: Json
          updated_at: string
        }
        Insert: {
          active?: boolean
          contact_count?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          last_synced_at?: string | null
          name: string
          steps?: Json
          updated_at?: string
        }
        Update: {
          active?: boolean
          contact_count?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          last_synced_at?: string | null
          name?: string
          steps?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflows_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      zazi_actions: {
        Row: {
          action_type: string
          auto_applied: boolean
          confidence: number
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          created_by: string | null
          created_by_label: string
          evidence: Json
          id: string
          message_id: string | null
          phone_normalized: string | null
          proposed_diff: Json
          requires_review: boolean
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          risk_level: string
          status: string
          triage_state: string
          updated_at: string
        }
        Insert: {
          action_type: string
          auto_applied?: boolean
          confidence?: number
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          created_by_label?: string
          evidence?: Json
          id?: string
          message_id?: string | null
          phone_normalized?: string | null
          proposed_diff?: Json
          requires_review?: boolean
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_level?: string
          status?: string
          triage_state?: string
          updated_at?: string
        }
        Update: {
          action_type?: string
          auto_applied?: boolean
          confidence?: number
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          created_by_label?: string
          evidence?: Json
          id?: string
          message_id?: string | null
          phone_normalized?: string | null
          proposed_diff?: Json
          requires_review?: boolean
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_level?: string
          status?: string
          triage_state?: string
          updated_at?: string
        }
        Relationships: []
      }
      zazi_sync_jobs: {
        Row: {
          attempts: number
          created_at: string
          entity_id: string | null
          entity_type: string
          error: string | null
          finished_at: string | null
          id: string
          payload: Json | null
          response_body_snippet: string | null
          response_code: number | null
          status: string
          user_id: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          entity_id?: string | null
          entity_type: string
          error?: string | null
          finished_at?: string | null
          id?: string
          payload?: Json | null
          response_body_snippet?: string | null
          response_code?: number | null
          status?: string
          user_id?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          payload?: Json | null
          response_body_snippet?: string | null
          response_code?: number | null
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      disable_april_flash_sale_rule: { Args: never; Returns: undefined }
      get_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["user_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin_or_super_admin: { Args: never; Returns: boolean }
      search_knowledge: {
        Args: {
          collection_filter?: string
          max_results?: number
          query_text: string
        }
        Returns: {
          chunk_id: string
          chunk_index: number
          chunk_text: string
          file_collection: string
          file_id: string
          file_title: string
          relevance: number
        }[]
      }
    }
    Enums: {
      comm_status: "active" | "closed" | "pending"
      interest_level: "high" | "medium" | "low"
      lead_temperature: "hot" | "warm" | "cold"
      lead_type: "prospect" | "registered" | "buyer" | "vip" | "expired"
      message_status: "sent" | "delivered" | "read" | "queued" | "failed"
      message_type: "text" | "image" | "ai"
      trainer_priority: "advisory" | "strong" | "override"
      user_role: "agent" | "admin" | "super_admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      comm_status: ["active", "closed", "pending"],
      interest_level: ["high", "medium", "low"],
      lead_temperature: ["hot", "warm", "cold"],
      lead_type: ["prospect", "registered", "buyer", "vip", "expired"],
      message_status: ["sent", "delivered", "read", "queued", "failed"],
      message_type: ["text", "image", "ai"],
      trainer_priority: ["advisory", "strong", "override"],
      user_role: ["agent", "admin", "super_admin"],
    },
  },
} as const
