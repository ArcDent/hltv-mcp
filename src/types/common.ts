import type { AppErrorCode } from "../errors/appError.js";

export type DetailLevel = "brief" | "standard" | "full";

export interface ToolError {
  code: AppErrorCode | string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface PaginationMeta {
  offset: number;
  limit: number;
  returned: number;
  total: number;
  has_more: boolean;
  current_page: number;
  next_offset?: number;
  next_page?: number;
}

export interface ToolMeta {
  source: string;
  fetched_at: string;
  timezone: string;
  cache_hit: boolean;
  ttl_sec: number;
  schema_version: string;
  partial: boolean;
  notes?: string[];
  stale?: boolean;
  stale_age_sec?: number;
  pagination?: PaginationMeta;
}

export interface ToolResponse<
  TData = unknown,
  TItem = unknown,
  TResolvedEntity = unknown
> {
  query: Record<string, unknown>;
  resolved_entity?: TResolvedEntity;
  data?: TData;
  items?: TItem[];
  meta: ToolMeta;
  error: ToolError | null;
}
