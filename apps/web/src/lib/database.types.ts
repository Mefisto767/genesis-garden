// Типы TypeScript для схемы Supabase (Этап 3). Написаны вручную по
// supabase/migrations/*.sql — при живом проекте перегенерировать точно:
//   supabase gen types typescript --project-id <ref> > src/lib/database.types.ts
// (или --local, если поднят локальный стек) и свериться с этим файлом.
// Форма (Row/Insert/Update) соответствует соглашению supabase-js v2.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          public_code: string;
          display_name: string;
          is_admin: boolean;
          banned: boolean;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['profiles']['Row']> & { id: string };
        Update: Partial<Database['public']['Tables']['profiles']['Row']>;
        Relationships: [];
      };
      gardens: {
        Row: {
          id: string;
          owner_id: string;
          coins: number;
          genetic_dust: number;
          pity_counter: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['gardens']['Row']>;
        Update: Partial<Database['public']['Tables']['gardens']['Row']>;
        Relationships: [];
      };
      seed_catalog: {
        Row: {
          id: string;
          name: string;
          grow_seconds: number;
          buy_cost: number;
          sell_value: number;
          species_id: number;
        };
        Insert: Database['public']['Tables']['seed_catalog']['Row'];
        Update: Partial<Database['public']['Tables']['seed_catalog']['Row']>;
        Relationships: [];
      };
      plots: {
        Row: {
          id: string;
          garden_id: string;
          plot_index: number;
          unlocked: boolean;
          seed_id: string | null;
          planted_at: string | null;
        };
        Insert: Partial<Database['public']['Tables']['plots']['Row']>;
        Update: Partial<Database['public']['Tables']['plots']['Row']>;
        Relationships: [];
      };
      plants: {
        Row: {
          id: string;
          garden_id: string;
          genome: Json;
          rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
          mutation_id: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['plants']['Row']>;
        Update: Partial<Database['public']['Tables']['plants']['Row']>;
        Relationships: [];
      };
      plant_ancestry: {
        Row: {
          plant_id: string;
          parent_a_id: string | null;
          parent_b_id: string | null;
        };
        Insert: Database['public']['Tables']['plant_ancestry']['Row'];
        Update: Partial<Database['public']['Tables']['plant_ancestry']['Row']>;
        Relationships: [];
      };
      inventory: {
        Row: {
          garden_id: string;
          seed_id: string;
          qty: number;
        };
        Insert: Database['public']['Tables']['inventory']['Row'];
        Update: Partial<Database['public']['Tables']['inventory']['Row']>;
        Relationships: [];
      };
      breeding_jobs: {
        Row: {
          id: string;
          garden_id: string;
          parent_a_id: string;
          parent_b_id: string;
          result_plant_id: string | null;
          mutated: boolean;
          pity_triggered: boolean;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['breeding_jobs']['Row']>;
        Update: Partial<Database['public']['Tables']['breeding_jobs']['Row']>;
        Relationships: [];
      };
      economy_ledger: {
        Row: {
          id: number;
          garden_id: string;
          delta_coins: number;
          delta_dust: number;
          reason: string;
          request_id: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['economy_ledger']['Row']>;
        Update: Partial<Database['public']['Tables']['economy_ledger']['Row']>;
        Relationships: [];
      };
      quests: {
        Row: {
          id: string;
          title: string;
          description: string;
          goal_type: 'plant' | 'harvest' | 'breed';
          target: number;
          reward_coins: number;
          reward_dust: number;
        };
        Insert: Database['public']['Tables']['quests']['Row'];
        Update: Partial<Database['public']['Tables']['quests']['Row']>;
        Relationships: [];
      };
      quest_progress: {
        Row: {
          garden_id: string;
          quest_id: string;
          progress: number;
          claimed: boolean;
        };
        Insert: Partial<Database['public']['Tables']['quest_progress']['Row']>;
        Update: Partial<Database['public']['Tables']['quest_progress']['Row']>;
        Relationships: [];
      };
      seasons: {
        Row: {
          id: string;
          name: string;
          starts_at: string;
          ends_at: string;
          is_active: boolean;
        };
        Insert: Partial<Database['public']['Tables']['seasons']['Row']>;
        Update: Partial<Database['public']['Tables']['seasons']['Row']>;
        Relationships: [];
      };
      social_connections: {
        Row: {
          id: string;
          profile_id: string;
          friend_id: string;
          status: 'pending' | 'accepted' | 'blocked';
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['social_connections']['Row']>;
        Update: Partial<Database['public']['Tables']['social_connections']['Row']>;
        Relationships: [];
      };
      gift_transactions: {
        Row: {
          id: string;
          sender_id: string;
          recipient_id: string;
          item_type: 'pollen' | 'cutting' | 'plant' | 'dust';
          item_payload: Json;
          status: 'pending' | 'claimed' | 'declined';
          request_id: string | null;
          created_at: string;
          claimed_at: string | null;
        };
        Insert: Partial<Database['public']['Tables']['gift_transactions']['Row']>;
        Update: Partial<Database['public']['Tables']['gift_transactions']['Row']>;
        Relationships: [];
      };
      purchases: {
        Row: {
          id: string;
          profile_id: string;
          product_id: string;
          provider: 'mock' | 'paddle';
          provider_transaction_id: string | null;
          status: 'pending' | 'completed' | 'refunded' | 'failed';
          amount_cents: number;
          currency: string;
          created_at: string;
          completed_at: string | null;
          raw_payload: Json | null;
        };
        Insert: Partial<Database['public']['Tables']['purchases']['Row']>;
        Update: Partial<Database['public']['Tables']['purchases']['Row']>;
        Relationships: [];
      };
      entitlements: {
        Row: {
          id: string;
          profile_id: string;
          type: 'growth_boost' | 'storage_slot' | 'cosmetic' | 'season_pass';
          percent: number | null;
          quantity: number | null;
          expires_at: string | null;
          source_purchase_id: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['entitlements']['Row']>;
        Update: Partial<Database['public']['Tables']['entitlements']['Row']>;
        Relationships: [];
      };
      analytics_events: {
        Row: {
          id: number;
          profile_id: string | null;
          event_name: string;
          payload: Json;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['analytics_events']['Row']>;
        Update: Partial<Database['public']['Tables']['analytics_events']['Row']>;
        Relationships: [];
      };
      audit_events: {
        Row: {
          id: number;
          actor_id: string | null;
          action: string;
          target_table: string | null;
          target_id: string | null;
          payload: Json;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['audit_events']['Row']>;
        Update: Partial<Database['public']['Tables']['audit_events']['Row']>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      plant: { Args: { p_plot_index: number; p_seed_id: string; p_request_id: string }; Returns: Json };
      harvest: { Args: { p_plot_index: number; p_request_id: string }; Returns: Json };
      expand_plot: { Args: { p_plot_index: number; p_request_id: string }; Returns: Json };
      buy_seed: { Args: { p_seed_id: string; p_qty: number; p_request_id: string }; Returns: Json };
      breed: { Args: { p_parent_a: string; p_parent_b: string; p_request_id: string }; Returns: Json };
      recycle_plant: { Args: { p_plant_id: string; p_request_id: string }; Returns: Json };
      claim_quest: { Args: { p_quest_id: string; p_request_id: string }; Returns: Json };
      send_gift: {
        Args: { p_recipient_public_code: string; p_item_type: string; p_item_payload: Json; p_request_id: string };
        Returns: Json;
      };
      claim_gift: { Args: { p_gift_id: string; p_request_id: string }; Returns: Json };
      decline_gift: { Args: { p_gift_id: string; p_request_id: string }; Returns: Json };
      log_analytics_event: { Args: { p_event_name: string; p_payload?: Json }; Returns: void };
    };
  };
}
