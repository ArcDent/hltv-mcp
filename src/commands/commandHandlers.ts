import type { DetailLevel } from "../types/common.js";
import { ChineseRenderer } from "../renderers/chineseRenderer.js";
import { HltvFacade } from "../services/hltvFacade.js";

export const COMMAND_REGISTRY = {
  team: {
    aliases: ["team", "队伍", "t"],
    description: "查看队伍近况",
    usage: "/Team <name> [count] [detail]"
  },
  player: {
    aliases: ["player", "选手", "p"],
    description: "查看选手近况",
    usage: "/Player <name> [count] [detail]"
  },
  result: {
    aliases: ["result", "结果", "r"],
    description: "查看近期结果",
    usage: "/Result [team] [event] [count]"
  },
  match: {
    aliases: ["match", "赛程", "m"],
    description: "查看未来比赛（无参默认今日全部）",
    usage: "/Match [team] [event] [count]"
  },
  news: {
    aliases: ["news", "新闻", "n"],
    description: "查看新闻集合",
    usage: "/News [count] [tag]"
  }
} as const;

export class CommandHandlers {
  constructor(
    private readonly facade: HltvFacade,
    private readonly renderer: ChineseRenderer
  ) {}

  async team(name: string, count = 5, detail: DetailLevel = "standard"): Promise<string> {
    const response = await this.facade.getTeamRecent({
      team_name: name,
      limit: count,
      detail
    });
    return this.renderer.renderTeamRecent(response);
  }

  async player(name: string, count = 5, detail: DetailLevel = "standard"): Promise<string> {
    const response = await this.facade.getPlayerRecent({
      player_name: name,
      limit: count,
      detail
    });
    return this.renderer.renderPlayerRecent(response);
  }

  async result(team?: string, event?: string, count = 5): Promise<string> {
    const response = await this.facade.getResultsRecent({
      team,
      event,
      limit: count
    });
    return this.renderer.renderResults(response);
  }

  async match(team?: string, event?: string, count?: number): Promise<string> {
    const response = await this.facade.getUpcomingMatches({
      team,
      event,
      limit: count
    });
    return this.renderer.renderMatches(response);
  }

  async news(count = 5, tag?: string): Promise<string> {
    const response = await this.facade.getNewsDigest({
      limit: count,
      tag
    });
    return this.renderer.renderNews(response);
  }
}
