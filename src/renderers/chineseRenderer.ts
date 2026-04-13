import type { ToolResponse } from "../types/common.js";
import type {
  NewsItem,
  NormalizedMatch,
  PlayerRecentData,
  ResolvedPlayerEntity,
  ResolvedTeamEntity,
  TeamRecentData
} from "../types/hltv.js";
import { formatDateTime } from "../utils/time.js";
import { formatEventDisplayName, formatTeamDisplayName } from "../utils/localizedNames.js";
import { SummaryService } from "../services/summaryService.js";

export class ChineseRenderer {
  constructor(private readonly summaryService: SummaryService) {}

  renderTeamRecent(response: ToolResponse<TeamRecentData, never, ResolvedTeamEntity>): string {
    if (response.error || !response.data) {
      return this.renderError("队伍近况", response);
    }

    const summary = this.summaryService.summarizeTeam(response);
    const { profile, recent_results, upcoming_matches, summary_stats } = response.data;
    const timezone = response.query.timezone as string;

    const recentLines = recent_results.length
      ? recent_results
          .map(
            (item) =>
              `- ${item.result === "win" ? "胜" : item.result === "loss" ? "负" : "赛果未知"} ${formatTeamDisplayName(item.opponent ?? item.team2 ?? item.team1) ?? "未知对手"} ${item.score ?? ""}${item.event ? `（${formatEventDisplayName(item.event) ?? item.event}）` : ""}`
          )
          .join("\n")
      : "- 暂无近期赛果";

    const upcomingLines = upcoming_matches.length
      ? upcoming_matches
          .map(
            (item) =>
              `- vs ${formatTeamDisplayName(item.opponent ?? item.team2 ?? item.team1) ?? "未知对手"} ${item.scheduled_at ? formatDateTime(item.scheduled_at, timezone) : "待定"}${item.event ? `（${formatEventDisplayName(item.event) ?? item.event}）` : ""}`
          )
          .join("\n")
      : "- 暂无近期赛程";

    return [
      `【队伍近况】${formatTeamDisplayName(profile.name) ?? profile.name}`,
      "",
      "【关键事实】",
      `- 排名：${profile.rank ? `#${profile.rank}` : "未知"}`,
      `- 近况：${summary_stats.recent_record}`,
      recentLines,
      upcomingLines,
      "",
      "【中文总结】",
      summary,
      "",
      ...this.renderReasonSection(response),
      `【更新时间】${formatDateTime(response.meta.fetched_at, timezone)}`,
      `【来源】${response.meta.source}${response.meta.stale ? "（缓存回退）" : ""}`
    ].join("\n");
  }

  renderPlayerRecent(response: ToolResponse<PlayerRecentData, never, ResolvedPlayerEntity>): string {
    if (response.error || !response.data) {
      return this.renderError("选手近况", response);
    }

    const summary = this.summaryService.summarizePlayer(response);
    const { profile, overview, recent_highlights } = response.data;
    const timezone = response.query.timezone as string;
    const statsLines = Object.entries(overview).length
      ? Object.entries(overview)
          .map(([key, value]) => `- ${key}: ${value}`)
          .join("\n")
      : "- 暂无统计概览";
    const highlightLines = recent_highlights.length
      ? recent_highlights.map((item) => `- ${item}`).join("\n")
      : "- 暂无近期亮点";

    return [
      `【选手近况】${profile.name}`,
      "",
      "【关键事实】",
      `- 所属队伍：${formatTeamDisplayName(profile.team) ?? profile.team ?? "未知"}`,
      `- 国家/地区：${profile.country ?? "未知"}`,
      statsLines,
      highlightLines,
      "",
      "【中文总结】",
      summary,
      "",
      ...this.renderReasonSection(response),
      `【更新时间】${formatDateTime(response.meta.fetched_at, timezone)}`,
      `【来源】${response.meta.source}${response.meta.stale ? "（缓存回退）" : ""}`
    ].join("\n");
  }

  renderResults(response: ToolResponse<never, NormalizedMatch>): string {
    const summary = this.summaryService.summarizeResults(response);
    return this.renderMatchList("近期结果", response, summary, false);
  }

  renderMatches(response: ToolResponse<never, NormalizedMatch>): string {
    const summary = this.summaryService.summarizeMatches(response);
    return this.renderMatchList(response.query.today_only ? "今日比赛" : "未来比赛", response, summary, true);
  }

