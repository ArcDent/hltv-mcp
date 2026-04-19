import { z } from "zod";

export const detailLevelSchema = z.enum(["brief", "standard", "full"]);

export const resolveEntitySchema = {
  name: z.string().min(1),
  exact: z.boolean().optional(),
  limit: z.number().int().min(1).max(10).optional()
};

export const teamRecentSchema = {
  team_id: z.number().int().positive().optional(),
  team_name: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(10).optional(),
  include_upcoming: z.boolean().optional(),
  include_recent_results: z.boolean().optional(),
  detail: detailLevelSchema.optional(),
  timezone: z.string().min(1).optional(),
  exact: z.boolean().optional()
};

export const playerRecentSchema = {
  player_id: z.number().int().positive().optional(),
  player_name: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(10).optional(),
  detail: detailLevelSchema.optional(),
  timezone: z.string().min(1).optional(),
  exact: z.boolean().optional()
};

export const resultsSchema = {
  team_id: z.number().int().positive().optional(),
  team: z.string().min(1).optional(),
  event: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(20).optional(),
  days: z.number().int().min(1).max(30).optional(),
  timezone: z.string().min(1).optional()
};

export const matchesSchema = {
  team_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Optional stable HLTV team id. Prefer only after resolve_team returns a confirmed id."),
  team: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional explicit team name filter. Omit this for generic requests like today's matches / 今日赛程. Do not pass placeholders or generic words such as today, 今日, schedule, matches, 比赛, 赛程."
    ),
  event: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional explicit event name filter. Omit this for generic requests like today's matches / 今日赛程. Do not pass generic date or schedule words as event names."
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe(
      "Optional result limit. Omit limit for the no-argument default behavior that returns today's matches in the active timezone."
    ),
  days: z
    .number()
    .int()
    .min(1)
    .max(30)
    .optional()
    .describe(
      "Optional upcoming window in days. Omit days for the no-argument default behavior that returns today's matches in the active timezone."
    ),
  timezone: z
    .string()
    .min(1)
    .optional()
    .describe("Optional IANA timezone. For no-argument default mode, this may be the only extra field you pass.")
};

export const matchesTodaySchema = {};

export const matchCommandParseSchema = {
  raw_args: z
    .string()
    .optional()
    .describe("The exact non-empty raw argument string received by the /match command. For bare '/match', skip this parser and call hltv_matches_today directly."),
  timezone: z
    .string()
    .min(1)
    .optional()
    .describe("Optional fallback timezone to keep when parsing raw args. Do not invent other fields.")
};

export const newsSchema = {
  limit: z.number().int().min(1).max(50).optional(),
  tag: z.string().min(1).optional(),
  year: z.number().int().min(2000).max(3000).optional(),
  month: z.union([z.number().int().min(1).max(12), z.string().min(1)]).optional(),
  timezone: z.string().min(1).optional(),
  page: z.number().int().min(1).optional(),
  offset: z.number().int().min(0).optional()
};
