export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseHltvEntityLink(
  link: string | undefined,
  entityType: "team" | "player"
): {
  id?: number;
  slug?: string;
  path?: string;
} {
  if (!link) {
    return {};
  }

  let normalized = link.trim();

  try {
    if (/^https?:\/\//i.test(normalized)) {
      normalized = new URL(normalized).pathname;
    }
  } catch {
    return {};
  }

  const match = normalized.match(new RegExp(`/${entityType}/(\\d+)/([^/?#]+)`, "i"));
  if (!match) {
    return {};
  }

  const id = Number(match[1]);
  if (!Number.isFinite(id)) {
    return {};
  }

  let slug = match[2];
  try {
    slug = decodeURIComponent(slug);
  } catch {
    // Ignore decode failures and keep the raw slug.
  }

  return {
    id,
    slug,
    path: match[0]
  };
}

export function includesIgnoreCase(source: string | undefined, needle: string | undefined): boolean {
  if (!source || !needle) {
    return false;
  }

  return source.toLowerCase().includes(needle.toLowerCase());
}

export function equalsIgnoreCase(source: string | undefined, needle: string | undefined): boolean {
  if (!source || !needle) {
    return false;
  }

  return source.toLowerCase() === needle.toLowerCase();
}

export function truncate(input: string, maxLength: number): string {
  return input.length <= maxLength ? input : `${input.slice(0, maxLength - 1)}…`;
}

export function toTitle(input: string): string {
  if (!input) {
    return input;
  }

  return input.charAt(0).toUpperCase() + input.slice(1);
}
