import type { SummaryMode } from "../config/env.js";
import type { ToolResponse } from "../types/common.js";
import type {
  NewsItem,
  NormalizedMatch,
  PlayerRecentData,
  ResolvedPlayerEntity,
  ResolvedTeamEntity,
  TeamRecentData
} from "../types/hltv.js";

export class SummaryService {
  constructor(private readonly mode: SummaryMode) {}

  private reasonHint(response: ToolResponse): string {
    return response.meta.notes?.[0] ? ` 原因：${response.meta.notes[0]}` : "";
  }

  summarizeTeam(response: ToolResponse<TeamRecentData, never, ResolvedTeamEntity>): string {
    if (this.mode === "raw") {
      return "已启用 raw 模式，当前未生成自然语言摘要。";
    }

    if (response.error || !response.data) {
      return "当前无法生成队伍摘要，请参考下方原始结构化事实。";
    }

    const { profile, summary_stats, upcoming_matches } = response.data;
    const nextOpponent = upcoming_matches[0]?.opponent ?? upcoming_matches[0]?.team2 ?? upcoming_matches[0]?.team1;
    const rankText = profile.rank ? `当前排名约为 #${profile.rank}` : "当前排名信息缺失";
    const recordText = `近况为 ${summary_stats.recent_record}`;
    const reasonHint = this.reasonHint(response);

    if (nextOpponent) {
      return `${profile.name} ${rankText}，${recordText}。接下来最值得关注的是对阵 ${nextOpponent} 的比赛，可继续观察其状态延续性。${reasonHint}`;
    }

    return `${profile.name} ${rankText}，${recordText}。目前可用数据表明其近期表现较为稳定，建议结合最近几场比赛继续观察。${reasonHint}`;
  }

  summarizePlayer(response: ToolResponse<PlayerRecentData, never, ResolvedPlayerEntity>): string {
    if (this.mode === "raw") {
      return "已启用 raw 模式，当前未生成自然语言摘要。";
    }

    if (response.error || !response.data) {
      return "当前无法生成选手摘要，请参考下方原始结构化事实。";
    }

    const { profile, overview, recent_highlights } = response.data;
    const rating = overview.rating ?? overview.adr ?? overview.impact;
    const statsText = rating ? `关键指标 ${rating}` : "关键统计数据有限";
    const highlightText = recent_highlights[0] ? `最近亮点包括：${recent_highlights[0]}` : "近期亮点数据有限";
    const reasonHint = this.reasonHint(response);

    return `${profile.name}${profile.team ? `（${profile.team}）` : ""}近期状态概览：${statsText}，${highlightText}。建议在后续比赛中继续关注其稳定输出能力。${reasonHint}`;
  }

  summarizeResults(response: ToolResponse<never, NormalizedMatch>): string {
    if (this.mode === "raw") {
      return "已启用 raw 模式，当前未生成自然语言摘要。";
    }

    if (response.error || !response.items?.length) {
      return `当前无法生成结果摘要，请参考下方列表。${this.reasonHint(response)}`;
    }

    const focus = response.items.slice(0, 2).map((item) => `${item.team1} vs ${item.team2}`).join("；");
    return `近期结果中最值得关注的对局包括：${focus}。这些比赛可作为观察当前热门队伍状态与赛事热度的直接参考。`;
  }

  summarizeMatches(response: ToolResponse<never, NormalizedMatch>): string {
    if (this.mode === "raw") {
      return "已启用 raw 模式，当前未生成自然语言摘要。";
    }

    if (response.error || !response.items?.length) {
      return `当前无法生成赛程摘要，请参考下方列表。${this.reasonHint(response)}`;
    }

    const focus = response.items.slice(0, 2).map((item) => `${item.team1} vs ${item.team2}`).join("；");
    return `接下来赛程中，${focus} 等比赛值得重点关注，适合用来追踪近期强队状态与焦点赛事走势。`;
  }

  summarizeNews(response: ToolResponse<never, NewsItem>): string {
    if (this.mode === "raw") {
      return "已启用 raw 模式，当前未生成自然语言摘要。";
    }

    if (response.error || !response.items?.length) {
      return `当前无法生成新闻摘要，请参考下方列表。${this.reasonHint(response)}`;
    }

    const focus = response.items.slice(0, 3).map((item) => item.title).join("；");
    return `当前新闻重点集中在：${focus}。如需更细粒度分析，可继续增加 tag 或时间范围过滤。`;
  }
}
