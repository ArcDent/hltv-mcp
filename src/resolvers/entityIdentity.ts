import type { ResolvedPlayerEntity, ResolvedTeamEntity } from "../types/hltv.js";
import { parseHltvEntityLink, slugify } from "../utils/strings.js";

type ResolvedEntity = ResolvedPlayerEntity | ResolvedTeamEntity;

export interface NormalizedLookupName {
  raw: string;
  strict: string;
  loose: string;
  slug: string;
  tokens: string[];
}

const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;
const QUOTE_RE = /[’‘＇`]/g;
const DOUBLE_QUOTE_RE = /[“”]/g;
const DASH_RE = /[—–‐‑]/g;
const SEPARATOR_RE = /[_/]+/g;
const SPACE_RE = /\s+/g;
const STRIP_PUNCTUATION_RE = /['".,()[\]{}]/g;

export function normalizeLookupName(input: string): NormalizedLookupName {
  const raw = String(input ?? "");

  const prepared = raw
    .normalize("NFKC")
    .replace(ZERO_WIDTH_RE, "")
    .replace(QUOTE_RE, "'")
    .replace(DOUBLE_QUOTE_RE, '"')
    .replace(DASH_RE, "-")
    .replace(SEPARATOR_RE, " ")
    .trim()
    .replace(SPACE_RE, " ");

  const strict = prepared.toLocaleLowerCase("en-US");
  const loose = strict.replace(STRIP_PUNCTUATION_RE, " ").replace(/-/g, " ").replace(SPACE_RE, " ").trim();
  const slug = loose.replace(SPACE_RE, "-");

  return {
    raw,
    strict,
    loose,
    slug,
    tokens: loose.split(" ").filter(Boolean)
  };
}

export function uniqueStrings(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    if (!value) {
      continue;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }

    const key = trimmed.toLocaleLowerCase("en-US");
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    out.push(trimmed);
  }

  return out;
}

export function buildQueryVariants(name: string, aliasDictionary: Record<string, string[]>): string[] {
  const normalized = normalizeLookupName(name);
  const aliasKeys = uniqueStrings([name, normalized.strict, normalized.loose, normalized.slug]).map((item) =>
    item.toLocaleLowerCase("en-US")
  );
  const aliasVariants = aliasKeys.flatMap((key) => aliasDictionary[key] ?? []);

  return uniqueStrings([
    name,
    normalized.strict,
    normalized.loose,
    normalized.slug,
    normalized.tokens.join(" "),
    normalized.tokens.join("-"),
    normalized.tokens.join("_"),
    normalized.tokens.join(""),
    ...aliasVariants
  ]);
}

export function buildSlugCandidates(
  entityType: "team" | "player",
  id: number,
  preferredSlug: string | undefined,
  rawHints: Array<string | undefined>
): string[] {
  const out: string[] = [];

  const push = (value: string | undefined) => {
    if (!value) {
      return;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    out.push(trimmed);

    const normalized = normalizeLookupName(trimmed);
    if (normalized.slug) {
      out.push(normalized.slug);
    }

    const slugified = slugify(trimmed);
    if (slugified) {
      out.push(slugified);
    }

    const parsed = parseHltvEntityLink(trimmed, entityType);
    if (parsed.slug) {
      out.push(parsed.slug);
    }
  };

  push(preferredSlug);

  for (const hint of rawHints) {
    push(hint);
  }

  out.push(String(id));
  return uniqueStrings(out);
}

interface EntityWithAliases {
  id: number;
  name: string;
  slug: string;
  aliases?: string[];
}

export class EntityDirectory<T extends EntityWithAliases> {
  private readonly byId = new Map<number, T>();
  private readonly aliasIds = new Map<string, Set<number>>();

  constructor(seed: T[] = []) {
    for (const entity of seed) {
      this.remember(entity, entity.aliases ?? []);
    }
  }

  getById(id: number): T | undefined {
    return this.byId.get(id);
  }

  findByAlias(name: string): T[] {
    const normalized = normalizeLookupName(name);
    const ids = new Set<number>();

    for (const key of uniqueStrings([normalized.strict, normalized.loose, normalized.slug])) {
      for (const id of this.aliasIds.get(key) ?? []) {
        ids.add(id);
      }
    }

    return [...ids]
      .map((id) => this.byId.get(id))
      .filter((item): item is T => Boolean(item));
  }

  remember(entity: T, extraAliases: string[] = []): T {
    const existing = this.byId.get(entity.id);
    const aliases = uniqueStrings([...(existing?.aliases ?? []), ...(entity.aliases ?? []), ...extraAliases]);

    const merged = {
      ...(existing ?? {}),
      ...entity,
      aliases: aliases.length ? aliases : undefined
    } as T;

    this.byId.set(merged.id, merged);

    for (const alias of uniqueStrings([merged.name, merged.slug, ...(merged.aliases ?? [])])) {
      const normalized = normalizeLookupName(alias);
      for (const key of uniqueStrings([normalized.strict, normalized.loose, normalized.slug])) {
        const ids = this.aliasIds.get(key) ?? new Set<number>();
        ids.add(merged.id);
        this.aliasIds.set(key, ids);
      }
    }

    return merged;
  }
}

export function entityAliases(entity: ResolvedEntity): string[] {
  return uniqueStrings([entity.name, entity.slug, ...(entity.aliases ?? [])]);
}
