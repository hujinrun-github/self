import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { isSafeLink, resolveMediaURL } from "../../lib/media";
import type { MediaMap, MediaVariant } from "../../lib/types";
import styles from "./MarkdownView.module.css";

type MarkdownViewProps = {
  markdown: string;
  media: MediaMap;
};

export function MarkdownView({ markdown, media }: MarkdownViewProps) {
  const { safeMarkdown, variantsByURL } = rewriteMediaReferences(markdown, media);

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
