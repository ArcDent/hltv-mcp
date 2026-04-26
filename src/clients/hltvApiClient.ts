import { AppError, isAppError } from "../errors/appError.js";
import { ensureArray } from "../utils/object.js";
import { slugify, toEnglishMonthName } from "../utils/strings.js";

export interface HltvApiClientOptions {
  baseUrl: string;
  baseUrls?: string[];
  timeoutMs: number;
}

export class HltvApiClient {
  private readonly baseUrls: string[];
  private preferredBaseUrlIndex = 0;

  constructor(private readonly options: HltvApiClientOptions) {
    this.baseUrls = Array.from(
      new Set([...(options.baseUrls ?? []), options.baseUrl].filter((value) => value.trim().length > 0))
    );
  }

  async searchTeams(name: string): Promise<unknown[]> {
    try {
      const payload = await this.requestJson(`/api/v1/teams/search/${encodeURIComponent(name)}`);
      return ensureArray(payload);
    } catch (error) {
      if (isAppError(error) && error.code === "UPSTREAM_NOT_FOUND") {
        return [];
      }

      throw error;
    }
  }

  async getTeam(teamId: number, teamName?: string): Promise<unknown> {
    return this.requestJson(`/api/v1/teams/${teamId}/${encodeURIComponent(teamName ?? String(teamId))}`);
  }

  async getTeamMatches(teamId: number, offset = 0): Promise<unknown[]> {
    const path = offset > 0 ? `/api/v1/teams/${teamId}/matches/${offset}` : `/api/v1/teams/${teamId}/matches`;
    const payload = await this.requestJson(path);
    return ensureArray(payload);
  }

  async searchPlayers(name: string): Promise<unknown[]> {
    try {
      const payload = await this.requestJson(`/api/v1/players/search/${encodeURIComponent(name)}`);
      return ensureArray(payload);
    } catch (error) {
      if (isAppError(error) && error.code === "UPSTREAM_NOT_FOUND") {
        return [];
      }

      throw error;
    }
  }

  async getPlayer(playerId: number, playerName?: string): Promise<unknown> {
    return this.requestJson(
      `/api/v1/players/${playerId}/${encodeURIComponent(playerName ?? String(playerId))}`
    );
  }

  async getPlayerOverview(playerId: number, playerName?: string): Promise<unknown> {
    return this.requestJson(
      `/api/v1/players/stats/overview/${playerId}/${encodeURIComponent(playerName ?? String(playerId))}`
    );
  }

  async getRecentResults(offset = 0): Promise<unknown[]> {
    const preferredPath = offset > 0 ? `/api/v1/results/${offset}` : "/api/v1/results/";

    try {
      const payload = await this.requestJson(preferredPath);
      return ensureArray(payload);
    } catch (error) {
      if (offset === 0 && isAppError(error) && error.code === "UPSTREAM_NOT_FOUND") {
        const fallbackPayload = await this.requestJson("/api/v1/results");
        return ensureArray(fallbackPayload);
      }

      throw error;
    }
  }

  async getUpcomingMatches(): Promise<unknown[]> {
    const payload = await this.requestJson("/api/v1/matches/upcoming");
    return ensureArray(payload);
  }

  async getNews(year?: number, month?: number | string): Promise<unknown[]> {
    const normalizedMonth = toEnglishMonthName(month);
    const path = year && normalizedMonth ? `/api/v1/news/${year}/${encodeURIComponent(normalizedMonth)}` : "/api/v1/news";
    const payload = await this.requestJson(path);
    return ensureArray(payload);
  }

  async getRealtimeNews(): Promise<unknown[]> {
    const payload = await this.requestJson("/api/v1/news/realtime");
    return ensureArray(payload);
  }

  buildSlug(rawName: string | undefined, fallbackId: number): string {
    return rawName ? slugify(rawName) : String(fallbackId);
  }

  private async requestJson(path: string): Promise<unknown> {
    const attemptedBaseUrls: string[] = [];
    let lastError: AppError | undefined;

    for (const baseUrl of this.getAttemptOrder()) {
      attemptedBaseUrls.push(baseUrl);

      try {
        const payload = await this.requestJsonFromBaseUrl(baseUrl, path);
        this.preferredBaseUrlIndex = this.baseUrls.indexOf(baseUrl);
        return payload;
      } catch (error) {
        if (error instanceof AppError) {
          if (error.code === "UPSTREAM_NOT_FOUND") {
            throw error;
          }

          lastError = error;

          if (error.retryable && attemptedBaseUrls.length < this.baseUrls.length) {
            continue;
          }

          throw this.withAttemptMetadata(error, attemptedBaseUrls);
        }

        lastError = new AppError("UPSTREAM_UNAVAILABLE", "Failed to reach HLTV API", {
          retryable: true,
          details: { path, baseUrl },
          cause: error
        });

        if (attemptedBaseUrls.length < this.baseUrls.length) {
          continue;
        }

        throw this.withAttemptMetadata(lastError, attemptedBaseUrls);
      }
    }

    throw this.withAttemptMetadata(
      lastError ??
        new AppError("UPSTREAM_UNAVAILABLE", "Failed to reach HLTV API", {
          retryable: true,
          details: { path }
        }),
      attemptedBaseUrls
    );
  }

  private getAttemptOrder(): string[] {
    if (this.baseUrls.length <= 1) {
      return this.baseUrls;
    }

    return [
      this.baseUrls[this.preferredBaseUrlIndex]!,
      ...this.baseUrls.filter((_, index) => index !== this.preferredBaseUrlIndex)
    ];
  }

  private resolveRequestUrl(baseUrl: string, path: string): URL {
    const parsedBaseUrl = new URL(baseUrl);
    const basePath = parsedBaseUrl.pathname.endsWith("/") ? parsedBaseUrl.pathname : `${parsedBaseUrl.pathname}/`;
    return new URL(path.replace(/^\/+/, ""), new URL(basePath, parsedBaseUrl));
  }

  private withAttemptMetadata(error: AppError, attemptedBaseUrls: string[]): AppError {
    return new AppError(error.code, error.message, {
      retryable: error.retryable,
      details: {
        ...error.details,
        attemptedBaseUrls
      },
      cause: error.cause
    });
  }

  private async requestJsonFromBaseUrl(baseUrl: string, path: string): Promise<unknown> {
    const url = this.resolveRequestUrl(baseUrl, path);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json"
        },
        signal: controller.signal
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new AppError("UPSTREAM_NOT_FOUND", `HLTV API responded with 404 for ${path}`, {
            retryable: false,
            details: {
              path,
              status: response.status,
              url: url.toString(),
              baseUrl
            }
          });
        }

        throw new AppError("UPSTREAM_UNAVAILABLE", `HLTV API responded with ${response.status}`, {
          retryable: response.status >= 500,
          details: {
            path,
            status: response.status,
            url: url.toString(),
            baseUrl
          }
        });
      }

      return await response.json();
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new AppError("UPSTREAM_TIMEOUT", "HLTV API request timed out", {
          retryable: true,
          details: {
            path,
            url: url.toString(),
            baseUrl
          }
        });
      }

      throw new AppError("UPSTREAM_UNAVAILABLE", "Failed to reach HLTV API", {
        retryable: true,
        details: {
          path,
          url: url.toString(),
          baseUrl
        },
        cause: error
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