  renderNews(response: ToolResponse<never, NewsItem>): string {
    if (response.error) {
      return this.renderError("新闻集合", response);
    }

    const summary = this.summaryService.summarizeNews(response);
    const timezone = (response.query.timezone as string) || "Asia/Shanghai";
    const lines = response.items?.length
      ? response.items
          .map(
            (item, index) =>
              `${index + 1}. ${item.title}${item.published_at ? ` — ${formatDateTime(item.published_at, timezone)}` : ""}`
          )
          .join("\n")
      : "暂无新闻数据";

    return [
      "【新闻集合】",
      "",
      lines,
      "",
      "【中文总结】",
      summary,
      "",
      ...this.renderReasonSection(response),
      `【更新时间】${formatDateTime(response.meta.fetched_at, timezone)}`,
      `【来源】${response.meta.source}${response.meta.stale ? "（缓存回退）" : ""}`
    ].join("\n");
  }

  renderResolveResult(
    title: string,
    response: ToolResponse<never, ResolvedTeamEntity | ResolvedPlayerEntity>
  ): string {
    if (response.error) {
      return this.renderError(title, response);
    }

    const items = response.items ?? [];
    return [
      `【${title}】`,
      ...items.map(
        (item, index) =>
          `${index + 1}. ${item.name} (id=${item.id}${"country" in item && item.country ? `, country=${item.country}` : ""})`
      ),
      "",
      `【更新时间】${formatDateTime(response.meta.fetched_at, response.meta.timezone)}`,
      `【来源】${response.meta.source}`
    ].join("\n");
  }

  private renderMatchList(
    title: string,
    response: ToolResponse<never, NormalizedMatch>,
    summary: string,
    scheduled: boolean
  ): string {
    if (response.error) {
      return this.renderError(title, response);
    }

    const timezone = (response.query.timezone as string) || "Asia/Shanghai";
    const emptyText = scheduled ? "暂无匹配赛程" : "暂无比赛数据";
    const lines = response.items?.length
      ? response.items
          .map((item, index) => {
            const timeValue = scheduled ? item.scheduled_at : item.played_at;
            const team1 = formatTeamDisplayName(item.team1) ?? item.team1 ?? "TBD";
            const team2 = formatTeamDisplayName(item.team2) ?? item.team2 ?? "TBD";
            const event = formatEventDisplayName(item.event) ?? item.event;
            return `${index + 1}. ${team1} vs ${team2}${item.score ? ` — ${item.score}` : ""}${event ? ` — ${event}` : ""}${timeValue ? ` — ${formatDateTime(timeValue, timezone)}` : ""}`;
          })
          .join("\n")
      : emptyText;

    return [
      `【${title}】`,
      "",
      lines,
      "",
      "【中文总结】",
      summary,
      "",
      ...this.renderReasonSection(response),
      `【更新时间】${formatDateTime(response.meta.fetched_at, timezone)}`,
      `【来源】${response.meta.source}${response.meta.stale ? "（缓存回退）" : ""}`
    ].join("\n");
  }

  private renderError(title: string, response: ToolResponse): string {
    const details = response.error?.details;
    const detailLines = [
      typeof details?.path === "string" ? `- 上游路径：${details.path}` : undefined,
      details?.status !== undefined ? `- 上游状态码：${details.status}` : undefined,
      details?.team_id !== undefined ? `- 队伍ID：${details.team_id}` : undefined,
      typeof details?.team_name === "string" ? `- 队伍参数：${details.team_name}` : undefined,
      details?.player_id !== undefined ? `- 选手ID：${details.player_id}` : undefined,
      typeof details?.player_name === "string" ? `- 选手参数：${details.player_name}` : undefined
    ].filter(Boolean);

    return [
      `【${title}】`,
      `请求失败：${response.error?.code ?? "UNKNOWN"}`,
      response.error?.message ?? "未知错误",
      ...detailLines,
      ...(response.meta.notes?.map((note) => `- 原因：${note}`) ?? []),
      response.meta.stale ? "已尝试使用缓存回退。" : "",
      `【更新时间】${formatDateTime(response.meta.fetched_at, response.meta.timezone)}`,
      `【来源】${response.meta.source}`
    ]
      .filter(Boolean)
      .join("\n");
  }

  private renderReasonSection(response: ToolResponse): string[] {
    const notes = response.meta.notes ?? [];
    if (!notes.length) {
      return [];
    }

    return ["【原因说明】", ...notes.map((note) => `- ${note}`), ""];
  }
}
