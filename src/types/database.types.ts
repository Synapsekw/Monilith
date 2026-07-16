export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string;
          actor_id: string;
          actor_kind: string;
          created_at: string;
          id: string;
          metadata: Json;
          org_id: string | null;
          target_email: string | null;
          target_user_id: string | null;
        };
        Insert: {
          action: string;
          actor_id: string;
          actor_kind: string;
          created_at?: string;
          id?: string;
          metadata?: Json;
          org_id?: string | null;
          target_email?: string | null;
          target_user_id?: string | null;
        };
        Update: {
          action?: string;
          actor_id?: string;
          actor_kind?: string;
          created_at?: string;
          id?: string;
          metadata?: Json;
          org_id?: string | null;
          target_email?: string | null;
          target_user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_conversations: {
        Row: {
          created_at: string;
          id: string;
          org_id: string;
          summarized_upto: string | null;
          summary: string | null;
          title: string;
          updated_at: string;
          user_id: string;
          workspace_id: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          org_id: string;
          summarized_upto?: string | null;
          summary?: string | null;
          title?: string;
          updated_at?: string;
          user_id: string;
          workspace_id?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          org_id?: string;
          summarized_upto?: string | null;
          summary?: string | null;
          title?: string;
          updated_at?: string;
          user_id?: string;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "ai_conversations_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_conversations_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_messages: {
        Row: {
          content: string;
          conversation_id: string;
          created_at: string;
          id: string;
          role: string;
          tool_trace: Json | null;
        };
        Insert: {
          content: string;
          conversation_id: string;
          created_at?: string;
          id?: string;
          role: string;
          tool_trace?: Json | null;
        };
        Update: {
          content?: string;
          conversation_id?: string;
          created_at?: string;
          id?: string;
          role?: string;
          tool_trace?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "ai_messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "ai_conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_usage: {
        Row: {
          cost_usd: number;
          created_at: string;
          credits: number;
          feature: string;
          id: string;
          input_tokens: number;
          model: string | null;
          org_id: string;
          output_tokens: number;
          provider: string | null;
          user_id: string | null;
        };
        Insert: {
          cost_usd?: number;
          created_at?: string;
          credits?: number;
          feature: string;
          id?: string;
          input_tokens?: number;
          model?: string | null;
          org_id: string;
          output_tokens?: number;
          provider?: string | null;
          user_id?: string | null;
        };
        Update: {
          cost_usd?: number;
          created_at?: string;
          credits?: number;
          feature?: string;
          id?: string;
          input_tokens?: number;
          model?: string | null;
          org_id?: string;
          output_tokens?: number;
          provider?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "ai_usage_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      attachments: {
        Row: {
          board_id: string;
          column_id: string | null;
          created_at: string;
          file_name: string;
          id: string;
          item_id: string | null;
          mime_type: string;
          org_id: string;
          size_bytes: number;
          storage_path: string;
          update_id: string | null;
          uploaded_by: string;
        };
        Insert: {
          board_id: string;
          column_id?: string | null;
          created_at?: string;
          file_name: string;
          id?: string;
          item_id?: string | null;
          mime_type: string;
          org_id: string;
          size_bytes: number;
          storage_path: string;
          update_id?: string | null;
          uploaded_by: string;
        };
        Update: {
          board_id?: string;
          column_id?: string | null;
          created_at?: string;
          file_name?: string;
          id?: string;
          item_id?: string | null;
          mime_type?: string;
          org_id?: string;
          size_bytes?: number;
          storage_path?: string;
          update_id?: string | null;
          uploaded_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "attachments_board_id_fkey";
            columns: ["board_id"];
            isOneToOne: false;
            referencedRelation: "boards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attachments_column_id_fkey";
            columns: ["column_id"];
            isOneToOne: false;
            referencedRelation: "columns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attachments_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attachments_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attachments_update_id_fkey";
            columns: ["update_id"];
            isOneToOne: false;
            referencedRelation: "item_updates";
            referencedColumns: ["id"];
          },
        ];
      };
      auth_rate_limits: {
        Row: {
          bucket_key: string;
          count: number;
          window_start: string;
        };
        Insert: {
          bucket_key: string;
          count?: number;
          window_start?: string;
        };
        Update: {
          bucket_key?: string;
          count?: number;
          window_start?: string;
        };
        Relationships: [];
      };
      automation_date_fires: {
        Row: {
          automation_id: string;
          fire_date: string;
          fired_at: string;
          item_id: string;
          org_id: string;
        };
        Insert: {
          automation_id: string;
          fire_date: string;
          fired_at?: string;
          item_id: string;
          org_id: string;
        };
        Update: {
          automation_id?: string;
          fire_date?: string;
          fired_at?: string;
          item_id?: string;
          org_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "automation_date_fires_automation_id_fkey";
            columns: ["automation_id"];
            isOneToOne: false;
            referencedRelation: "automations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "automation_date_fires_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "automation_date_fires_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      automation_runs: {
        Row: {
          actions: Json;
          automation_id: string;
          board_id: string;
          created_at: string;
          error: string | null;
          id: string;
          item_id: string | null;
          org_id: string;
          status: string;
          trigger_type: string;
        };
        Insert: {
          actions?: Json;
          automation_id: string;
          board_id: string;
          created_at?: string;
          error?: string | null;
          id?: string;
          item_id?: string | null;
          org_id: string;
          status: string;
          trigger_type: string;
        };
        Update: {
          actions?: Json;
          automation_id?: string;
          board_id?: string;
          created_at?: string;
          error?: string | null;
          id?: string;
          item_id?: string | null;
          org_id?: string;
          status?: string;
          trigger_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "automation_runs_automation_id_fkey";
            columns: ["automation_id"];
            isOneToOne: false;
            referencedRelation: "automations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "automation_runs_board_id_fkey";
            columns: ["board_id"];
            isOneToOne: false;
            referencedRelation: "boards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "automation_runs_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "automation_runs_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      automation_webhook_deliveries: {
        Row: {
          action_index: number;
          created_at: string;
          org_id: string;
          request_id: number;
          run_id: string;
          status: string;
        };
        Insert: {
          action_index: number;
          created_at?: string;
          org_id: string;
          request_id: number;
          run_id: string;
          status?: string;
        };
        Update: {
          action_index?: number;
          created_at?: string;
          org_id?: string;
          request_id?: number;
          run_id?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "automation_webhook_deliveries_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "automation_webhook_deliveries_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "automation_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      automations: {
        Row: {
          actions: Json;
          board_id: string;
          condition: Json | null;
          created_at: string;
          created_by: string | null;
          enabled: boolean;
          id: string;
          name: string | null;
          org_id: string;
          position: number;
          trigger: Json;
          updated_at: string;
        };
        Insert: {
          actions?: Json;
          board_id: string;
          condition?: Json | null;
          created_at?: string;
          created_by?: string | null;
          enabled?: boolean;
          id?: string;
          name?: string | null;
          org_id: string;
          position?: number;
          trigger: Json;
          updated_at?: string;
        };
        Update: {
          actions?: Json;
          board_id?: string;
          condition?: Json | null;
          created_at?: string;
          created_by?: string | null;
          enabled?: boolean;
          id?: string;
          name?: string | null;
          org_id?: string;
          position?: number;
          trigger?: Json;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "automations_board_id_fkey";
            columns: ["board_id"];
            isOneToOne: false;
            referencedRelation: "boards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "automations_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      board_members: {
        Row: {
          access_level: Database["public"]["Enums"]["board_access"];
          board_id: string;
          created_at: string;
          granted_by: string;
          org_id: string;
          user_id: string;
        };
        Insert: {
          access_level?: Database["public"]["Enums"]["board_access"];
          board_id: string;
          created_at?: string;
          granted_by: string;
          org_id: string;
          user_id: string;
        };
        Update: {
          access_level?: Database["public"]["Enums"]["board_access"];
          board_id?: string;
          created_at?: string;
          granted_by?: string;
          org_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "board_members_board_id_fkey";
            columns: ["board_id"];
            isOneToOne: false;
            referencedRelation: "boards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "board_members_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      board_views: {
        Row: {
          board_id: string;
          config: Json;
          created_at: string;
          id: string;
          kind: Database["public"]["Enums"]["view_kind"];
          name: string;
          org_id: string;
          position: number;
          updated_at: string;
        };
        Insert: {
          board_id: string;
          config?: Json;
          created_at?: string;
          id?: string;
          kind: Database["public"]["Enums"]["view_kind"];
          name: string;
          org_id: string;
          position?: number;
          updated_at?: string;
        };
        Update: {
          board_id?: string;
          config?: Json;
          created_at?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["view_kind"];
          name?: string;
          org_id?: string;
          position?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "board_views_board_id_fkey";
            columns: ["board_id"];
            isOneToOne: false;
            referencedRelation: "boards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "board_views_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      boards: {
        Row: {
          archived_at: string | null;
          archived_by: string | null;
          created_at: string;
          created_by: string;
          description: string | null;
          id: string;
          name: string;
          name_column_width: number | null;
          org_id: string;
          position: number;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          archived_at?: string | null;
          archived_by?: string | null;
          created_at?: string;
          created_by: string;
          description?: string | null;
          id?: string;
          name: string;
          name_column_width?: number | null;
          org_id: string;
          position?: number;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          archived_at?: string | null;
          archived_by?: string | null;
          created_at?: string;
          created_by?: string;
          description?: string | null;
          id?: string;
          name?: string;
          name_column_width?: number | null;
          org_id?: string;
          position?: number;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "boards_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "boards_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      cell_values: {
        Row: {
          board_id: string;
          column_id: string;
          item_id: string;
          org_id: string;
          updated_at: string;
          value: Json;
        };
        Insert: {
          board_id: string;
          column_id: string;
          item_id: string;
          org_id: string;
          updated_at?: string;
          value: Json;
        };
        Update: {
          board_id?: string;
          column_id?: string;
          item_id?: string;
          org_id?: string;
          updated_at?: string;
          value?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "cell_values_board_id_fkey";
            columns: ["board_id"];
            isOneToOne: false;
            referencedRelation: "boards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cell_values_column_id_fkey";
            columns: ["column_id"];
            isOneToOne: false;
            referencedRelation: "columns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cell_values_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cell_values_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      columns: {
        Row: {
          board_id: string;
          created_at: string;
          id: string;
          kind: Database["public"]["Enums"]["column_kind"];
          name: string;
          org_id: string;
          position: number;
          settings: Json;
          updated_at: string;
          width: number | null;
        };
        Insert: {
          board_id: string;
          created_at?: string;
          id?: string;
          kind: Database["public"]["Enums"]["column_kind"];
          name: string;
          org_id: string;
          position?: number;
          settings?: Json;
          updated_at?: string;
          width?: number | null;
        };
        Update: {
          board_id?: string;
          created_at?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["column_kind"];
          name?: string;
          org_id?: string;
          position?: number;
          settings?: Json;
          updated_at?: string;
          width?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "columns_board_id_fkey";
            columns: ["board_id"];
            isOneToOne: false;
            referencedRelation: "boards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "columns_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      dashboard_widgets: {
        Row: {
          config: Json;
          created_at: string;
          dashboard_id: string;
          id: string;
          kind: Database["public"]["Enums"]["widget_kind"];
          layout: Json;
          org_id: string;
          position: number;
          source_board_id: string | null;
          title: string;
          updated_at: string;
        };
        Insert: {
          config?: Json;
          created_at?: string;
          dashboard_id: string;
          id?: string;
          kind: Database["public"]["Enums"]["widget_kind"];
          layout?: Json;
          org_id: string;
          position?: number;
          source_board_id?: string | null;
          title?: string;
          updated_at?: string;
        };
        Update: {
          config?: Json;
          created_at?: string;
          dashboard_id?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["widget_kind"];
          layout?: Json;
          org_id?: string;
          position?: number;
          source_board_id?: string | null;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "dashboard_widgets_dashboard_id_fkey";
            columns: ["dashboard_id"];
            isOneToOne: false;
            referencedRelation: "dashboards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dashboard_widgets_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dashboard_widgets_source_board_id_fkey";
            columns: ["source_board_id"];
            isOneToOne: false;
            referencedRelation: "boards";
            referencedColumns: ["id"];
          },
        ];
      };
      dashboards: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          name: string;
          org_id: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          id?: string;
          name: string;
          org_id: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          name?: string;
          org_id?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "dashboards_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dashboards_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      digest_runs: {
        Row: {
          completed_at: string | null;
          created_at: string;
          email_sent_count: number | null;
          error: string | null;
          id: string;
          org_id: string;
          period_end: string;
          period_start: string;
          stats: Json | null;
          status: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          email_sent_count?: number | null;
          error?: string | null;
          id?: string;
          org_id: string;
          period_end: string;
          period_start: string;
          stats?: Json | null;
          status?: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          email_sent_count?: number | null;
          error?: string | null;
          id?: string;
          org_id?: string;
          period_end?: string;
          period_start?: string;
          stats?: Json | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "digest_runs_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      feedback: {
        Row: {
          admin_response: string | null;
          body: string;
          created_at: string;
          id: string;
          kind: string;
          org_id: string;
          responded_at: string | null;
          responded_by: string | null;
          status: string;
          submitted_by: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          admin_response?: string | null;
          body: string;
          created_at?: string;
          id?: string;
          kind: string;
          org_id: string;
          responded_at?: string | null;
          responded_by?: string | null;
          status?: string;
          submitted_by: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          admin_response?: string | null;
          body?: string;
          created_at?: string;
          id?: string;
          kind?: string;
          org_id?: string;
          responded_at?: string | null;
          responded_by?: string | null;
          status?: string;
          submitted_by?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "feedback_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      goal_links: {
        Row: {
          board_id: string;
          created_at: string;
          done_column_id: string | null;
          done_option_ids: Json;
          goal_id: string;
          id: string;
          org_id: string;
        };
        Insert: {
          board_id: string;
          created_at?: string;
          done_column_id?: string | null;
          done_option_ids?: Json;
          goal_id: string;
          id?: string;
          org_id: string;
        };
        Update: {
          board_id?: string;
          created_at?: string;
          done_column_id?: string | null;
          done_option_ids?: Json;
          goal_id?: string;
          id?: string;
          org_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "goal_links_board_id_fkey";
            columns: ["board_id"];
            isOneToOne: false;
            referencedRelation: "boards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "goal_links_done_column_id_fkey";
            columns: ["done_column_id"];
            isOneToOne: false;
            referencedRelation: "columns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "goal_links_goal_id_fkey";
            columns: ["goal_id"];
            isOneToOne: false;
            referencedRelation: "goals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "goal_links_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      goals: {
        Row: {
          created_at: string;
          created_by: string;
          current_value: number | null;
          description: string | null;
          due_date: string | null;
          id: string;
          name: string;
          org_id: string;
          owner_id: string;
          parent_goal_id: string | null;
          percent: number | null;
          position: number;
          progress_mode: Database["public"]["Enums"]["goal_progress_mode"];
          start_date: string | null;
          start_value: number | null;
          status: Database["public"]["Enums"]["goal_status"];
          target_value: number | null;
          unit: string | null;
          updated_at: string;
          workspace_id: string | null;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          current_value?: number | null;
          description?: string | null;
          due_date?: string | null;
          id?: string;
          name: string;
          org_id: string;
          owner_id: string;
          parent_goal_id?: string | null;
          percent?: number | null;
          position?: number;
          progress_mode: Database["public"]["Enums"]["goal_progress_mode"];
          start_date?: string | null;
          start_value?: number | null;
          status?: Database["public"]["Enums"]["goal_status"];
          target_value?: number | null;
          unit?: string | null;
          updated_at?: string;
          workspace_id?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          current_value?: number | null;
          description?: string | null;
          due_date?: string | null;
          id?: string;
          name?: string;
          org_id?: string;
          owner_id?: string;
          parent_goal_id?: string | null;
          percent?: number | null;
          position?: number;
          progress_mode?: Database["public"]["Enums"]["goal_progress_mode"];
          start_date?: string | null;
          start_value?: number | null;
          status?: Database["public"]["Enums"]["goal_status"];
          target_value?: number | null;
          unit?: string | null;
          updated_at?: string;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "goals_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "goals_parent_goal_id_fkey";
            columns: ["parent_goal_id"];
            isOneToOne: false;
            referencedRelation: "goals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "goals_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      groups: {
        Row: {
          archived_at: string | null;
          archived_by: string | null;
          board_id: string;
          color: string;
          created_at: string;
          id: string;
          name: string;
          org_id: string;
          position: number;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          archived_by?: string | null;
          board_id: string;
          color?: string;
          created_at?: string;
          id?: string;
          name: string;
          org_id: string;
          position?: number;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          archived_by?: string | null;
          board_id?: string;
          color?: string;
          created_at?: string;
          id?: string;
          name?: string;
          org_id?: string;
          position?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "groups_board_id_fkey";
            columns: ["board_id"];
            isOneToOne: false;
            referencedRelation: "boards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "groups_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      item_activities: {
        Row: {
          action: Database["public"]["Enums"]["activity_action"];
          actor_id: string | null;
          board_id: string;
          column_id: string | null;
          created_at: string;
          id: string;
          item_id: string;
          new_value: Json | null;
          old_value: Json | null;
          org_id: string;
        };
        Insert: {
          action: Database["public"]["Enums"]["activity_action"];
          actor_id?: string | null;
          board_id: string;
          column_id?: string | null;
          created_at?: string;
          id?: string;
          item_id: string;
          new_value?: Json | null;
          old_value?: Json | null;
          org_id: string;
        };
        Update: {
          action?: Database["public"]["Enums"]["activity_action"];
          actor_id?: string | null;
          board_id?: string;
          column_id?: string | null;
          created_at?: string;
          id?: string;
          item_id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          org_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "item_activities_board_id_fkey";
            columns: ["board_id"];
            isOneToOne: false;
            referencedRelation: "boards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "item_activities_column_id_fkey";
            columns: ["column_id"];
            isOneToOne: false;
            referencedRelation: "columns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "item_activities_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "item_activities_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      item_dependencies: {
        Row: {
          board_id: string;
          created_at: string;
          id: string;
          org_id: string;
          predecessor_id: string;
          successor_id: string;
          type: string;
        };
        Insert: {
          board_id: string;
          created_at?: string;
          id?: string;
          org_id: string;
          predecessor_id: string;
          successor_id: string;
          type?: string;
        };
        Update: {
          board_id?: string;
          created_at?: string;
          id?: string;
          org_id?: string;
          predecessor_id?: string;
          successor_id?: string;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "item_dependencies_board_id_fkey";
            columns: ["board_id"];
            isOneToOne: false;
            referencedRelation: "boards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "item_dependencies_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "item_dependencies_predecessor_id_fkey";
            columns: ["predecessor_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "item_dependencies_successor_id_fkey";
            columns: ["successor_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
        ];
      };
      item_updates: {
        Row: {
          author_id: string;
          board_id: string;
          body: Json;
          body_text: string;
          created_at: string;
          edited_at: string | null;
          id: string;
          item_id: string;
          org_id: string;
          updated_at: string;
        };
        Insert: {
          author_id: string;
          board_id: string;
          body: Json;
          body_text?: string;
          created_at?: string;
          edited_at?: string | null;
          id?: string;
          item_id: string;
          org_id: string;
          updated_at?: string;
        };
        Update: {
          author_id?: string;
          board_id?: string;
          body?: Json;
          body_text?: string;
          created_at?: string;
          edited_at?: string | null;
          id?: string;
          item_id?: string;
          org_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "item_updates_board_id_fkey";
            columns: ["board_id"];
            isOneToOne: false;
            referencedRelation: "boards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "item_updates_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "item_updates_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      items: {
        Row: {
          archived_at: string | null;
          archived_by: string | null;
          board_id: string;
          created_at: string;
          created_by: string;
          group_id: string;
          id: string;
          name: string;
          org_id: string;
          parent_id: string | null;
          position: number;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          archived_by?: string | null;
          board_id: string;
          created_at?: string;
          created_by?: string;
          group_id: string;
          id?: string;
          name: string;
          org_id: string;
          parent_id?: string | null;
          position?: number;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          archived_by?: string | null;
          board_id?: string;
          created_at?: string;
          created_by?: string;
          group_id?: string;
          id?: string;
          name?: string;
          org_id?: string;
          parent_id?: string | null;
          position?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "items_board_id_fkey";
            columns: ["board_id"];
            isOneToOne: false;
            referencedRelation: "boards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "items_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "items_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "items_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
        ];
      };
      member_capacity: {
        Row: {
          created_at: string;
          created_by: string;
          hours_per_day: number;
          id: string;
          org_id: string;
          updated_at: string;
          user_id: string;
          working_days: number[];
        };
        Insert: {
          created_at?: string;
          created_by: string;
          hours_per_day?: number;
          id?: string;
          org_id: string;
          updated_at?: string;
          user_id: string;
          working_days?: number[];
        };
        Update: {
          created_at?: string;
          created_by?: string;
          hours_per_day?: number;
          id?: string;
          org_id?: string;
          updated_at?: string;
          user_id?: string;
          working_days?: number[];
        };
        Relationships: [
          {
            foreignKeyName: "member_capacity_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      notification_preferences: {
        Row: {
          channel: Database["public"]["Enums"]["notification_channel"];
          created_at: string;
          enabled: boolean;
          kind: Database["public"]["Enums"]["notification_kind"];
          user_id: string;
        };
        Insert: {
          channel: Database["public"]["Enums"]["notification_channel"];
          created_at?: string;
          enabled?: boolean;
          kind: Database["public"]["Enums"]["notification_kind"];
          user_id: string;
        };
        Update: {
          channel?: Database["public"]["Enums"]["notification_channel"];
          created_at?: string;
          enabled?: boolean;
          kind?: Database["public"]["Enums"]["notification_kind"];
          user_id?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          actor_id: string | null;
          automation_id: string | null;
          board_id: string | null;
          created_at: string;
          feedback_id: string | null;
          id: string;
          item_id: string | null;
          kind: Database["public"]["Enums"]["notification_kind"];
          org_id: string;
          payload: Json | null;
          read_at: string | null;
          recipient_id: string;
          update_id: string | null;
        };
        Insert: {
          actor_id?: string | null;
          automation_id?: string | null;
          board_id?: string | null;
          created_at?: string;
          feedback_id?: string | null;
          id?: string;
          item_id?: string | null;
          kind: Database["public"]["Enums"]["notification_kind"];
          org_id: string;
          payload?: Json | null;
          read_at?: string | null;
          recipient_id: string;
          update_id?: string | null;
        };
        Update: {
          actor_id?: string | null;
          automation_id?: string | null;
          board_id?: string | null;
          created_at?: string;
          feedback_id?: string | null;
          id?: string;
          item_id?: string | null;
          kind?: Database["public"]["Enums"]["notification_kind"];
          org_id?: string;
          payload?: Json | null;
          read_at?: string | null;
          recipient_id?: string;
          update_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_automation_id_fkey";
            columns: ["automation_id"];
            isOneToOne: false;
            referencedRelation: "automations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_board_id_fkey";
            columns: ["board_id"];
            isOneToOne: false;
            referencedRelation: "boards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_feedback_id_fkey";
            columns: ["feedback_id"];
            isOneToOne: false;
            referencedRelation: "feedback";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_update_id_fkey";
            columns: ["update_id"];
            isOneToOne: false;
            referencedRelation: "item_updates";
            referencedColumns: ["id"];
          },
        ];
      };
      org_ai_settings: {
        Row: {
          ai_mode: Database["public"]["Enums"]["ai_mode"];
          byo_key_last4: string | null;
          byo_provider: string | null;
          byo_secret_id: string | null;
          monthly_credit_limit: number;
          org_id: string;
          tier: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          ai_mode?: Database["public"]["Enums"]["ai_mode"];
          byo_key_last4?: string | null;
          byo_provider?: string | null;
          byo_secret_id?: string | null;
          monthly_credit_limit?: number;
          org_id: string;
          tier?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          ai_mode?: Database["public"]["Enums"]["ai_mode"];
          byo_key_last4?: string | null;
          byo_provider?: string | null;
          byo_secret_id?: string | null;
          monthly_credit_limit?: number;
          org_id?: string;
          tier?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "org_ai_settings_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      org_invitations: {
        Row: {
          accepted_at: string | null;
          created_at: string;
          email: string;
          id: string;
          invited_by: string;
          org_id: string;
          role: Database["public"]["Enums"]["org_role"];
          status: string;
        };
        Insert: {
          accepted_at?: string | null;
          created_at?: string;
          email: string;
          id?: string;
          invited_by: string;
          org_id: string;
          role?: Database["public"]["Enums"]["org_role"];
          status?: string;
        };
        Update: {
          accepted_at?: string | null;
          created_at?: string;
          email?: string;
          id?: string;
          invited_by?: string;
          org_id?: string;
          role?: Database["public"]["Enums"]["org_role"];
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "org_invitations_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      org_members: {
        Row: {
          created_at: string;
          deactivated_at: string | null;
          deactivated_by: string | null;
          org_id: string;
          role: Database["public"]["Enums"]["org_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          deactivated_at?: string | null;
          deactivated_by?: string | null;
          org_id: string;
          role?: Database["public"]["Enums"]["org_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          deactivated_at?: string | null;
          deactivated_by?: string | null;
          org_id?: string;
          role?: Database["public"]["Enums"]["org_role"];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "org_members_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      org_workload_settings: {
        Row: {
          default_hours_per_day: number;
          default_per_item_hours: number;
          default_working_days: number[];
          org_id: string;
          updated_at: string;
        };
        Insert: {
          default_hours_per_day?: number;
          default_per_item_hours?: number;
          default_working_days?: number[];
          org_id: string;
          updated_at?: string;
        };
        Update: {
          default_hours_per_day?: number;
          default_per_item_hours?: number;
          default_working_days?: number[];
          org_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "org_workload_settings_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          name: string;
          slug: string;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          id?: string;
          name: string;
          slug: string;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          name?: string;
          slug?: string;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      platform_admins: {
        Row: {
          created_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      portfolio_boards: {
        Row: {
          board_id: string;
          budget: number | null;
          created_at: string;
          done_column_id: string | null;
          done_option_ids: Json;
          health_override:
            | Database["public"]["Enums"]["portfolio_health"]
            | null;
          id: string;
          org_id: string;
          owner_user_id: string | null;
          portfolio_id: string;
          position: number;
          priority: Database["public"]["Enums"]["portfolio_priority"] | null;
          status_note: string | null;
          updated_at: string;
        };
        Insert: {
          board_id: string;
          budget?: number | null;
          created_at?: string;
          done_column_id?: string | null;
          done_option_ids?: Json;
          health_override?:
            | Database["public"]["Enums"]["portfolio_health"]
            | null;
          id?: string;
          org_id: string;
          owner_user_id?: string | null;
          portfolio_id: string;
          position?: number;
          priority?: Database["public"]["Enums"]["portfolio_priority"] | null;
          status_note?: string | null;
          updated_at?: string;
        };
        Update: {
          board_id?: string;
          budget?: number | null;
          created_at?: string;
          done_column_id?: string | null;
          done_option_ids?: Json;
          health_override?:
            | Database["public"]["Enums"]["portfolio_health"]
            | null;
          id?: string;
          org_id?: string;
          owner_user_id?: string | null;
          portfolio_id?: string;
          position?: number;
          priority?: Database["public"]["Enums"]["portfolio_priority"] | null;
          status_note?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "portfolio_boards_board_id_fkey";
            columns: ["board_id"];
            isOneToOne: false;
            referencedRelation: "boards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "portfolio_boards_done_column_id_fkey";
            columns: ["done_column_id"];
            isOneToOne: false;
            referencedRelation: "columns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "portfolio_boards_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "portfolio_boards_portfolio_id_fkey";
            columns: ["portfolio_id"];
            isOneToOne: false;
            referencedRelation: "portfolios";
            referencedColumns: ["id"];
          },
        ];
      };
      portfolios: {
        Row: {
          created_at: string;
          created_by: string;
          description: string | null;
          id: string;
          name: string;
          org_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          description?: string | null;
          id?: string;
          name: string;
          org_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          description?: string | null;
          id?: string;
          name?: string;
          org_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "portfolios_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          email: string | null;
          email_digest_opt_out: boolean;
          full_name: string | null;
          id: string;
          timezone: string | null;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          email?: string | null;
          email_digest_opt_out?: boolean;
          full_name?: string | null;
          id: string;
          timezone?: string | null;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          email?: string | null;
          email_digest_opt_out?: boolean;
          full_name?: string | null;
          id?: string;
          timezone?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      relation_links: {
        Row: {
          board_id: string;
          column_id: string;
          created_at: string;
          id: string;
          item_id: string;
          linked_item_id: string;
          org_id: string;
          position: number;
        };
        Insert: {
          board_id: string;
          column_id: string;
          created_at?: string;
          id?: string;
          item_id: string;
          linked_item_id: string;
          org_id: string;
          position?: number;
        };
        Update: {
          board_id?: string;
          column_id?: string;
          created_at?: string;
          id?: string;
          item_id?: string;
          linked_item_id?: string;
          org_id?: string;
          position?: number;
        };
        Relationships: [
          {
            foreignKeyName: "relation_links_board_id_fkey";
            columns: ["board_id"];
            isOneToOne: false;
            referencedRelation: "boards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "relation_links_column_id_fkey";
            columns: ["column_id"];
            isOneToOne: false;
            referencedRelation: "columns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "relation_links_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "relation_links_linked_item_id_fkey";
            columns: ["linked_item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "relation_links_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      reports: {
        Row: {
          board_id: string;
          config: Json;
          created_at: string;
          created_by: string | null;
          id: string;
          name: string;
          org_id: string;
          updated_at: string;
        };
        Insert: {
          board_id: string;
          config?: Json;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name?: string;
          org_id: string;
          updated_at?: string;
        };
        Update: {
          board_id?: string;
          config?: Json;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name?: string;
          org_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reports_board_id_fkey";
            columns: ["board_id"];
            isOneToOne: false;
            referencedRelation: "boards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reports_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      time_allocations: {
        Row: {
          board_id: string | null;
          category: string | null;
          created_at: string;
          duration_secs: number;
          id: string;
          item_id: string | null;
          note: string | null;
          org_id: string;
          updated_at: string;
          user_id: string;
          work_date: string;
        };
        Insert: {
          board_id?: string | null;
          category?: string | null;
          created_at?: string;
          duration_secs: number;
          id?: string;
          item_id?: string | null;
          note?: string | null;
          org_id: string;
          updated_at?: string;
          user_id: string;
          work_date: string;
        };
        Update: {
          board_id?: string | null;
          category?: string | null;
          created_at?: string;
          duration_secs?: number;
          id?: string;
          item_id?: string | null;
          note?: string | null;
          org_id?: string;
          updated_at?: string;
          user_id?: string;
          work_date?: string;
        };
        Relationships: [
          {
            foreignKeyName: "time_allocations_board_id_fkey";
            columns: ["board_id"];
            isOneToOne: false;
            referencedRelation: "boards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "time_allocations_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "time_allocations_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      time_entries: {
        Row: {
          board_id: string;
          column_id: string;
          created_at: string;
          duration_secs: number | null;
          ended_at: string | null;
          id: string;
          item_id: string;
          org_id: string;
          started_at: string;
          user_id: string;
        };
        Insert: {
          board_id: string;
          column_id: string;
          created_at?: string;
          duration_secs?: number | null;
          ended_at?: string | null;
          id?: string;
          item_id: string;
          org_id: string;
          started_at: string;
          user_id: string;
        };
        Update: {
          board_id?: string;
          column_id?: string;
          created_at?: string;
          duration_secs?: number | null;
          ended_at?: string | null;
          id?: string;
          item_id?: string;
          org_id?: string;
          started_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "time_entries_board_id_fkey";
            columns: ["board_id"];
            isOneToOne: false;
            referencedRelation: "boards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "time_entries_column_id_fkey";
            columns: ["column_id"];
            isOneToOne: false;
            referencedRelation: "columns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "time_entries_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "time_entries_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      user_ai_credentials: {
        Row: {
          created_at: string;
          key_hint: string;
          provider: string;
          secret_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          key_hint: string;
          provider: string;
          secret_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          key_hint?: string;
          provider?: string;
          secret_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      workspaces: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          name: string;
          org_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          id?: string;
          name: string;
          org_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          name?: string;
          org_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspaces_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      _admin_audit: {
        Args: {
          p_action: string;
          p_actor: string;
          p_actor_kind: string;
          p_metadata: Json;
          p_org_id: string;
          p_target_email: string;
          p_target_user: string;
        };
        Returns: undefined;
      };
      _automation_condition_predicate: {
        Args: { p_col: string; p_item_id: string; p_op: string; p_val: string };
        Returns: string;
      };
      _automation_conditions_pass: {
        Args: { p_condition: Json; p_item_id: string };
        Returns: boolean;
      };
      _automation_date_sweep: { Args: { p_now?: string }; Returns: undefined };
      _automation_run: {
        Args: {
          p_actions: Json;
          p_actor: string;
          p_automation_id: string;
          p_board_id: string;
          p_condition: Json;
          p_item_id: string;
          p_org_id: string;
          p_trigger_type: string;
        };
        Returns: undefined;
      };
      _automation_runs_prune: { Args: never; Returns: undefined };
      _automation_webhook_reconcile: { Args: never; Returns: undefined };
      _board_health_counts: {
        Args: { p_board_id: string; p_since: string };
        Returns: {
          done_items: number;
          incomplete_items: number;
          new_items: number;
          overdue_items: number;
          total_items: number;
        }[];
      };
      _board_health_flags: {
        Args: { p_board_id: string };
        Returns: {
          is_done: boolean;
          is_incomplete: boolean;
          is_overdue: boolean;
          item_created_at: string;
          item_id: string;
          item_name: string;
        }[];
      };
      _dashboard_list_predicate: {
        Args: { p_col: string; p_op: string; p_val: string };
        Returns: string;
      };
      _health_digest_ping: { Args: never; Returns: undefined };
      _org_health_digest: {
        Args: { p_org_id: string; p_since: string };
        Returns: {
          board_id: string;
          board_name: string;
          done_items: number;
          incomplete_items: number;
          incomplete_sample: Json;
          new_items: number;
          new_sample: Json;
          overdue_items: number;
          total_items: number;
        }[];
      };
      _webhook_outcome: {
        Args: { p_error_msg: string; p_status_code: number };
        Returns: string;
      };
      _webhook_url_safe: { Args: { p_url: string }; Returns: boolean };
      accept_invitation: { Args: { p_invite_id: string }; Returns: string };
      add_portfolio_board: {
        Args: {
          p_board_id: string;
          p_done_column_id: string;
          p_done_option_ids: Json;
          p_portfolio_id: string;
        };
        Returns: {
          board_id: string;
          budget: number | null;
          created_at: string;
          done_column_id: string | null;
          done_option_ids: Json;
          health_override:
            | Database["public"]["Enums"]["portfolio_health"]
            | null;
          id: string;
          org_id: string;
          owner_user_id: string | null;
          portfolio_id: string;
          position: number;
          priority: Database["public"]["Enums"]["portfolio_priority"] | null;
          status_note: string | null;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "portfolio_boards";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      ai_credential_clear: { Args: { p_user: string }; Returns: undefined };
      ai_credential_get: {
        Args: { p_user: string };
        Returns: {
          provider: string;
          secret: string;
        }[];
      };
      ai_credential_set: {
        Args: {
          p_hint: string;
          p_provider: string;
          p_secret: string;
          p_user: string;
        };
        Returns: undefined;
      };
      ai_credits_used_this_month: { Args: { p_org: string }; Returns: number };
      archive_group: { Args: { p_group_id: string }; Returns: number };
      archive_item: { Args: { p_item_id: string }; Returns: number };
      auth_user_orgs: { Args: never; Returns: string[] };
      board_in_org: {
        Args: { p_board_id: string; p_org_id: string };
        Returns: boolean;
      };
      can_edit_board: { Args: { p_board_id: string }; Returns: boolean };
      can_edit_goal: { Args: { p_goal_id: string }; Returns: boolean };
      can_edit_member_capacity: {
        Args: { p_org_id: string; p_user_id: string };
        Returns: boolean;
      };
      can_edit_portfolio: {
        Args: { p_portfolio_id: string };
        Returns: boolean;
      };
      can_read_board: { Args: { p_board_id: string }; Returns: boolean };
      check_rate_limit: {
        Args: { p_key: string; p_limit: number; p_window_seconds: number };
        Returns: {
          allowed: boolean;
          remaining: number;
          retry_after: number;
        }[];
      };
      column_in_org: {
        Args: { p_column_id: string; p_org_id: string };
        Returns: boolean;
      };
      create_board: {
        Args: { p_name: string; p_workspace_id: string };
        Returns: {
          archived_at: string | null;
          archived_by: string | null;
          created_at: string;
          created_by: string;
          description: string | null;
          id: string;
          name: string;
          name_column_width: number | null;
          org_id: string;
          position: number;
          updated_at: string;
          workspace_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "boards";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_board_from_template: {
        Args: { p_name: string; p_template: Json; p_workspace_id: string };
        Returns: {
          archived_at: string | null;
          archived_by: string | null;
          created_at: string;
          created_by: string;
          description: string | null;
          id: string;
          name: string;
          name_column_width: number | null;
          org_id: string;
          position: number;
          updated_at: string;
          workspace_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "boards";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_board_view: {
        Args: {
          p_board_id: string;
          p_config?: Json;
          p_kind: Database["public"]["Enums"]["view_kind"];
          p_name: string;
        };
        Returns: {
          board_id: string;
          config: Json;
          created_at: string;
          id: string;
          kind: Database["public"]["Enums"]["view_kind"];
          name: string;
          org_id: string;
          position: number;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "board_views";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_dashboard: {
        Args: { p_name: string; p_workspace_id: string };
        Returns: {
          created_at: string;
          created_by: string;
          id: string;
          name: string;
          org_id: string;
          updated_at: string;
          workspace_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "dashboards";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_dashboard_widget: {
        Args: {
          p_config?: Json;
          p_dashboard_id: string;
          p_kind: Database["public"]["Enums"]["widget_kind"];
          p_layout?: Json;
          p_source_board_id: string;
          p_title?: string;
        };
        Returns: {
          config: Json;
          created_at: string;
          dashboard_id: string;
          id: string;
          kind: Database["public"]["Enums"]["widget_kind"];
          layout: Json;
          org_id: string;
          position: number;
          source_board_id: string | null;
          title: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "dashboard_widgets";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_goal: {
        Args: {
          p_current_value: number;
          p_due_date: string;
          p_name: string;
          p_owner_id: string;
          p_parent_goal_id: string;
          p_percent: number;
          p_progress_mode: Database["public"]["Enums"]["goal_progress_mode"];
          p_start_date: string;
          p_start_value: number;
          p_status: Database["public"]["Enums"]["goal_status"];
          p_target_value: number;
          p_unit: string;
          p_workspace_id: string;
        };
        Returns: {
          created_at: string;
          created_by: string;
          current_value: number | null;
          description: string | null;
          due_date: string | null;
          id: string;
          name: string;
          org_id: string;
          owner_id: string;
          parent_goal_id: string | null;
          percent: number | null;
          position: number;
          progress_mode: Database["public"]["Enums"]["goal_progress_mode"];
          start_date: string | null;
          start_value: number | null;
          status: Database["public"]["Enums"]["goal_status"];
          target_value: number | null;
          unit: string | null;
          updated_at: string;
          workspace_id: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "goals";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_item: {
        Args: { p_group_id: string; p_name: string };
        Returns: {
          archived_at: string | null;
          archived_by: string | null;
          board_id: string;
          created_at: string;
          created_by: string;
          group_id: string;
          id: string;
          name: string;
          org_id: string;
          parent_id: string | null;
          position: number;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "items";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_item_dependency: {
        Args: { p_predecessor: string; p_successor: string };
        Returns: {
          board_id: string;
          created_at: string;
          id: string;
          org_id: string;
          predecessor_id: string;
          successor_id: string;
          type: string;
        };
        SetofOptions: {
          from: "*";
          to: "item_dependencies";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_organization: {
        Args: { p_name: string; p_slug: string; p_workspace_name?: string };
        Returns: {
          created_at: string;
          created_by: string;
          id: string;
          name: string;
          slug: string;
          timezone: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "organizations";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_portfolio: {
        Args: { p_name: string };
        Returns: {
          created_at: string;
          created_by: string;
          description: string | null;
          id: string;
          name: string;
          org_id: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "portfolios";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      dashboard_aggregate: {
        Args: {
          p_agg?: string;
          p_board_id: string;
          p_group_column_id?: string;
          p_value_column_id?: string;
        };
        Returns: {
          group_key: string;
          metric: number;
        }[];
      };
      dashboard_completion: {
        Args: {
          p_board_id: string;
          p_done_option_ids?: Json;
          p_mode: string;
          p_value_column_id: string;
        };
        Returns: {
          completion: number;
          group_key: string;
          item_count: number;
        }[];
      };
      dashboard_health_summary: {
        Args: { p_board_id: string };
        Returns: {
          done_items: number;
          incomplete_items: number;
          new_items: number;
          overdue_items: number;
          total_items: number;
        }[];
      };
      dashboard_list_rows: {
        Args: { p_board_id: string; p_filter?: Json; p_limit?: number };
        Returns: {
          created_at: string;
          item_id: string;
          name: string;
        }[];
      };
      dashboard_series: {
        Args: {
          p_board_id: string;
          p_limit?: number;
          p_measure?: Json;
          p_primary: Json;
          p_series?: Json;
        };
        Returns: {
          primary_key: string;
          series_key: string;
          value: number;
        }[];
      };
      deactivate_member: {
        Args: { p_org_id: string; p_user_id: string };
        Returns: undefined;
      };
      decline_invitation: { Args: { p_invite_id: string }; Returns: undefined };
      delete_board_view: { Args: { p_view_id: string }; Returns: undefined };
      delete_column_option: {
        Args: { p_column_id: string; p_option_id: string };
        Returns: number;
      };
      duplicate_board_structure: {
        Args: { p_board_id: string };
        Returns: {
          archived_at: string | null;
          archived_by: string | null;
          created_at: string;
          created_by: string;
          description: string | null;
          id: string;
          name: string;
          name_column_width: number | null;
          org_id: string;
          position: number;
          updated_at: string;
          workspace_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "boards";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      duplicate_dashboard: {
        Args: { p_dashboard_id: string };
        Returns: {
          created_at: string;
          created_by: string;
          id: string;
          name: string;
          org_id: string;
          updated_at: string;
          workspace_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "dashboards";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      escape_like: { Args: { p_text: string }; Returns: string };
      get_my_work_items: {
        Args: { p_limit?: number };
        Returns: {
          board_id: string;
          board_name: string;
          due_date: string;
          group_name: string;
          item_id: string;
          item_name: string;
          status_option_id: string;
          status_settings: Json;
        }[];
      };
      get_org_members: {
        Args: { p_limit?: number; p_offset?: number; p_org_id: string };
        Returns: {
          created_at: string;
          deactivated_at: string;
          email: string;
          full_name: string;
          role: Database["public"]["Enums"]["org_role"];
          user_id: string;
        }[];
      };
      goal_in_org: {
        Args: { p_goal_id: string; p_org_id: string };
        Returns: boolean;
      };
      goals_rollup: {
        Args: never;
        Returns: {
          board_id: string;
          done_items: number;
          goal_id: string;
          total_items: number;
        }[];
      };
      group_in_org: {
        Args: { p_group_id: string; p_org_id: string };
        Returns: boolean;
      };
      has_org_role: {
        Args: {
          p_org_id: string;
          p_roles: Database["public"]["Enums"]["org_role"][];
        };
        Returns: boolean;
      };
      import_rows_into_board: {
        Args: { p_board_id: string; p_payload: Json };
        Returns: undefined;
      };
      is_board_member: { Args: { p_board_id: string }; Returns: boolean };
      is_member_of: {
        Args: { p_org_id: string; p_user: string };
        Returns: boolean;
      };
      is_org_member: { Args: { p_org_id: string }; Returns: boolean };
      is_org_member_of: {
        Args: { p_org_id: string; p_user_id: string };
        Returns: boolean;
      };
      is_platform_admin: { Args: never; Returns: boolean };
      item_in_org: {
        Args: { p_item_id: string; p_org_id: string };
        Returns: boolean;
      };
      my_pending_invitations: {
        Args: never;
        Returns: {
          created_at: string;
          id: string;
          org_id: string;
          org_name: string;
          role: Database["public"]["Enums"]["org_role"];
        }[];
      };
      org_ai_secret_clear: { Args: { p_org: string }; Returns: undefined };
      org_ai_secret_get: {
        Args: { p_org: string };
        Returns: {
          provider: string;
          secret: string;
        }[];
      };
      org_ai_secret_set: {
        Args: {
          p_hint: string;
          p_org: string;
          p_provider: string;
          p_secret: string;
        };
        Returns: undefined;
      };
      platform_search_users: {
        Args: { p_limit?: number; p_offset?: number; p_query?: string };
        Returns: {
          banned_until: string;
          created_at: string;
          email: string;
          id: string;
          org_names: string[];
        }[];
      };
      platform_set_org_role: {
        Args: {
          p_org_id: string;
          p_role: Database["public"]["Enums"]["org_role"];
          p_user_id: string;
        };
        Returns: undefined;
      };
      platform_stats: {
        Args: never;
        Returns: {
          admins: number;
          events_24h: number;
          orgs: number;
          users: number;
        }[];
      };
      platform_user_sole_owned_orgs: {
        Args: { p_user_id: string };
        Returns: {
          org_id: string;
          org_name: string;
        }[];
      };
      portfolio_in_org: {
        Args: { p_org_id: string; p_portfolio_id: string };
        Returns: boolean;
      };
      portfolio_rollup: {
        Args: { p_portfolio_id: string; p_today: string };
        Returns: {
          board_id: string;
          done_items: number;
          name: string;
          overdue_items: number;
          timeline_end: string;
          timeline_start: string;
          total_items: number;
        }[];
      };
      provision_account: {
        Args: { p_org_name: string };
        Returns: {
          created_at: string;
          created_by: string;
          id: string;
          name: string;
          slug: string;
          timezone: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "organizations";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      reactivate_member: {
        Args: { p_org_id: string; p_user_id: string };
        Returns: undefined;
      };
      readable_board_ids: { Args: never; Returns: string[] };
      record_ai_usage: {
        Args: {
          p_cost_usd: number;
          p_credits: number;
          p_feature: string;
          p_input_tokens: number;
          p_model: string;
          p_org: string;
          p_output_tokens: number;
          p_provider: string;
          p_user: string;
        };
        Returns: undefined;
      };
      redeem_invitations: { Args: never; Returns: number };
      remove_member: {
        Args: { p_org_id: string; p_user_id: string };
        Returns: undefined;
      };
      restore_group: { Args: { p_group_id: string }; Returns: number };
      restore_item: { Args: { p_item_id: string }; Returns: number };
      search_items: {
        Args: { p_limit?: number; p_query: string };
        Returns: {
          board_id: string;
          board_name: string;
          id: string;
          name: string;
          rank: number;
        }[];
      };
      set_goal_links: {
        Args: { p_goal_id: string; p_links: Json };
        Returns: {
          board_id: string;
          created_at: string;
          done_column_id: string | null;
          done_option_ids: Json;
          goal_id: string;
          id: string;
          org_id: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "goal_links";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      set_member_role: {
        Args: {
          p_new_role: Database["public"]["Enums"]["org_role"];
          p_org_id: string;
          p_user_id: string;
        };
        Returns: undefined;
      };
      set_relation_links: {
        Args: {
          p_column_id: string;
          p_item_id: string;
          p_linked_item_ids: string[];
        };
        Returns: {
          board_id: string;
          column_id: string;
          created_at: string;
          id: string;
          item_id: string;
          linked_item_id: string;
          org_id: string;
          position: number;
        }[];
        SetofOptions: {
          from: "*";
          to: "relation_links";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      set_widget_layouts: {
        Args: { p_dashboard_id: string; p_layouts: Json };
        Returns: undefined;
      };
      share_board: {
        Args: {
          p_access: Database["public"]["Enums"]["board_access"];
          p_board_id: string;
          p_user_id: string;
        };
        Returns: undefined;
      };
      shares_org_with: { Args: { p_user: string }; Returns: boolean };
      start_timer: {
        Args: { p_column_id: string; p_item_id: string };
        Returns: {
          board_id: string;
          column_id: string;
          created_at: string;
          duration_secs: number | null;
          ended_at: string | null;
          id: string;
          item_id: string;
          org_id: string;
          started_at: string;
          user_id: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "time_entries";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      unshare_board: {
        Args: { p_board_id: string; p_user_id: string };
        Returns: undefined;
      };
      workload_actuals_rollup: {
        Args: { p_from: string; p_to: string };
        Returns: {
          board_id: string;
          day: string;
          secs: number;
          user_id: string;
        }[];
      };
      workload_rollup: {
        Args: { p_from: string; p_to: string };
        Returns: {
          board_id: string;
          end_date: string;
          estimate_secs: number;
          item_id: string;
          item_name: string;
          start_date: string;
          user_id: string;
        }[];
      };
    };
    Enums: {
      activity_action:
        | "item_created"
        | "item_renamed"
        | "item_moved"
        | "item_deleted"
        | "cell_changed"
        | "update_added";
      ai_mode: "off" | "managed" | "org_byo" | "per_user";
      board_access: "viewer" | "editor";
      column_kind:
        | "text"
        | "status"
        | "people"
        | "date"
        | "numbers"
        | "dropdown"
        | "checkbox"
        | "rating"
        | "link"
        | "email"
        | "phone"
        | "files"
        | "time_tracking"
        | "relation"
        | "mirror"
        | "percent"
        | "currency"
        | "priority";
      goal_progress_mode:
        | "manual_number"
        | "manual_percent"
        | "auto_subgoals"
        | "auto_boards";
      goal_status: "on_track" | "at_risk" | "off_track" | "done";
      notification_channel: "in_app" | "email";
      notification_kind:
        | "mention"
        | "assigned"
        | "update_on_item"
        | "automation"
        | "feedback_response"
        | "health_digest";
      org_role: "owner" | "admin" | "member" | "guest";
      portfolio_health: "on_track" | "at_risk" | "off_track";
      portfolio_priority: "low" | "medium" | "high" | "critical";
      view_kind: "table" | "kanban" | "calendar" | "timeline";
      widget_kind:
        | "number"
        | "chart"
        | "battery"
        | "list"
        | "completion"
        | "health";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

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
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
      activity_action: [
        "item_created",
        "item_renamed",
        "item_moved",
        "item_deleted",
        "cell_changed",
        "update_added",
      ],
      ai_mode: ["off", "managed", "org_byo", "per_user"],
      board_access: ["viewer", "editor"],
      column_kind: [
        "text",
        "status",
        "people",
        "date",
        "numbers",
        "dropdown",
        "checkbox",
        "rating",
        "link",
        "email",
        "phone",
        "files",
        "time_tracking",
        "relation",
        "mirror",
        "percent",
        "currency",
        "priority",
      ],
      goal_progress_mode: [
        "manual_number",
        "manual_percent",
        "auto_subgoals",
        "auto_boards",
      ],
      goal_status: ["on_track", "at_risk", "off_track", "done"],
      notification_channel: ["in_app", "email"],
      notification_kind: [
        "mention",
        "assigned",
        "update_on_item",
        "automation",
        "feedback_response",
        "health_digest",
      ],
      org_role: ["owner", "admin", "member", "guest"],
      portfolio_health: ["on_track", "at_risk", "off_track"],
      portfolio_priority: ["low", "medium", "high", "critical"],
      view_kind: ["table", "kanban", "calendar", "timeline"],
      widget_kind: [
        "number",
        "chart",
        "battery",
        "list",
        "completion",
        "health",
      ],
    },
  },
} as const;
