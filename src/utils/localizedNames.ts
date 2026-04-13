import { normalizeLookupName, uniqueStrings } from "../resolvers/entityIdentity.js";
import { sanitizeHltvText } from "./strings.js";

type NameKind = "team" | "event";

interface LocalizationDefinition {
  canonicalEnglish: string;
  officialZh?: string;
  colloquialZh?: string;
  aliases?: string[];
}

interface CatalogEntry extends LocalizationDefinition {
  matchKeys: string[];
}

const TEAM_LOCALIZATIONS: LocalizationDefinition[] = [
  {
    canonicalEnglish: "Vitality",
    officialZh: "Vitality战队",
    colloquialZh: "小蜜蜂",
    aliases: ["Team Vitality", "Vitality", "小蜜蜂", "蜜蜂"]
  },
  {
    canonicalEnglish: "Team Spirit",
    officialZh: "Spirit战队",
    colloquialZh: "雪碧",
    aliases: ["Spirit", "Team Spirit", "雪碧"]
  },
  {
    canonicalEnglish: "Natus Vincere",
    officialZh: "Natus Vincere战队",
    colloquialZh: "NaVi",
    aliases: ["Natus Vincere", "NaVi", "NAVI"]
  },
  {
    canonicalEnglish: "G2",
    officialZh: "G2 Esports战队",
    colloquialZh: "武士",
    aliases: ["G2", "G2 Esports", "武士"]
  },
  {
    canonicalEnglish: "MOUZ",
    officialZh: "MOUZ战队",
    colloquialZh: "老鼠",
    aliases: ["MOUZ", "mouz", "老鼠"]
  },
  {
    canonicalEnglish: "FaZe",
    officialZh: "FaZe Clan战队",
    aliases: ["FaZe", "FaZe Clan"]
  },
  {
    canonicalEnglish: "Falcons",
    officialZh: "Falcons战队",
    colloquialZh: "猎鹰",
    aliases: ["Falcons", "Team Falcons", "猎鹰"]
  },
  {
    canonicalEnglish: "Astralis",
    officialZh: "Astralis战队",
    colloquialZh: "A队",
    aliases: ["Astralis", "A队"]
  },
  {
    canonicalEnglish: "Virtus.pro",
    officialZh: "Virtus.pro战队",
    colloquialZh: "VP",
    aliases: ["Virtus.pro", "Virtus Pro", "VP"]
  },
  {
    canonicalEnglish: "Team Liquid",
    officialZh: "Liquid战队",
    colloquialZh: "液体",
    aliases: ["Team Liquid", "Liquid", "液体"]
  },
  {
    canonicalEnglish: "FURIA",
    officialZh: "FURIA战队",
    colloquialZh: "狂怒",
    aliases: ["FURIA", "狂怒"]
  },
  {
    canonicalEnglish: "Aurora",
    officialZh: "Aurora战队",
    colloquialZh: "极光",
    aliases: ["Aurora", "极光"]
  },
  {
    canonicalEnglish: "HEROIC",
    officialZh: "HEROIC战队",
    aliases: ["HEROIC"]
  },
  {
    canonicalEnglish: "PARIVISION",
    officialZh: "PARIVISION战队",
    aliases: ["PARIVISION"]
  },
  {
    canonicalEnglish: "3DMAX",
    officialZh: "3DMAX战队",
    aliases: ["3DMAX"]
  },
  {
    canonicalEnglish: "paiN",
    officialZh: "paiN Gaming战队",
    colloquialZh: "痛队",
    aliases: ["paiN", "paiN Gaming", "痛队"]
  },
  {
    canonicalEnglish: "GamerLegion",
    officialZh: "GamerLegion战队",
    aliases: ["GamerLegion", "GL"]
  },
  {
    canonicalEnglish: "Complexity",
    officialZh: "Complexity战队",
    colloquialZh: "coL",
    aliases: ["Complexity", "Complexity Gaming", "coL"]
  },
  {
    canonicalEnglish: "Ninjas in Pyjamas",
    officialZh: "Ninjas in Pyjamas战队",
    colloquialZh: "NIP",
    aliases: ["Ninjas in Pyjamas", "NiP", "NIP"]
  },
  {
    canonicalEnglish: "RED Canids",
    officialZh: "RED Canids战队",
    colloquialZh: "红犬",
    aliases: ["RED Canids", "红犬"]
  },
  {
    canonicalEnglish: "Gentle Mates",
    officialZh: "Gentle Mates战队",
    aliases: ["Gentle Mates"]
  },
  {
    canonicalEnglish: "B8",
    officialZh: "B8战队",
    aliases: ["B8"]
  },
  {
    canonicalEnglish: "Legacy",
    officialZh: "Legacy战队",
    colloquialZh: "传承",
    aliases: ["Legacy", "传承"]
  },
  {
    canonicalEnglish: "Passion UA",
    officialZh: "Passion UA战队",
    aliases: ["Passion UA"]
  },
  {
    canonicalEnglish: "HOTU",
    officialZh: "HOTU战队",
    aliases: ["HOTU"]
  },
  {
    canonicalEnglish: "BIG",
    officialZh: "BIG战队",
    aliases: ["BIG"]
  },
  {
    canonicalEnglish: "Eternal Fire",
    officialZh: "Eternal Fire战队",
    colloquialZh: "永火",
    aliases: ["Eternal Fire", "永火"]
  },
  {
    canonicalEnglish: "The MongolZ",
    officialZh: "The MongolZ战队",
    colloquialZh: "蒙古队",
    aliases: ["The MongolZ", "MongolZ", "蒙古队"]
  },
  {
    canonicalEnglish: "TYLOO",
    officialZh: "TYLOO战队",
    colloquialZh: "天禄",
    aliases: ["TYLOO", "天禄"]
  },
  {
    canonicalEnglish: "Rare Atom",
    officialZh: "Rare Atom战队",
    colloquialZh: "RA",
    aliases: ["Rare Atom", "RA"]
  },
  {
    canonicalEnglish: "Lynn Vision",
    officialZh: "Lynn Vision战队",
    colloquialZh: "LVG",
    aliases: ["Lynn Vision", "LVG"]
  },
  {
    canonicalEnglish: "FlyQuest",
    officialZh: "FlyQuest战队",
    aliases: ["FlyQuest"]
  },
  {
    canonicalEnglish: "SAW",
    officialZh: "SAW战队",
    aliases: ["SAW"]
  },
  {
    canonicalEnglish: "fnatic",
    officialZh: "fnatic战队",
    colloquialZh: "橙黑",
    aliases: ["fnatic", "Fnatic", "橙黑"]
  },
  {
    canonicalEnglish: "Alliance",
    officialZh: "Alliance战队",
    colloquialZh: "联盟",
    aliases: ["Alliance", "联盟"]
  },
  {
    canonicalEnglish: "ENCE",
    officialZh: "ENCE战队",
    aliases: ["ENCE"]
  },
  {
    canonicalEnglish: "ECSTATIC",
    officialZh: "ECSTATIC战队",
    aliases: ["ECSTATIC"]
  },
  {
    canonicalEnglish: "EYEBALLERS",
    officialZh: "EYEBALLERS战队",
    aliases: ["EYEBALLERS"]
  },
  {
    canonicalEnglish: "Metizport",
    officialZh: "Metizport战队",
    aliases: ["Metizport"]
  },
  {
    canonicalEnglish: "Johnny Speeds",
    officialZh: "Johnny Speeds战队",
    aliases: ["Johnny Speeds"]
  },
  {
    canonicalEnglish: "SINNERS",
    officialZh: "SINNERS战队",
    colloquialZh: "罪人",
    aliases: ["SINNERS", "罪人"]
  },
  {
    canonicalEnglish: "ESC",
    officialZh: "ESC战队",
    aliases: ["ESC"]
  },
  {
    canonicalEnglish: "Sashi",
    officialZh: "Sashi战队",
    aliases: ["Sashi"]
  },
  {
    canonicalEnglish: "Sashi Academy",
    officialZh: "Sashi Academy战队",
    colloquialZh: "Sashi青训",
    aliases: ["Sashi Academy", "Sashi青训"]
  },
  {
    canonicalEnglish: "Young Ninjas",
    officialZh: "Young Ninjas战队",
    colloquialZh: "小忍者",
    aliases: ["Young Ninjas", "小忍者"]
  },
  {
    canonicalEnglish: "MOUZ NXT",
    officialZh: "MOUZ NXT战队",
    colloquialZh: "小老鼠",
    aliases: ["MOUZ NXT", "小老鼠"]
  },
  {
    canonicalEnglish: "HEROIC Academy",
    officialZh: "HEROIC Academy战队",
    colloquialZh: "HEROIC青训",
    aliases: ["HEROIC Academy", "HEROIC青训"]
  },
  {
    canonicalEnglish: "ex-RUBY",
    officialZh: "ex-RUBY战队",
    aliases: ["ex-RUBY"]
  },
  {
    canonicalEnglish: "Tricked",
    officialZh: "Tricked战队",
    aliases: ["Tricked"]
  },
  {
    canonicalEnglish: "Phantom",
    officialZh: "Phantom战队",
    aliases: ["Phantom"]
  },
  {
    canonicalEnglish: "Clutchain",
    officialZh: "Clutchain战队",
    aliases: ["Clutchain"]
  },
  {
    canonicalEnglish: "Qual4",
    officialZh: "Qual4战队",
    aliases: ["Qual4"]
  },
  {
    canonicalEnglish: "Aether",
    officialZh: "Aether战队",
    aliases: ["Aether"]
  },
  {
    canonicalEnglish: "ARCRED",
    officialZh: "ARCRED战队",
    aliases: ["ARCRED"]
  },
  {
    canonicalEnglish: "AaB",
    officialZh: "AaB战队",
    aliases: ["AaB"]
  },
  {
    canonicalEnglish: "BOSS",
    officialZh: "BOSS战队",
    aliases: ["BOSS"]
  },
  {
    canonicalEnglish: "CYBERSHOKE Prospects",
    officialZh: "CYBERSHOKE Prospects战队",
    colloquialZh: "CYBERSHOKE青训",
    aliases: ["CYBERSHOKE Prospects", "CYBERSHOKE青训"]
  },
  {
    canonicalEnglish: "DXA",
    officialZh: "DXA战队",
    aliases: ["DXA"]
  },
  {
    canonicalEnglish: "FUT",
    officialZh: "FUT战队",
    aliases: ["FUT"]
  },
  {
    canonicalEnglish: "GenOne",
    officialZh: "GenOne战队",
    aliases: ["GenOne"]
  },
  {
    canonicalEnglish: "Keyd Stars",
    officialZh: "Keyd Stars战队",
    aliases: ["Keyd Stars"]
  },
  {
    canonicalEnglish: "Marsborne",
    officialZh: "Marsborne战队",
    aliases: ["Marsborne"]
  },
  {
    canonicalEnglish: "Nemesis",
    officialZh: "Nemesis战队",
    aliases: ["Nemesis"]
  },
  {
    canonicalEnglish: "Persona Grata",
    officialZh: "Persona Grata战队",
    aliases: ["Persona Grata"]
  },
  {
    canonicalEnglish: "QWENTRY",
    officialZh: "QWENTRY战队",
    aliases: ["QWENTRY"]
  },
  {
    canonicalEnglish: "Rooster",
    officialZh: "Rooster战队",
    colloquialZh: "公鸡",
    aliases: ["Rooster", "公鸡"]
  },
  {
    canonicalEnglish: "TNC",
    officialZh: "TNC战队",
    aliases: ["TNC"]
  },
  {
    canonicalEnglish: "UNiTY",
    officialZh: "UNiTY战队",
    aliases: ["UNiTY"]
  },
  {
    canonicalEnglish: "WAZABI",
    officialZh: "WAZABI战队",
    aliases: ["WAZABI"]
  },
  {
    canonicalEnglish: "Young TigeRES",
    officialZh: "Young TigeRES战队",
    colloquialZh: "小老虎",
    aliases: ["Young TigeRES", "小老虎"]
  },
  {
    canonicalEnglish: "Chinggis Warriors",
    officialZh: "Chinggis Warriors战队",
    colloquialZh: "成吉思勇士",
    aliases: ["Chinggis Warriors", "成吉思勇士"]
  }
];

