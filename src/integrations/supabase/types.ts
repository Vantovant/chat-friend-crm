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
          created_at: string
          created_by: string | null
          deleted_at: string | null
          email: string | null
          id: string
          interest: Database["public"]["Enums"]["interest_level"]
          is_deleted: boolean
          last_synced_at: string | null
          lead_type: Database["public"]["Enums"]["lead_type"]
          name: string
          notes: string | null
          phone: string
          phone_normalized: string | null
          phone_raw: string | null
          stage_id: string | null
          tags: string[] | null
          temperature: Database["public"]["Enums"]["lead_temperature"]
          updated_at: string
          whatsapp_id: string | null
        }
        Insert: {
          assigned_to?: string | null
          avatar_url?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          email?: string | null
          id?: string
          interest?: Database["public"]["Enums"]["interest_level"]
          is_deleted?: boolean
          last_synced_at?: string | null
          lead_type?: Database["public"]["Enums"]["lead_type"]
          name: string
          notes?: string | null
          phone: string
          phone_normalized?: string | null
          phone_raw?: string | null
          stage_id?: string | null
          tags?: string[] | null
          temperature?: Database["public"]["Enums"]["lead_temperature"]
          updated_at?: string
          whatsapp_id?: string | null
        }
        Update: {
          assigned_to?: string | null
          avatar_url?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          email?: string | null
          id?: string
          interest?: Database["public"]["Enums"]["interest_level"]
          is_deleted?: boolean
          last_synced_at?: string | null
          lead_type?: Database["public"]["Enums"]["lead_type"]
          name?: string
          notes?: string | null
          phone?: string
          phone_normalized?: string | null
          phone_raw?: string | null
          stage_id?: string | null
          tags?: string[] | null
          temperature?: Database["public"]["Enums"]["lead_temperature"]
          updated_at?: string
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
      scheduled_group_posts: {
        Row: {
          attempt_count: number
          created_at: string
          failure_reason: string | null
          id: string
          image_url: string | null
          last_attempt_at: string | null
          message_content: string
          scheduled_at: string
          status: string
          target_group_name: string
          user_id: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          failure_reason?: string | null
          id?: string
          image_url?: string | null
          last_attempt_at?: string | null
          message_content: string
          scheduled_at: string
          status?: string
          target_group_name: string
          user_id: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          failure_reason?: string | null
          id?: string
          image_url?: string | null
          last_attempt_at?: string | null
          message_content?: string
          scheduled_at?: string
          status?: string
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
          created_at: string
          error: string | null
          id: string
          last_synced_at: string | null
          payload: Json | null
          source: string
          status: string
        }
        Insert: {
          action: string
          created_at?: string
          error?: string | null
          id?: string
          last_synced_at?: string | null
          payload?: Json | null
          source: string
          status?: string
        }
        Update: {
          action?: string
          created_at?: string
          error?: string | null
          id?: string
          last_synced_at?: string | null
          payload?: Json | null
          source?: string
          status?: string
        }
        Relationships: []
      }
      whatsapp_groups: {
        Row: {
          created_at: string
          group_jid: string | null
          group_name: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          group_jid?: string | null
          group_name: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          group_jid?: string | null
          group_name?: string
          id?: string
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
      user_role: ["agent", "admin", "super_admin"],
    },
  },
} as const
