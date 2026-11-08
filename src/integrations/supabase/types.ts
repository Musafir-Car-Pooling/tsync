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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          data: Json
          id: string
        }
        Insert: {
          data?: Json
          id: string
        }
        Update: {
          data?: Json
          id?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          at: number
          chat_id: string
          delivered_at: number | null
          from_id: string
          id: string
          read_at: number | null
          text: string
        }
        Insert: {
          at: number
          chat_id: string
          delivered_at?: number | null
          from_id: string
          id?: string
          read_at?: number | null
          text: string
        }
        Update: {
          at?: number
          chat_id?: string
          delivered_at?: number | null
          from_id?: string
          id?: string
          read_at?: number | null
          text?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          data: Json
          id: string
        }
        Insert: {
          data?: Json
          id: string
        }
        Update: {
          data?: Json
          id?: string
        }
        Relationships: []
      }
      interests: {
        Row: {
          data: Json
          id: string
          post_id: string
        }
        Insert: {
          data?: Json
          id: string
          post_id: string
        }
        Update: {
          data?: Json
          id?: string
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "interests_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          active: boolean
          created_at: string
          data: Json
          id: string
          owner_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          data?: Json
          id: string
          owner_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          data?: Json
          id?: string
          owner_id?: string
        }
        Relationships: []
      }
      private_phones: {
        Row: {
          id: string
          phone: string
        }
        Insert: {
          id: string
          phone?: string
        }
        Update: {
          id?: string
          phone?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active: boolean
          created_at: string
          data: Json
          hide_phone: boolean
          id: string
          verified: boolean
        }
        Insert: {
          active?: boolean
          created_at?: string
          data?: Json
          hide_phone?: boolean
          id: string
          verified?: boolean
        }
        Update: {
          active?: boolean
          created_at?: string
          data?: Json
          hide_phone?: boolean
          id?: string
          verified?: boolean
        }
        Relationships: []
      }
      push_tokens: {
        Row: {
          id: string
          token: string
          updated_at: number
          user_id: string
        }
        Insert: {
          id: string
          token: string
          updated_at: number
          user_id: string
        }
        Update: {
          id?: string
          token?: string
          updated_at?: number
          user_id?: string
        }
        Relationships: []
      }
      reviews: {
        Row: {
          data: Json
          id: string
          rating: number
          reviewer_id: string
          target_id: string
          text: string
        }
        Insert: {
          data?: Json
          id: string
          rating: number
          reviewer_id: string
          target_id: string
          text?: string
        }
        Update: {
          data?: Json
          id?: string
          rating?: number
          reviewer_id?: string
          target_id?: string
          text?: string
        }
        Relationships: []
      }
      unlocks: {
        Row: {
          created_at: string
          data: Json
          id: string
          interest_id: string
          kind: string
          post_id: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          data?: Json
          id: string
          interest_id: string
          kind?: string
          post_id: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          interest_id?: string
          kind?: string
          post_id?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      chat_member: { Args: { _cid: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_unlocked: { Args: { _a: string; _b: string }; Returns: boolean }
      post_active: { Args: { _pid: string }; Returns: boolean }
      post_owner: { Args: { _pid: string }; Returns: string }
      setting_flag: { Args: { _key: string }; Returns: boolean }
      valid_pay_proof: {
        Args: {
          _id: string
          _interest: string
          _post: string
          _status: string
          _user: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["admin", "user"],
    },
  },
} as const
