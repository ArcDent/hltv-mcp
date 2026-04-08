export type AppErrorCode =
  | "INVALID_ARGUMENT"
  | "ENTITY_NOT_FOUND"
  | "ENTITY_AMBIGUOUS"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_NOT_FOUND"
  | "UPSTREAM_UNAVAILABLE"
  | "UPSTREAM_BAD_DATA"
  | "RATE_LIMITED"
  | "LLM_SUMMARY_FAILED"
  | "PARTIAL_DATA"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  public readonly code: AppErrorCode;
  public readonly retryable: boolean;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: AppErrorCode,
    message: string,
    options: {
      retryable?: boolean;
      details?: Record<string, unknown>;
      cause?: unknown;
    } = {}
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
