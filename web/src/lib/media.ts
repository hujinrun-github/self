import type { MediaMap, MediaVariant } from "./types";

const mediaURLPattern = /^media:\/\/asset\/(\d+)\/([a-z_][a-z0-9_-]*)$/;
const githubRawURLPattern = /https:\/\/raw\.githubusercontent\.com\/[^\s<>"')]+/gi;

export function resolveMediaURL(
  value: string | undefined,
  media: MediaMap,
): MediaVariant | null {
  if (!value) {
    return null;
  }
  const match = value.match(mediaURLPattern);
  if (!match) {
    return null;
  }
  const [, id, variant] = match;
  return media[id]?.[variant] ?? null;
}

export function isSafeLink(href: string | undefined): boolean {
  if (!href) {
    return false;
  }
  const value = href.trim().toLowerCase();
  return (
    value.startsWith("/") ||
    value.startsWith("#") ||
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("mailto:")
  ) && !value.startsWith("//");
}

export function resolveRemoteImageURL(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }

  if (url.protocol !== "https:" || url.hostname !== "raw.githubusercontent.com") {
    return value;
  }

  const [owner, repository, ref, ...pathParts] = url.pathname.split("/").filter(Boolean);
  if (!owner || !repository || !ref || pathParts.length === 0) {
    return value;
  }

  return `https://cdn.jsdelivr.net/gh/${owner}/${repository}@${ref}/${pathParts.join("/")}${url.search}${url.hash}`;
}

export function rewriteRemoteImageURLs(value: string): string {
  return value.replace(githubRawURLPattern, (url) => resolveRemoteImageURL(url) ?? url);
}
