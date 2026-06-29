import { ArrowRight, FolderCode, NotebookPen, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";

import { apiFetch } from "../../lib/api";
import { usePublicPageMeta } from "./head";
import { PublicLayout } from "./PublicLayout";
import { type Locale, coerceLocale, publicLocaleCopy, withLocale, withLocaleQuery } from "./locale";
import styles from "./Public.module.css";

type Resource = "projects" | "writing";

type Term = {
  name?: string;
  slug?: string;
};

type Item = {
  id: number;
  title: string;
  slug: string;
  summary?: string;
  excerpt?: string;
  featured?: boolean;
  published_at?: string | null;
  tags?: Term[];
  techs?: Term[];
};

type LocalizedListResponse = {
  items: Item[];
  requested_locale: string;
  resolved_locale: string;
  fallback_from?: string;
};

type PreviewCard = {
  body: string;
  kicker: string;
  prominent?: boolean;
  title: string;
};

type CollectionEntry = {
  chips: string[];
  description: string;
  href?: string;
  key: string;
  meta: string[];
  prominent?: boolean;
  title: string;
};

type PageCopy = {
  collectionLead: string;
  collectionSupport: string;
  emptyKicker: string;
  eyewrow: string;
  featuredLabel: string;
  heroBody: string;
  heroLead: string;
  heroSupport: string;
  itemLabel: string;
  noteBody: string;
  noteTitle: string;
  primaryHref: string;
  primaryLabel: string;
  sectionTitle: string;
  secondaryHref: string;
  secondaryLabel: string;
  sidebarItems: string[];
  sidebarLead: string;
  sidebarTitle: string;
};

export function PublicListPage({ resource }: { resource: Resource }) {
  const [response, setResponse] = useState<LocalizedListResponse | null>(null);
  const { locale: localeParam } = useParams();
  const location = useLocation();
  const locale = coerceLocale(localeParam);
  const copy = publicLocaleCopy(locale);
  const pageCopy = pageCopyFor(resource, locale);

  useEffect(() => {
    apiFetch<LocalizedListResponse>(withLocaleQuery(`/api/site/${resource}`, locale))
      .then(setResponse)
      .catch(() => setResponse({ items: [], requested_locale: locale, resolved_locale: locale }));
  }, [locale, resource]);

  const alternates = useMemo(
    () =>
      (["zh", "en", "ja"] as const).map((targetLocale) => ({
        href: withLocale(targetLocale, `/${resource}`),
        hreflang: targetLocale,
      })),
    [resource],
  );

  usePublicPageMeta({
    alternates,
    canonicalPath: location.pathname,
    description: `${titleFor(resource, locale)} published on the ${copy.portfolio}.`,
    robots: response?.fallback_from ? "noindex, follow" : "",
    title: `${titleFor(resource, locale)} | ${copy.portfolio}`,
  });

  const items = response?.items ?? [];
  const entries = resource === "writing" ? writingEntries(items, locale) : projectEntries(items, locale);
  const previews = previewCards(items, resource, locale);
  const layoutTestId = resource === "writing" ? "public-writing-layout" : "public-projects-layout";

  return (
    <PublicLayout>
      <section className={`${styles.hero} ${styles.listHero}`} data-testid="public-list-hero">
        <div className={styles.heroCopy}>
          <div className={styles.sectionLabel}>
            <Sparkles aria-hidden="true" size={16} />
            <span>{pageCopy.eyewrow}</span>
          </div>
          <h1>{titleFor(resource, locale)}</h1>
          <p className={styles.heroHeadline}>{pageCopy.heroLead}</p>
          <div className={styles.stack}>
            <p className={styles.lede}>{pageCopy.heroBody}</p>
            <p className={styles.bodyText}>{pageCopy.heroSupport}</p>
          </div>
          <div className={styles.actions}>
            <Link className={styles.button} to={pageCopy.primaryHref}>
              {pageCopy.primaryLabel}
            </Link>
            <Link className={styles.textButton} to={pageCopy.secondaryHref}>
              {pageCopy.secondaryLabel}
              <ArrowRight aria-hidden="true" size={16} />
            </Link>
          </div>
        </div>

        <div className={`${styles.heroPanel} ${styles.listHeroPanel}`}>
          <div className={styles.heroGlow} />
          <div className={styles.previewBoard}>
            {previews.map((preview) => (
              <article
                className={`${styles.previewCard} ${preview.prominent ? styles.previewCardProminent : ""}`}
                key={`${preview.kicker}-${preview.title}`}
              >
                <span className={styles.previewKicker}>{preview.kicker}</span>
                <strong>{preview.title}</strong>
                <p className={styles.muted}>{preview.body}</p>
              </article>
            ))}
          </div>
          <div className={styles.heroNote}>
            <strong>{pageCopy.noteTitle}</strong>
            <p className={styles.muted}>{pageCopy.noteBody}</p>
          </div>
        </div>
      </section>

      {resource === "writing" ? (
        <section className={styles.section} data-testid={layoutTestId}>
          <div className={styles.split}>
            <article className={styles.panel}>
              <SectionHeading icon={<NotebookPen aria-hidden="true" size={18} />} title={pageCopy.sectionTitle} />
              <p className={styles.panelLead}>{pageCopy.collectionLead}</p>
              <p className={styles.bodyText}>{pageCopy.collectionSupport}</p>
              {items.length === 0 ? <p className={styles.muted}>{copy.emptyList}</p> : null}
              <div className={styles.editorialList} data-testid="public-writing-list">
                {entries.map((entry, index) => (
                  <WritingEntryCard
                    entry={entry}
                    itemLabel={pageCopy.itemLabel}
                    key={entry.key}
                    locale={locale}
                    ordinal={index + 1}
                  />
                ))}
              </div>
            </article>

            <article className={styles.panel}>
              <SectionHeading icon={<Sparkles aria-hidden="true" size={18} />} title={pageCopy.sidebarTitle} />
              <p className={styles.panelLead}>{pageCopy.sidebarLead}</p>
              <div className={styles.noteList}>
                {pageCopy.sidebarItems.map((item) => (
                  <article className={styles.noteItem} key={item}>
                    <span className={styles.previewKicker}>{pageCopy.featuredLabel}</span>
                    <p className={styles.bodyText}>{item}</p>
                  </article>
                ))}
              </div>
            </article>
          </div>
        </section>
      ) : (
        <section className={styles.section} data-testid={layoutTestId}>
          <div className={styles.sectionTitleRow}>
            <SectionHeading icon={<FolderCode aria-hidden="true" size={18} />} title={pageCopy.sectionTitle} />
            <Link className={styles.textButton} to={pageCopy.secondaryHref}>
              {pageCopy.secondaryLabel}
              <ArrowRight aria-hidden="true" size={16} />
            </Link>
          </div>
          <p className={styles.panelLead}>{pageCopy.collectionLead}</p>
          <p className={styles.bodyText}>{pageCopy.collectionSupport}</p>
          {items.length === 0 ? <p className={styles.muted}>{copy.emptyList}</p> : null}

          <div className={styles.projectGrid} data-testid="public-project-grid">
            {entries.map((entry) => (
              <ProjectShowcaseCard
                entry={entry}
                featuredLabel={pageCopy.featuredLabel}
                itemLabel={pageCopy.itemLabel}
                key={entry.key}
              />
            ))}
          </div>

          <div className={styles.twoPanelGrid}>
            <article className={styles.panel}>
              <SectionHeading icon={<Sparkles aria-hidden="true" size={18} />} title={pageCopy.sidebarTitle} />
              <p className={styles.panelLead}>{pageCopy.sidebarLead}</p>
              <div className={styles.noteList}>
                {pageCopy.sidebarItems.map((item) => (
                  <article className={styles.noteItem} key={item}>
                    <span className={styles.previewKicker}>{pageCopy.featuredLabel}</span>
                    <p className={styles.bodyText}>{item}</p>
                  </article>
                ))}
              </div>
            </article>

            <article className={styles.panel}>
              <SectionHeading icon={<FolderCode aria-hidden="true" size={18} />} title={copy.portfolio} />
              <p className={styles.panelLead}>{pageCopy.noteTitle}</p>
              <p className={styles.bodyText}>{pageCopy.noteBody}</p>
              <Link className={styles.textButton} to={pageCopy.primaryHref}>
                {pageCopy.primaryLabel}
                <ArrowRight aria-hidden="true" size={16} />
              </Link>
            </article>
          </div>
        </section>
      )}
    </PublicLayout>
  );
}

function WritingEntryCard({
  entry,
  itemLabel,
  locale,
  ordinal,
}: {
  entry: CollectionEntry;
  itemLabel: string;
  locale: Locale;
  ordinal: number;
}) {
  const meta = entry.meta.length > 0 ? entry.meta : [itemLabel];
  const content = (
    <>
      <span className={styles.editorialIndex}>{String(ordinal).padStart(2, "0")}</span>
      <div className={styles.editorialCopy}>
        <div className={styles.editorialMeta}>
          {meta.map((value) => (
            <span className={styles.pill} key={`${entry.key}-${value}`}>
              {value}
            </span>
          ))}
          {entry.chips.slice(0, 2).map((value) => (
            <span className={styles.pill} key={`${entry.key}-${value}`}>
              {value}
            </span>
          ))}
        </div>
        <h2>{entry.title}</h2>
        <p className={styles.muted}>{entry.description}</p>
      </div>
      {entry.href ? (
        <span aria-hidden="true" className={styles.editorialArrow}>
          <ArrowRight size={18} />
        </span>
      ) : (
        <span className={styles.previewKicker}>{placeholderLabel(locale)}</span>
      )}
    </>
  );

  if (!entry.href) {
    return (
      <div className={`${styles.card} ${styles.editorialItem}`} key={entry.key}>
        {content}
      </div>
    );
  }

  return (
    <Link className={`${styles.card} ${styles.editorialItem}`} key={entry.key} to={entry.href}>
      {content}
    </Link>
  );
}

function ProjectShowcaseCard({
  entry,
  featuredLabel,
  itemLabel,
}: {
  entry: CollectionEntry;
  featuredLabel: string;
  itemLabel: string;
}) {
  const content = (
    <>
      <div className={styles.media} />
      <div className={styles.stack}>
        <div className={styles.editorialMeta}>
          {(entry.meta.length > 0 ? entry.meta : [entry.prominent ? featuredLabel : itemLabel]).map((value) => (
            <span className={styles.pill} key={`${entry.key}-${value}`}>
              {value}
            </span>
          ))}
        </div>
        <h2>{entry.title}</h2>
        <p className={styles.muted}>{entry.description}</p>
        {entry.chips.length > 0 ? (
          <div className={styles.chipRow}>
            {entry.chips.slice(0, 4).map((value) => (
              <span className={styles.chip} key={`${entry.key}-${value}`}>
                {value}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );

  const className = `${styles.card} ${styles.projectCard} ${entry.prominent ? styles.projectCardFeatured : ""}`;
  if (!entry.href) {
    return <div className={className}>{content}</div>;
  }
  return (
    <Link className={className} to={entry.href}>
      {content}
    </Link>
  );
}

function SectionHeading({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className={styles.sectionHeading}>
      {icon}
      <h2>{title}</h2>
    </div>
  );
}

function previewCards(items: Item[], resource: Resource, locale: Locale): PreviewCard[] {
  const pageCopy = pageCopyFor(resource, locale);
  if (items.length === 0) {
    return placeholderEntries(resource, locale).slice(0, 3).map((entry, index) => ({
      body: entry.description,
      kicker: index === 0 ? pageCopy.featuredLabel : pageCopy.emptyKicker,
      prominent: index === 0,
      title: entry.title,
    }));
  }

  return items.slice(0, 3).map((item, index) => ({
    body: itemSummary(item, resource, pageCopy.collectionSupport),
    kicker: item.featured || index === 0 ? pageCopy.featuredLabel : pageCopy.itemLabel,
    prominent: item.featured || index === 0,
    title: item.title,
  }));
}

function writingEntries(items: Item[], locale: Locale): CollectionEntry[] {
  if (items.length === 0) {
    return placeholderEntries("writing", locale);
  }

  return items.map((item, index) => ({
    chips: termNames(item.tags),
    description: itemSummary(item, "writing", ""),
    href: withLocale(locale, `/writing/${item.slug || item.id}`),
    key: `writing-${item.id}`,
    meta: compactMeta([item.featured ? pageCopyFor("writing", locale).featuredLabel : "", formatPublicDate(locale, item.published_at)]),
    prominent: item.featured || index === 0,
    title: item.title,
  }));
}

function projectEntries(items: Item[], locale: Locale): CollectionEntry[] {
  if (items.length === 0) {
    return placeholderEntries("projects", locale);
  }

  return items.map((item, index) => ({
    chips: termNames(item.techs),
    description: itemSummary(item, "projects", ""),
    href: withLocale(locale, `/projects/${item.slug || item.id}`),
    key: `project-${item.id}`,
    meta: compactMeta([item.featured ? pageCopyFor("projects", locale).featuredLabel : "", formatPublicDate(locale, item.published_at)]),
    prominent: item.featured || index === 0,
    title: item.title,
  }));
}

function placeholderEntries(resource: Resource, locale: Locale): CollectionEntry[] {
  if (resource === "writing") {
    switch (locale) {
      case "zh":
        return [
          placeholderEntry("writing-placeholder-1", "下一篇长文正在整理", "新的方法论拆解、产品复盘与创作记录发布后会出现在这里。", true),
          placeholderEntry("writing-placeholder-2", "公开笔记会保持结构化", "这里会优先承接能快速扫读的摘要，再把完整内容引向详情页。"),
          placeholderEntry("writing-placeholder-3", "多语言版本会并排出现", "同一篇内容发布英文或日文后，也会沿着同样的版式自然展开。"),
        ];
      case "ja":
        return [
          placeholderEntry("writing-placeholder-1", "次の長文を準備中です", "方法論の分解、制作ログ、振り返り記事が公開されるとここに並びます。", true),
          placeholderEntry("writing-placeholder-2", "公開ノートも整理して表示します", "一覧では要点を素早く読めるようにし、詳細は個別ページへつなげます。"),
          placeholderEntry("writing-placeholder-3", "多言語版も同じ流れで見せます", "英語版や日本語版が公開されると、このレイアウトのまま自然に増えていきます。"),
        ];
      default:
        return [
          placeholderEntry("writing-placeholder-1", "The next longform piece is in progress", "New essays, product notes, and practical breakdowns will appear here once they are published.", true),
          placeholderEntry("writing-placeholder-2", "Public notes will stay easy to scan", "The list favors quick summaries first, then hands off to a dedicated reading page."),
          placeholderEntry("writing-placeholder-3", "Localized editions will line up naturally", "English and Japanese versions can join the same editorial rhythm without changing the structure."),
        ];
    }
  }

  switch (locale) {
    case "zh":
      return [
        placeholderEntry("project-placeholder-1", "新的案例正在整理", "项目发布后会带着简介、正文与语言版本一起出现在这里。", true, ["作品集", "案例"]),
        placeholderEntry("project-placeholder-2", "布局会优先照顾扫读体验", "首屏先给出判断线索，再让每个项目单独展开，不会挤成模板化卡片墙。", false, ["版式", "可读性"]),
        placeholderEntry("project-placeholder-3", "技术标签会帮助快速定位", "真实内容上线后，这里会展示技术栈、主题和更明确的交付侧重点。", false, ["标签", "交付"]),
      ];
    case "ja":
      return [
        placeholderEntry("project-placeholder-1", "新しい事例を準備中です", "公開後は概要、本文、多言語版をまとめてここに並べます。", true, ["Portfolio", "Case study"]),
        placeholderEntry("project-placeholder-2", "一覧でも判断しやすい構成にします", "最初に要点が伝わり、そのあと各プロジェクトを個別に深く見られる流れです。", false, ["Layout", "Readability"]),
        placeholderEntry("project-placeholder-3", "技術タグもすばやく把握できます", "実データが入ると、技術スタックや成果物の重心もここで見分けられます。", false, ["Tech", "Delivery"]),
      ];
    default:
      return [
        placeholderEntry("project-placeholder-1", "The next case study is being prepared", "Published projects will arrive here with summary, longform body, and localized routes together.", true, [
          "Portfolio",
          "Case study",
        ]),
        placeholderEntry("project-placeholder-2", "The layout stays scannable first", "The page leads with strong visual cues, then lets every project expand into its own deeper detail page.", false, [
          "Layout",
          "Readability",
        ]),
        placeholderEntry("project-placeholder-3", "Tech tags will add quick context", "Once real content lands, this area can expose the stack, delivery shape, and design focus at a glance.", false, [
          "Tech",
          "Delivery",
        ]),
      ];
  }
}

function placeholderEntry(key: string, title: string, description: string, prominent = false, chips: string[] = []): CollectionEntry {
  return {
    chips,
    description,
    key,
    meta: [],
    prominent,
    title,
  };
}

function pageCopyFor(resource: Resource, locale: Locale): PageCopy {
  if (resource === "writing") {
    switch (locale) {
      case "zh":
        return {
          collectionLead: "把长文、笔记与实践复盘整理成更易浏览的阅读目录。",
          collectionSupport: "即使内容还在持续补充，页面也会先维持完整的阅读节奏，而不是只剩一排空标题。",
          emptyKicker: "即将发布",
          eyewrow: "编辑型归档",
          featuredLabel: "精选",
          heroBody: "这页更像一份公开工作簿：读者能先快速判断主题，再进入单篇内容继续深入。",
          heroLead: "写作页不再只是列表，它会像一本被认真编排过的阅读索引。",
          heroSupport: "多语言版本加入后，文章也能沿着同样的节奏并排展示，而不会打散整体观感。",
          itemLabel: "文章",
          noteBody: "适合承载方法论、拆解记录与持续更新的实践笔记。",
          noteTitle: "阅读方式",
          primaryHref: withLocale(locale, "/projects"),
          primaryLabel: "查看项目",
          sectionTitle: "公开目录",
          secondaryHref: withLocale(locale, "/bio"),
          secondaryLabel: "更多关于我",
          sidebarItems: [
            "长文与短文会共用一套更清晰的层级，先看摘要，再进详情页。",
            "真实内容发布后，标题、摘要与语言版本就能直接接管这套布局。",
            "页面留白会更充足，适合承接持续增长的公开写作。",
          ],
          sidebarLead: "列表页也要有明确的阅读体验，而不是内容有了之后再临时补版式。",
          sidebarTitle: "这页会承载什么",
        };
      case "ja":
        return {
          collectionLead: "長文、ノート、実践の振り返りを、読みやすい公開アーカイブとして整理します。",
          collectionSupport: "まだ記事が少ない段階でも、ページの骨格とリズムは先に成立させます。",
          emptyKicker: "Coming soon",
          eyewrow: "Editorial archive",
          featuredLabel: "Featured",
          heroBody: "このページは単なる一覧ではなく、テーマを素早く把握してから個別記事へ進める読書導線になります。",
          heroLead: "Writing ページを、きちんと編集された読みものの入口として見せます。",
          heroSupport: "英語版や日本語版が増えても、同じテンポのまま自然に広がる構成です。",
          itemLabel: "Article",
          noteBody: "方法論、分解メモ、制作ログのような蓄積型コンテンツに向いた見せ方です。",
          noteTitle: "Read rhythm",
          primaryHref: withLocale(locale, "/projects"),
          primaryLabel: "プロジェクトを見る",
          sectionTitle: "Published archive",
          secondaryHref: withLocale(locale, "/bio"),
          secondaryLabel: "プロフィールを見る",
          sidebarItems: [
            "一覧で要点を把握し、そのまま詳細ページへ読み進められます。",
            "本物の公開コンテンツが増えても、このレイアウトのまま無理なく拡張できます。",
            "余白をしっかり残し、読みものらしい落ち着いたテンポを保ちます。",
          ],
          sidebarLead: "記事数が少ない段階でも、読む体験そのものを先に整えておくページです。",
          sidebarTitle: "What this page carries",
        };
      default:
        return {
          collectionLead: "A reading page should feel edited, not merely populated.",
          collectionSupport: "Even before the archive fills up, the structure stays calm, readable, and ready for longform work.",
          emptyKicker: "Coming soon",
          eyewrow: "Editorial archive",
          featuredLabel: "Featured",
          heroBody: "The writing page becomes a public notebook: scan the theme first, then step into the full article when it matters.",
          heroLead: "This is no longer a plain list. It reads like a curated index for essays, notes, and process writing.",
          heroSupport: "As English and Japanese entries appear, they can join the same rhythm without changing the shape of the page.",
          itemLabel: "Article",
          noteBody: "Best suited for methods, breakdowns, and durable notes that deserve a calmer reading pace.",
          noteTitle: "Reading rhythm",
          primaryHref: withLocale(locale, "/projects"),
          primaryLabel: "View projects",
          sectionTitle: "Published archive",
          secondaryHref: withLocale(locale, "/bio"),
          secondaryLabel: "More about me",
          sidebarItems: [
            "Readers should understand the theme and density of each piece before opening it.",
            "The layout is meant to absorb real published work without feeling like a temporary placeholder.",
            "Generous spacing keeps the archive legible as more entries and locales arrive.",
          ],
          sidebarLead: "The list page itself should already communicate care, pacing, and clarity.",
          sidebarTitle: "What this page carries",
        };
    }
  }

  switch (locale) {
    case "zh":
      return {
        collectionLead: "项目页会更像作品展陈，而不是模板化的卡片堆叠。",
        collectionSupport: "先让人快速看懂做了什么、擅长什么，再进入具体案例继续展开细节。",
        emptyKicker: "案例筹备中",
        eyewrow: "案例展陈",
        featuredLabel: "重点项目",
        heroBody: "这个页面要同时承接项目摘要、技术线索与多语言入口，让作品集更像可浏览的展示系统。",
        heroLead: "项目页应该先建立判断感，再把每个案例交给更完整的详情页。",
        heroSupport: "真实内容上线后，技术标签、摘要与公开状态都能直接接入，而不是重新推翻版式。",
        itemLabel: "项目",
        noteBody: "适合展示产品体验、前端工程与持续迭代过程，不需要靠过多装饰堆出“高级感”。",
        noteTitle: "展示原则",
        primaryHref: withLocale(locale, "/contact"),
        primaryLabel: "联系我",
        sectionTitle: "作品矩阵",
        secondaryHref: withLocale(locale, "/writing"),
        secondaryLabel: "查看写作",
        sidebarItems: [
          "首屏先给出项目整体判断线索，再让案例卡片承担更具体的内容承接。",
          "真实技术栈接入后，可以直接显示在卡片里，帮助快速识别项目类型。",
          "即使条目不多，页面也会保留完整的作品展示氛围，而不是只剩空白。",
        ],
        sidebarLead: "作品集列表页的任务，是在很短时间内建立信任感和方向感。",
        sidebarTitle: "这页的关注点",
      };
    case "ja":
      return {
        collectionLead: "Projects ページは、テンプレート的なカード一覧ではなく、作品を見せる展示面として整えます。",
        collectionSupport: "まず全体の得意領域をつかめて、そのあと各ケースへ自然に深掘りできる流れです。",
        emptyKicker: "In preparation",
        eyewrow: "Case showcase",
        featuredLabel: "Featured",
        heroBody: "要約、技術タグ、多言語導線をまとめて受け止めることで、一覧ページ自体の説得力を高めます。",
        heroLead: "プロジェクト一覧は、最初に判断材料を渡してから個別ケースへつなぐべきです。",
        heroSupport: "実データが入っても骨格を崩さず、そのまま作品展示として育つレイアウトにします。",
        itemLabel: "Project",
        noteBody: "プロダクト体験、フロントエンド実装、継続的な改善の流れを素直に見せる構成です。",
        noteTitle: "Showcase principle",
        primaryHref: withLocale(locale, "/contact"),
        primaryLabel: "連絡する",
        sectionTitle: "Selected work",
        secondaryHref: withLocale(locale, "/writing"),
        secondaryLabel: "Writing を見る",
        sidebarItems: [
          "冒頭で全体の重心を伝え、個別カードでケースごとの文脈を補います。",
          "技術タグが入ると、一覧の時点でどの種類の仕事か判断しやすくなります。",
          "まだ件数が少なくても、展示としての雰囲気を先に成立させます。",
        ],
        sidebarLead: "短時間で信頼感と方向性を伝えるのが、一覧ページの大きな役目です。",
        sidebarTitle: "What this page emphasizes",
      };
    default:
      return {
        collectionLead: "Projects should read like a showcase, not a pile of generic cards.",
        collectionSupport: "The page should explain what kind of work lives here before asking people to open a specific case study.",
        emptyKicker: "In preparation",
        eyewrow: "Case showcase",
        featuredLabel: "Featured",
        heroBody: "This layout is designed to hold summaries, tech cues, and locale-aware entry points without losing visual clarity.",
        heroLead: "A strong project page gives people context first, then lets individual case studies carry the deeper story.",
        heroSupport: "Once real content arrives, tags, summaries, and public routes can slot straight into the same visual system.",
        itemLabel: "Project",
        noteBody: "It is meant to show product thinking, frontend delivery, and iteration over time without leaning on decorative noise.",
        noteTitle: "Showcase principle",
        primaryHref: withLocale(locale, "/contact"),
        primaryLabel: "Get in touch",
        sectionTitle: "Selected work",
        secondaryHref: withLocale(locale, "/writing"),
        secondaryLabel: "View writing",
        sidebarItems: [
          "The opening view should establish range and quality before the user opens a single project.",
          "Real tech labels can sit directly on the cards and make the work easier to classify at a glance.",
          "Even with a small set of projects, the page should still feel intentional and complete.",
        ],
        sidebarLead: "The list page has to create trust and orientation in a very short amount of time.",
        sidebarTitle: "What this page emphasizes",
      };
  }
}

function titleFor(resource: Resource, locale: Locale) {
  const copy = publicLocaleCopy(locale);
  return resource === "projects" ? copy.projects : copy.writing;
}

function formatPublicDate(locale: Locale, value: string | null | undefined) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const localeMap: Record<Locale, string> = {
    en: "en-US",
    ja: "ja-JP",
    zh: "zh-CN",
  };
  return new Intl.DateTimeFormat(localeMap[locale], {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function itemSummary(item: Item, resource: Resource, fallback: string) {
  const candidate = resource === "writing" ? item.excerpt : item.summary;
  return candidate?.trim() ? candidate : fallback;
}

function termNames(values: Term[] | undefined) {
  return (values ?? [])
    .map((value) => value.name?.trim())
    .filter((value): value is string => Boolean(value));
}

function compactMeta(values: string[]) {
  return values.filter((value) => value.trim().length > 0);
}

function placeholderLabel(locale: Locale) {
  switch (locale) {
    case "zh":
      return "占位";
    case "ja":
      return "Preview";
    default:
      return "Preview";
  }
}
