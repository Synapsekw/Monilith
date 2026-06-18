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
      attachments: {
        Row: {
          board_id: string;
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
          created_at: string;
          created_by: string;
          description: string | null;
          id: string;
          name: string;
          org_id: string;
          position: number;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          description?: string | null;
          id?: string;
          name: string;
          org_id: string;
          position?: number;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          description?: string | null;
          id?: string;
          name?: string;
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
      groups: {
        Row: {
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
          board_id: string;
          created_at: string;
          group_id: string;
          id: string;
          name: string;
          org_id: string;
          parent_id: string | null;
          position: number;
          updated_at: string;
        };
        Insert: {
          board_id: string;
          created_at?: string;
          group_id: string;
          id?: string;
          name: string;
          org_id: string;
          parent_id?: string | null;
          position?: number;
          updated_at?: string;
        };
        Update: {
          board_id?: string;
          created_at?: string;
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
      notifications: {
        Row: {
          actor_id: string | null;
          board_id: string | null;
          created_at: string;
          id: string;
          item_id: string | null;
          kind: Database["public"]["Enums"]["notification_kind"];
          org_id: string;
          read_at: string | null;
          recipient_id: string;
          update_id: string | null;
        };
        Insert: {
          actor_id?: string | null;
          board_id?: string | null;
          created_at?: string;
          id?: string;
          item_id?: string | null;
          kind: Database["public"]["Enums"]["notification_kind"];
          org_id: string;
          read_at?: string | null;
          recipient_id: string;
          update_id?: string | null;
        };
        Update: {
          actor_id?: string | null;
          board_id?: string | null;
          created_at?: string;
          id?: string;
          item_id?: string | null;
          kind?: Database["public"]["Enums"]["notification_kind"];
          org_id?: string;
          read_at?: string | null;
          recipient_id?: string;
          update_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_board_id_fkey";
            columns: ["board_id"];
            isOneToOne: false;
            referencedRelation: "boards";
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
      org_members: {
        Row: {
          created_at: string;
          org_id: string;
          role: Database["public"]["Enums"]["org_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          org_id: string;
          role?: Database["public"]["Enums"]["org_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
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
      organizations: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          name: string;
          slug: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          id?: string;
          name: string;
          slug: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          name?: string;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          email: string | null;
          full_name: string | null;
          id: string;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id: string;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id?: string;
          updated_at?: string;
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
      _dashboard_list_predicate: {
        Args: { p_col: string; p_op: string; p_val: string };
        Returns: string;
      };
      auth_user_orgs: { Args: never; Returns: string[] };
      board_in_org: {
        Args: { p_board_id: string; p_org_id: string };
        Returns: boolean;
      };
      column_in_org: {
        Args: { p_column_id: string; p_org_id: string };
        Returns: boolean;
      };
      create_board: {
        Args: { p_name: string; p_workspace_id: string };
        Returns: {
          created_at: string;
          created_by: string;
          description: string | null;
          id: string;
          name: string;
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
      create_item: {
        Args: { p_group_id: string; p_name: string };
        Returns: {
          board_id: string;
          created_at: string;
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
        Args: { p_name: string; p_slug: string };
        Returns: {
          created_at: string;
          created_by: string;
          id: string;
          name: string;
          slug: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "organizations";
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
      dashboard_list_rows: {
        Args: { p_board_id: string; p_filter?: Json; p_limit?: number };
        Returns: {
          created_at: string;
          item_id: string;
          name: string;
        }[];
      };
      delete_board_view: { Args: { p_view_id: string }; Returns: undefined };
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
      is_member_of: {
        Args: { p_org_id: string; p_user: string };
        Returns: boolean;
      };
      is_org_member: { Args: { p_org_id: string }; Returns: boolean };
      item_in_org: {
        Args: { p_item_id: string; p_org_id: string };
        Returns: boolean;
      };
      set_widget_layouts: {
        Args: { p_dashboard_id: string; p_layouts: Json };
        Returns: undefined;
      };
      shares_org_with: { Args: { p_user: string }; Returns: boolean };
    };
    Enums: {
      activity_action:
        | "item_created"
        | "item_renamed"
        | "item_moved"
        | "item_deleted"
        | "cell_changed"
        | "update_added";
      column_kind:
        | "text"
        | "status"
        | "people"
        | "date"
        | "numbers"
        | "dropdown";
      notification_kind: "mention" | "assigned" | "update_on_item";
      org_role: "owner" | "admin" | "member" | "guest";
      view_kind: "table" | "kanban" | "calendar" | "timeline";
      widget_kind: "number" | "chart" | "battery" | "list";
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
      column_kind: ["text", "status", "people", "date", "numbers", "dropdown"],
      notification_kind: ["mention", "assigned", "update_on_item"],
      org_role: ["owner", "admin", "member", "guest"],
      view_kind: ["table", "kanban", "calendar", "timeline"],
      widget_kind: ["number", "chart", "battery", "list"],
    },
  },
} as const;
