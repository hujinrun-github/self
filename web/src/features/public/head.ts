import { useEffect } from "react";

type AlternateLink = {
  href: string;
  hreflang: string;
};

type PublicPageMeta = {
  alternates?: AlternateLink[];
  canonicalPath: string;
  description?: string;
  robots?: string;
  title: string;
};

export function usePublicPageMeta(meta: PublicPageMeta) {
  const alternates = meta.alternates ?? [];
  useEffect(() => {
    document.title = meta.title;
    syncLink("canonical", absoluteURL(meta.canonicalPath));
    syncMeta("description", meta.description ?? "");
    syncMeta("robots", meta.robots ?? "");
    syncAlternates(alternates);
  }, [alternates, meta.canonicalPath, meta.description, meta.robots, meta.title]);
}

function syncMeta(name: string, content: string) {
  const selector = `meta[name="${name}"]`;
  const existing = document.head.querySelector(selector);
  if (!content) {
    existing?.remove();
    return;
  }
  const element = existing ?? document.createElement("meta");
  element.setAttribute("name", name);
  element.setAttribute("content", content);
  if (!existing) {
    document.head.appendChild(element);
  }
}

function syncLink(rel: string, href: string) {
  const selector = `link[rel="${rel}"]`;
  const existing = document.head.querySelector(selector);
  if (!href) {
    existing?.remove();
    return;
  }
  const element = existing ?? document.createElement("link");
  element.setAttribute("rel", rel);
  element.setAttribute("href", href);
  if (!existing) {
    document.head.appendChild(element);
  }
}

function syncAlternates(alternates: AlternateLink[]) {
  document.head.querySelectorAll('link[rel="alternate"][data-public-alternate="true"]').forEach((node) => node.remove());
  for (const alternate of alternates) {
    if (!alternate.hreflang || !alternate.href) {
      continue;
    }
    const element = document.createElement("link");
    element.setAttribute("rel", "alternate");
    element.setAttribute("hreflang", alternate.hreflang);
    element.setAttribute("href", absoluteURL(alternate.href));
    element.setAttribute("data-public-alternate", "true");
    document.head.appendChild(element);
  }
}

function absoluteURL(pathOrURL: string) {
  if (!pathOrURL) {
    return "";
  }
  return new URL(pathOrURL, window.location.origin).toString();
}
