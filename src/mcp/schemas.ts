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

export const newsSchema = {
  limit: z.number().int().min(1).max(20).optional(),
  tag: z.string().min(1).optional(),
  year: z.number().int().min(2000).max(3000).optional(),
  month: z.number().int().min(1).max(12).optional(),
  timezone: z.string().min(1).optional()
};
