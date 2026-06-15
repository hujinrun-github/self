import type { MediaMap, MediaVariant } from "./types";

const mediaURLPattern = /^media:\/\/asset\/(\d+)\/([a-z_][a-z0-9_-]*)$/;

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
