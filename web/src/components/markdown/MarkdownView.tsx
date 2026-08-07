import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { isSafeLink, resolveMediaURL, resolveRemoteImageURL } from "../../lib/media";
import type { MediaMap, MediaVariant } from "../../lib/types";
import styles from "./MarkdownView.module.css";

type MarkdownViewProps = {
  headingIDs?: string[];
  markdown: string;
  media: MediaMap;
};

export function MarkdownView({ headingIDs, markdown, media }: MarkdownViewProps) {
  const { safeMarkdown, variantsByURL } = rewriteMediaReferences(
    normalizeLooseImageReferences(markdown),
    media,
  );
  let headingIDIndex = 0;

  function nextHeadingID() {
    return headingIDs?.[headingIDIndex++];
  }

  const components: Components = {
    a({ href, children }) {
      const resolvedHref = resolveMediaURL(href, media)?.url ?? href;
      if (!isSafeLink(resolvedHref)) {
        return <a>{children}</a>;
      }
      const external =
        resolvedHref?.startsWith("http://") || resolvedHref?.startsWith("https://");
      return (
        <a
          href={resolvedHref}
          rel={external ? "noopener noreferrer" : undefined}
          target={external ? "_blank" : undefined}
        >
          {children}
        </a>
      );
    },
    img({ src, alt }) {
      const variant = src ? variantsByURL[src] : undefined;
      const remoteSrc = resolveRemoteImageURL(src);
      if (!variant && isSafeRemoteImage(remoteSrc)) {
        return (
          <img
            alt={alt ?? ""}
            className={styles.image}
            decoding="async"
            loading="lazy"
            referrerPolicy="no-referrer"
            src={remoteSrc}
          />
        );
      }
      if (!variant) {
        return null;
      }
      return (
        <img
          alt={alt ?? ""}
          className={styles.image}
          decoding="async"
          height={variant.height}
          loading="lazy"
          src={variant.url}
          width={variant.width}
        />
      );
    },
    h1({ children }) {
      return <h1 id={nextHeadingID()}>{children}</h1>;
    },
    h2({ children }) {
      return <h2 id={nextHeadingID()}>{children}</h2>;
    },
    h3({ children }) {
      return <h3 id={nextHeadingID()}>{children}</h3>;
    },
  };

  return (
    <div className={styles.prose}>
      <ReactMarkdown
        components={components}
        rehypePlugins={[rehypeSanitize]}
        remarkPlugins={[remarkGfm]}
        skipHtml
      >
        {safeMarkdown}
      </ReactMarkdown>
    </div>
  );
}

function rewriteMediaReferences(markdown: string, media: MediaMap) {
  const variantsByURL: Record<string, MediaVariant> = {};
  const withImages = markdown.replace(
    /!\[([^\]]*)\]\((media:\/\/asset\/(\d+)\/([a-zA-Z0-9_-]+))\)/g,
    (match, alt: string, _url: string, id: string, variantName: string) => {
      const variant = resolveMediaURL(`media://asset/${id}/${variantName}`, media);
      if (!variant) {
        return match;
      }
      variantsByURL[variant.url] = variant;
      return `![${alt}](${variant.url})`;
    },
  );
  const safeMarkdown = withImages.replace(
    /(^|[^!])\[([^\]]*)\]\((media:\/\/asset\/(\d+)\/([a-zA-Z0-9_-]+))\)/g,
    (match, prefix: string, label: string, _url: string, id: string, variantName: string) => {
      const variant = resolveMediaURL(`media://asset/${id}/${variantName}`, media);
      if (!variant) {
        return match;
      }
      return `${prefix}[${label}](${variant.url})`;
    },
  );
  return { safeMarkdown, variantsByURL };
}

function normalizeLooseImageReferences(markdown: string) {
  return markdown.replace(
    /!\[([^\]\r\n]*)\][ \t]*(?:\r?\n[ \t]*)+\((https:\/\/[^\s)]+|media:\/\/asset\/\d+\/[a-zA-Z0-9_-]+)\)/g,
    "![$1]($2)",
  );
}

function isSafeRemoteImage(src: string | undefined) {
  return Boolean(src?.trim().toLowerCase().startsWith("https://"));
}
