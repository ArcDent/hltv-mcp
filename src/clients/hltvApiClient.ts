import { AppError, isAppError } from "../errors/appError.js";
import { ensureArray } from "../utils/object.js";
import { slugify } from "../utils/strings.js";

export interface HltvApiClientOptions {
  baseUrl: string;
  timeoutMs: number;
}

export class HltvApiClient {
  constructor(private readonly options: HltvApiClientOptions) {}

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
    const path = offset > 0 ? `/api/v1/results/${offset}` : "/api/v1/results";
    const payload = await this.requestJson(path);
    return ensureArray(payload);
  }

  async getUpcomingMatches(): Promise<unknown[]> {
    const payload = await this.requestJson("/api/v1/matches/upcoming");
    return ensureArray(payload);
  }

  async getNews(year?: number, month?: number): Promise<unknown[]> {
    const path = year && month ? `/api/v1/news/${year}/${month}` : "/api/v1/news";
    const payload = await this.requestJson(path);
    return ensureArray(payload);
  }

  buildSlug(rawName: string | undefined, fallbackId: number): string {
    return rawName ? slugify(rawName) : String(fallbackId);
  }

  private async requestJson(path: string): Promise<unknown> {
    const url = new URL(path, this.options.baseUrl);
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
              status: response.status
            }
          });
        }

        throw new AppError("UPSTREAM_UNAVAILABLE", `HLTV API responded with ${response.status}`, {
          retryable: response.status >= 500,
          details: {
            path,
            status: response.status
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
          details: { path }
        });
      }

      throw new AppError("UPSTREAM_UNAVAILABLE", "Failed to reach HLTV API", {
        retryable: true,
        details: { path },
        cause: error
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
