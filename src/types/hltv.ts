import type { DetailLevel } from "./common.js";

export interface ResolveEntityQuery {
  name: string;
  exact?: boolean;
  limit?: number;
}

export interface TeamRecentQuery {
  team_id?: number;
  team_name?: string;
  limit?: number;
  include_upcoming?: boolean;
  include_recent_results?: boolean;
  detail?: DetailLevel;
  exact?: boolean;
}

export interface PlayerRecentQuery {
  player_id?: number;
  player_name?: string;
  limit?: number;
  detail?: DetailLevel;
  exact?: boolean;
}

export interface ResultsRecentQuery {
  team_id?: number;
  team?: string;
  event?: string;
  limit?: number;
  days?: number;
}

export interface UpcomingMatchesQuery {
  team_id?: number;
  team?: string;
  event?: string;
  limit?: number;
  days?: number;
}

export interface MatchCommandParseQuery {
  raw_args?: string;
}

export interface MatchCommandParseResult {
  raw_args?: string;
  payload: UpcomingMatchesQuery;
  dropped_fields: string[];
}

export interface NewsDigestQuery {
  limit?: number;
  tag?: string;
  year?: number;
  month?: number | string;
}

export interface ResolvedTeamEntity {
  type: "team";
  id: number;
  name: string;
  slug: string;
  country?: string;
  rank?: number;
  score?: number;
  aliases?: string[];
}

export interface ResolvedPlayerEntity {
  type: "player";
  id: number;
  name: string;
  slug: string;
  team?: string;
  country?: string;
  score?: number;
  aliases?: string[];
}

export type MatchOutcome = "win" | "loss" | "draw" | "scheduled" | "unknown";

export interface NormalizedMatch {
  match_id?: number;
  team1_id?: number;
  team2_id?: number;
  opponent_id?: number;
  team1?: string;
  team2?: string;
  opponent?: string;
  event?: string;
  result?: MatchOutcome;
  score?: string;
  winner?: string;
  best_of?: string;
  played_at?: string;
  scheduled_at?: string;
  map_text?: string;
}

export interface TeamProfile {
  id: number;
  name: string;
  slug: string;
  country?: string;
  rank?: number;
  raw_summary?: string;
}

export interface PlayerProfile {
  id: number;
  name: string;
  slug: string;
  team?: string;
  country?: string;
  raw_summary?: string;
}

export interface TeamRecentData {
  profile: TeamProfile;
  recent_results: NormalizedMatch[];
  upcoming_matches: NormalizedMatch[];
  summary_stats: {
    wins: number;
    losses: number;
    draws: number;
    recent_record: string;
  };
}

export interface PlayerRecentData {
  profile: PlayerProfile;
  overview: Record<string, string | number>;
  recent_matches: NormalizedMatch[];
  recent_highlights: string[];
}

export interface NewsItem {
  title: string;
  link?: string;
  published_at?: string;
  summary_hint?: string;
  tag?: string;
}