const DIRECT_EVENT_LOCALIZATIONS: LocalizationDefinition[] = [
  {
    canonicalEnglish: "IEM Rio",
    officialZh: "IEM 里约站",
    colloquialZh: "里约IEM",
    aliases: ["IEM Rio", "IEM里约", "里约IEM", "里约"]
  },
  {
    canonicalEnglish: "PGL Astana",
    officialZh: "PGL 阿斯塔纳站",
    colloquialZh: "阿斯塔纳PGL",
    aliases: ["PGL Astana", "PGL阿斯塔纳", "阿斯塔纳PGL"]
  },
  {
    canonicalEnglish: "BLAST Open Lisbon",
    officialZh: "BLAST Open 里斯本站",
    colloquialZh: "里斯本BLAST Open",
    aliases: ["BLAST Open Lisbon", "BLAST里斯本", "里斯本BLAST"]
  },
  {
    canonicalEnglish: "European Pro League Series 6",
    officialZh: "欧洲职业联赛第6季",
    colloquialZh: "欧职联S6",
    aliases: ["European Pro League Series 6", "European Pro League", "欧洲职业联赛", "欧职联"]
  },
  {
    canonicalEnglish: "Tipsport Conquest of Prague 2026",
    officialZh: "Tipsport布拉格征服赛2026",
    colloquialZh: "布拉格征服赛",
    aliases: ["Tipsport Conquest of Prague 2026", "Tipsport Prague", "布拉格征服赛", "Tipsport布拉格"]
  },
  {
    canonicalEnglish: "BLAST Rivals 2026 Season 1",
    officialZh: "BLAST Rivals 2026第1赛季",
    colloquialZh: "BLAST群雄赛",
    aliases: ["BLAST Rivals 2026 Season 1", "BLAST Rivals", "BLAST群雄赛"]
  },
  {
    canonicalEnglish: "BetBoom Storm Season 2",
    officialZh: "BetBoom Storm第2赛季",
    aliases: ["BetBoom Storm Season 2", "BetBoom Storm"]
  },
  {
    canonicalEnglish: "CCT 2026 Contenders Europe Series 4",
    officialZh: "CCT 2026欧洲挑战者系列赛第4站",
    aliases: ["CCT 2026 Contenders Europe Series 4", "CCT欧洲挑战者", "CCT挑战者欧洲站"]
  },
  {
    canonicalEnglish: "CCT Season 3 Europe Series 20",
    officialZh: "CCT第3季欧洲系列赛第20站",
    aliases: ["CCT Season 3 Europe Series 20", "CCT欧洲系列赛", "CCT欧洲站"]
  },
  {
    canonicalEnglish: "CCT Season 3 North America Series 4",
    officialZh: "CCT第3季北美系列赛第4站",
    aliases: ["CCT Season 3 North America Series 4", "CCT北美系列赛", "CCT北美站"]
  },
  {
    canonicalEnglish: "DFRAG Open Series 4",
    officialZh: "DFRAG公开系列赛第4站",
    aliases: ["DFRAG Open Series 4", "DFRAG公开赛"]
  },
  {
    canonicalEnglish: "Dust2.us Eagle Masters Series 7",
    officialZh: "Dust2.us雄鹰大师赛第7季",
    aliases: ["Dust2.us Eagle Masters Series 7", "Dust2.us Eagle Masters", "雄鹰大师赛"]
  },
  {
    canonicalEnglish: "ESL Challenger League Season 51 Asia-Pacific Cup 3",
    officialZh: "ESL挑战者联赛第51季亚太杯第3站",
    aliases: ["ESL Challenger League Season 51 Asia-Pacific Cup 3", "ESL挑战者联赛亚太杯", "ESL亚太杯"]
  },
  {
    canonicalEnglish: "ESL Challenger League Season 51 Europe Cup 3",
    officialZh: "ESL挑战者联赛第51季欧洲杯第3站",
    aliases: ["ESL Challenger League Season 51 Europe Cup 3", "ESL挑战者联赛欧洲杯", "ESL欧洲杯"]
  },
  {
    canonicalEnglish: "ESL Challenger League Season 51 North America Cup 3",
    officialZh: "ESL挑战者联赛第51季北美杯第3站",
    aliases: ["ESL Challenger League Season 51 North America Cup 3", "ESL挑战者联赛北美杯", "ESL北美杯"]
  },
  {
    canonicalEnglish: "ESL Challenger League Season 51 South America Cup 3",
    officialZh: "ESL挑战者联赛第51季南美杯第3站",
    aliases: ["ESL Challenger League Season 51 South America Cup 3", "ESL挑战者联赛南美杯", "ESL南美杯"]
  },
  {
    canonicalEnglish: "Elisa Open Finland Season 12",
    officialZh: "Elisa芬兰公开赛第12季",
    aliases: ["Elisa Open Finland Season 12", "Elisa Open Finland", "Elisa芬兰公开赛"]
  },
  {
    canonicalEnglish: "LORGAR RANKINGS Season 1 Closed Qualifier",
    officialZh: "LORGAR RANKINGS第1季封闭预选赛",
    aliases: ["LORGAR RANKINGS Season 1 Closed Qualifier", "LORGAR封闭预选赛"]
  },
  {
    canonicalEnglish: "NODWIN Clutch Series 7 Closed Qualifier",
    officialZh: "NODWIN Clutch第7季封闭预选赛",
    aliases: ["NODWIN Clutch Series 7 Closed Qualifier", "NODWIN Clutch", "NODWIN封闭预选赛"]
  }
];

