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
          last_message: string | null
          last_message_at: string | null
          last_synced_at: string | null
          status: Database["public"]["Enums"]["comm_status"]
          unread_count: number
          updated_at: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          id?: string
          last_message?: string | null
          last_message_at?: string | null
          last_synced_at?: string | null
          status?: Database["public"]["Enums"]["comm_status"]
          unread_count?: number
          updated_at?: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          id?: string
          last_message?: string | null
          last_message_at?: string | null
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
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          is_outbound: boolean
          last_synced_at: string | null
          message_type: Database["public"]["Enums"]["message_type"]
          sent_by: string | null
          status: Database["public"]["Enums"]["message_status"] | null
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          is_outbound?: boolean
          last_synced_at?: string | null
          message_type?: Database["public"]["Enums"]["message_type"]
          sent_by?: string | null
          status?: Database["public"]["Enums"]["message_status"] | null
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          is_outbound?: boolean
          last_synced_at?: string | null
          message_type?: Database["public"]["Enums"]["message_type"]
          sent_by?: string | null
          status?: Database["public"]["Enums"]["message_status"] | null
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
    }
    Enums: {
      comm_status: "active" | "closed" | "pending"
      interest_level: "high" | "medium" | "low"
      lead_temperature: "hot" | "warm" | "cold"
      lead_type: "prospect" | "registered" | "buyer" | "vip"
      message_status: "sent" | "delivered" | "read"
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
      lead_type: ["prospect", "registered", "buyer", "vip"],
      message_status: ["sent", "delivered", "read"],
      message_type: ["text", "image", "ai"],
      user_role: ["agent", "admin", "super_admin"],
    },
  },
} as const