const EVENT_LOCATION_TRANSLATIONS: Record<string, string> = {
  "rio de janeiro": "里约",
  rio: "里约",
  astana: "阿斯塔纳",
  bucharest: "布加勒斯特",
  lisbon: "里斯本",
  prague: "布拉格",
  katowice: "卡托维兹",
  cologne: "科隆",
  dallas: "达拉斯",
  melbourne: "墨尔本",
  shanghai: "上海",
  chengdu: "成都",
  copenhagen: "哥本哈根",
  austin: "奥斯汀"
};

const TEAM_CATALOG = buildCatalog(TEAM_LOCALIZATIONS);
const DIRECT_EVENT_CATALOG = buildCatalog(DIRECT_EVENT_LOCALIZATIONS);
const SORTED_EVENT_LOCATIONS = Object.entries(EVENT_LOCATION_TRANSLATIONS).sort(
  ([left], [right]) => right.length - left.length
);

function buildCatalog(definitions: LocalizationDefinition[]): CatalogEntry[] {
  return definitions.map((definition) => ({
    ...definition,
    matchKeys: uniqueStrings([
      definition.canonicalEnglish,
      definition.officialZh,
      definition.colloquialZh,
      ...(definition.aliases ?? [])
    ])
  }));
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isAliasMatch(source: string, query: string): boolean {
  return scoreAliasMatch(source, query) > 0;
}

function scoreAliasMatch(source: string, query: string): number {
  const candidate = normalizeLookupName(source);
  const target = normalizeLookupName(query);
  const candidateCompact = candidate.loose.replace(/\s+/g, "");
  const targetCompact = target.loose.replace(/\s+/g, "");

  if (
    candidate.strict === target.strict ||
    candidate.loose === target.loose ||
    candidate.slug === target.slug ||
    (candidateCompact && candidateCompact === targetCompact)
  ) {
    return 100;
  }

  if (!candidateCompact || !targetCompact) {
    return 0;
  }

  const minLength = Math.min(candidateCompact.length, targetCompact.length);
  if (minLength < 2) {
    return 0;
  }

  if (targetCompact.length >= 4 && candidateCompact.includes(targetCompact)) {
    return 70;
  }

  if (candidateCompact.length >= 4 && targetCompact.includes(candidateCompact)) {
    return 60;
  }

  return 0;
}

function findCatalogMatch(name: string, catalog: CatalogEntry[]): LocalizationDefinition | undefined {
  let bestScore = 0;
  let bestEntry: LocalizationDefinition | undefined;

  for (const entry of catalog) {
    const score = Math.max(0, ...entry.matchKeys.map((key) => scoreAliasMatch(key, name)));
    if (score > bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  }

  return bestEntry;
}

function deriveEventLocalization(name: string): LocalizationDefinition | undefined {
  const sanitized = sanitizeHltvText(name);
  if (!sanitized) {
    return undefined;
  }

  const direct = findCatalogMatch(sanitized, DIRECT_EVENT_CATALOG);
  if (direct) {
    return direct;
  }

  for (const [locationEn, locationZh] of SORTED_EVENT_LOCATIONS) {
    const pattern = new RegExp(`^(?<series>.+?)\\s+${escapeRegex(locationEn)}(?:\\s+(?<year>\\d{4}))?$`, "i");
    const matched = sanitized.match(pattern);
    const series = sanitizeHltvText(matched?.groups?.series);
    const year = matched?.groups?.year;
    if (!series) {
      continue;
    }

    return {
      canonicalEnglish: sanitized,
      officialZh: `${series} ${locationZh}站${year ? ` ${year}` : ""}`,
      colloquialZh: `${locationZh}${series}`,
      aliases: uniqueStrings([
        sanitized,
        `${series} ${locationZh}`,
        `${series}${locationZh}`,
        `${locationZh}${series}`,
        `${locationZh} ${series}`,
        `${locationZh}`,
        `${series} ${locationEn}`,
        `${series}${locationEn}`,
        `${series} ${locationZh}${year ? ` ${year}` : ""}`,
        `${locationZh}${series}${year ? ` ${year}` : ""}`
      ])
    };
  }

  return undefined;
}

function lookupLocalization(name: string | undefined, kind: NameKind): LocalizationDefinition | undefined {
  const sanitized = sanitizeHltvText(name);
  if (!sanitized) {
    return undefined;
  }

  if (kind === "team") {
    return (
      findCatalogMatch(sanitized, TEAM_CATALOG) ?? {
        canonicalEnglish: sanitized,
        officialZh: `${sanitized}战队`,
        aliases: [sanitized, `${sanitized}战队`]
      }
    );
  }

  return deriveEventLocalization(sanitized);
}

function expandAliases(name: string | undefined, kind: NameKind): string[] {
  const sanitized = sanitizeHltvText(name);
  if (!sanitized) {
    return [];
  }

  const localization = lookupLocalization(sanitized, kind);
  return uniqueStrings([
    sanitized,
    localization?.canonicalEnglish,
    localization?.officialZh,
    localization?.colloquialZh,
    ...(localization?.aliases ?? [])
  ]);
}

function formatDisplayName(name: string | undefined, kind: NameKind): string | undefined {
  const sanitized = sanitizeHltvText(name);
  if (!sanitized) {
    return undefined;
  }

  const localization = lookupLocalization(sanitized, kind);
  if (!localization) {
    return sanitized;
  }

  return uniqueStrings([sanitized, localization.officialZh, localization.colloquialZh]).join("/");
}

function aliasesOverlap(left: string[], right: string[]): boolean {
  return left.some((source) => right.some((query) => isAliasMatch(source, query)));
}

export function expandTeamAliases(name: string | undefined): string[] {
  return expandAliases(name, "team");
}

export function expandEventAliases(name: string | undefined): string[] {
  return expandAliases(name, "event");
}

export function formatTeamDisplayName(name: string | undefined): string | undefined {
  return formatDisplayName(name, "team");
}

export function formatEventDisplayName(name: string | undefined): string | undefined {
  return formatDisplayName(name, "event");
}

export function matchTeamNames(candidates: Array<string | undefined>, queryNames: Array<string | undefined>): boolean {
  const candidateAliases = uniqueStrings(candidates.flatMap((candidate) => expandTeamAliases(candidate)));
  const queryAliases = uniqueStrings(queryNames.flatMap((query) => expandTeamAliases(query)));
  if (!candidateAliases.length || !queryAliases.length) {
    return false;
  }

  return aliasesOverlap(candidateAliases, queryAliases);
}

export function matchEventName(source: string | undefined, query: string | undefined): boolean {
  const sourceAliases = expandEventAliases(source);
  const queryAliases = expandEventAliases(query);
  if (!sourceAliases.length || !queryAliases.length) {
    return false;
  }

  return aliasesOverlap(sourceAliases, queryAliases);
}
