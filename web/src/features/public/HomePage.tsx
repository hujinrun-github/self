import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";

import { apiFetch } from "../../lib/api";
import { usePublicPageMeta } from "./head";
import { type Locale, coerceLocale, publicLocaleCopy, withLocale, withLocaleQuery } from "./locale";
import { ProfileAvatar } from "./ProfileAvatar";
import { PublicLayout } from "./PublicLayout";
import { SocialLinkCard, type PublicSocialLink } from "./SocialLinkCard";
import styles from "./Public.module.css";

type Summary = {
  id: number;
  title: string;
  slug?: string;
  summary?: string;
};

type Experience = {
  id: number;
  period: string;
  title: string;
  organization: string;
  description: string;
};

type HomePayload = {
  requested_locale?: string;
  resolved_locale?: string;
  fallback_from?: string;
  experiences: Experience[];
  writing: Summary[];
  projects: Summary[];
};

type ProfilePreviewPayload = {
  avatar_media_id?: number | null;
  requested_locale?: string;
  resolved_locale?: string;
  fallback_from?: string;
  name: string;
  headline: string;
  summary: string;
  bio: string;
  email: string;
  social_links: PublicSocialLink[];
};

const emptyHomePayload: HomePayload = {
  experiences: [],
  projects: [],
  writing: [],
};

const emptyProfilePayload: ProfilePreviewPayload = {
  avatar_media_id: null,
  bio: "",
  email: "",
  headline: "",
  name: "",
  social_links: [],
  summary: "",
};

export function HomePage() {
  const [home, setHome] = useState<HomePayload>(emptyHomePayload);
  const [profile, setProfile] = useState<ProfilePreviewPayload>(emptyProfilePayload);
  const { locale: localeParam } = useParams();
  const location = useLocation();
  const locale = coerceLocale(localeParam);
  const copy = publicLocaleCopy(locale);
  const design = designCopy(locale);
  const displayName = textOrFallback(profile.name, copy.portfolio);
  const displayHeadline = textOrFallback(profile.headline, copy.placeholderHeadline);
  const displaySummary = textOrFallback(profile.summary, copy.placeholderSummary);

  useEffect(() => {
    let active = true;

    Promise.allSettled([
      apiFetch<HomePayload>(withLocaleQuery("/api/site/home", locale)),
      apiFetch<ProfilePreviewPayload>(withLocaleQuery("/api/site/profile", locale)),
    ]).then(([homeResult, profileResult]) => {
      if (!active) {
        return;
      }
      setHome(homeResult.status === "fulfilled" ? homeResult.value : emptyHomePayload);
      setProfile(profileResult.status === "fulfilled" ? profileResult.value : emptyProfilePayload);
    });

    return () => {
      active = false;
    };
  }, [locale]);

  usePublicPageMeta({
    alternates: (["zh", "en", "ja"] as const).map((targetLocale) => ({
      href: withLocale(targetLocale, "/"),
      hreflang: targetLocale,
    })),
    canonicalPath: location.pathname,
    description: displaySummary,
    robots: home.fallback_from || profile.fallback_from ? "noindex, follow" : "",
    title: `${displayName} | ${copy.portfolio}`,
  });

  const experiences = experienceEntries(home.experiences, locale);

  return (
    <PublicLayout>
      <section className={`${styles.hero} ${styles.homeHero}`} data-testid="public-hero">
        <div className={`${styles.heroCopy} ${styles.homeHeroCopy}`}>
          <p className={styles.sectionLabel}>{design.discipline}</p>
          <h1>{displayName}</h1>
          <p className={styles.heroHeadline}>{displayHeadline}</p>
          <div className={styles.heroIntro}>
            <p className={`${styles.lede} ${styles.heroSummary}`} data-testid="home-profile-summary">
              {displaySummary}
            </p>
            <Link className={styles.heroIntroLink} to={withLocale(locale, "/bio")}>
              {copy.aboutMore}
              <ArrowUpRight aria-hidden="true" size={15} />
            </Link>
          </div>
          <div className={styles.actions}>
            <Link className={styles.button} to={withLocale(locale, "/projects")}>
              {design.viewProjects}
              <ArrowUpRight aria-hidden="true" size={17} />
            </Link>
            <Link className={styles.secondaryButton} to={withLocale(locale, "/contact")}>
              {design.startContact}
            </Link>
          </div>
          {profile.social_links.length ? (
            <div aria-label={design.socialLinks} className={styles.socialStrip}>
              {profile.social_links.map((link) => (
                <SocialLinkCard key={link.id} link={link} />
              ))}
            </div>
          ) : null}
        </div>

        <SystemAtlas
          locale={locale}
          mediaID={profile.avatar_media_id}
          name={displayName}
        />

        <a aria-label={copy.experience} className={styles.heroScroll} href="#experience">
          <span>01</span>
          <ArrowDownRight aria-hidden="true" size={17} />
        </a>
      </section>

      <section className={styles.section} id="experience">
        <SectionHeader index={design.experienceIndex} intro={design.experienceIntro} title={design.experienceTitle} />
        <ol className={styles.timeline}>
          {experiences.map((item, index) => (
            <li className={styles.timelineItem} key={`${item.period}-${item.title}-${index}`}>
              <span className={styles.editorialIndex}>{String(index + 1).padStart(2, "0")}</span>
              <time className={styles.timelineMeta}>{item.period}</time>
              <div className={styles.timelineBody}>
                <h3>{item.title}</h3>
                <p className={styles.muted}>{item.organization}</p>
              </div>
              <p className={styles.bodyText}>{item.description}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className={`${styles.section} ${styles.sectionMuted}`} data-testid="public-section-writing">
        <SectionHeader index={design.writingIndex} intro={design.writingIntro} title={design.writingTitle} />
        {home.writing.length ? (
          <div className={styles.editorialList}>
            {home.writing.slice(0, 3).map((item, index) => (
              <Link
                className={styles.editorialItem}
                key={item.id}
                to={`${withLocale(locale, "/writing")}/${item.slug ?? item.id}`}
              >
                <span className={styles.editorialIndex}>{String(index + 1).padStart(2, "0")}</span>
                <div className={styles.editorialCopy}>
                  <p className={styles.previewKicker}>{copy.writing}</p>
                  <h3>{item.title}</h3>
                  {item.summary ? <p className={styles.muted}>{item.summary}</p> : null}
                </div>
                <ArrowUpRight aria-hidden="true" size={19} />
              </Link>
            ))}
          </div>
        ) : (
          <EmptyCollection description={copy.emptyCollectionDescription} title={copy.emptyCollectionTitle} />
        )}
        <div className={styles.sectionAction}>
          <Link className={styles.textButton} to={withLocale(locale, "/writing")}>
            {copy.viewAllWriting}
            <ArrowUpRight aria-hidden="true" size={16} />
          </Link>
        </div>
      </section>

      <section className={styles.section} data-testid="public-section-projects">
        <SectionHeader index={design.projectsIndex} intro={design.projectsIntro} title={design.projectsTitle} />
        {home.projects.length ? (
          <div className={styles.projectGrid}>
            {home.projects.slice(0, 3).map((item, index) => (
              <Link
                className={`${styles.projectCard} ${index === 0 ? styles.projectCardFeatured : ""}`}
                key={item.id}
                to={`${withLocale(locale, "/projects")}/${item.slug ?? item.id}`}
              >
                <div aria-hidden="true" className={styles.projectVisual}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <i />
                  <i />
                  <i />
                </div>
                <div className={styles.projectCardCopy}>
                  <p className={styles.previewKicker}>{index === 0 ? design.featured : copy.projects}</p>
                  <h3>{item.title}</h3>
                  {item.summary ? <p className={styles.muted}>{item.summary}</p> : null}
                  <span className={styles.textButton}>{design.readMore}<ArrowUpRight aria-hidden="true" size={16} /></span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyCollection description={copy.emptyCollectionDescription} title={copy.emptyCollectionTitle} />
        )}
        <div className={styles.sectionAction}>
          <Link className={styles.textButton} to={withLocale(locale, "/projects")}>
            {copy.viewAllProjects}
            <ArrowUpRight aria-hidden="true" size={16} />
          </Link>
        </div>
      </section>

      <section className={styles.contactBand}>
        <p className={styles.sectionIndex}>04 / CONTACT</p>
        <h2>{design.contactTitle}</h2>
        <div>
          <p>{design.contactIntro}</p>
          <Link className={styles.lightButton} to={withLocale(locale, "/contact")}>
            {design.startContact}
            <ArrowUpRight aria-hidden="true" size={17} />
          </Link>
        </div>
      </section>
    </PublicLayout>
  );
}

function SystemAtlas({ locale, mediaID, name }: { locale: Locale; mediaID?: number | null; name: string }) {
  const copy = publicLocaleCopy(locale);
  const design = designCopy(locale);
  return (
    <aside aria-labelledby="focus-heading" className={styles.heroPanel}>
      <div className={styles.atlasMap}>
        <div className={styles.atlasPortrait}>
          <ProfileAvatar mediaID={mediaID} name={name} />
          <span>PROFILE / HJR</span>
        </div>
        <div aria-hidden="true" className={styles.atlasSchematic}>
          <span className={styles.atlasNode}>01</span>
          <span className={styles.atlasNode}>02</span>
          <span className={styles.atlasNode}>03</span>
          <i />
          <i />
        </div>
      </div>
      <div className={styles.atlasContent}>
        <header className={styles.atlasHeader}>
          <h2 id="focus-heading">{design.focusTitle}</h2>
          <span className={styles.liveStatus}><i aria-hidden="true" />{design.iterating}</span>
        </header>
        <ol className={styles.focusList}>
          {design.focusItems.map((item, index) => (
            <li key={item[0]}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{item[0]}</strong>
              <small>{item[1]}</small>
            </li>
          ))}
        </ol>
        <p className={styles.srOnly}>{copy.nowDescription}</p>
      </div>
    </aside>
  );
}

function SectionHeader({ index, intro, title }: { index: string; intro: string; title: string }) {
  return (
    <header className={styles.sectionHeader}>
      <div>
        <p className={styles.sectionIndex}>{index}</p>
        <h2>{title}</h2>
      </div>
      <p>{intro}</p>
    </header>
  );
}

function EmptyCollection({ description, title }: { description: string; title: string }) {
  return (
    <div className={styles.emptyState} role="status">
      <span>00</span>
      <div><h3>{title}</h3><p>{description}</p></div>
    </div>
  );
}

function experienceEntries(items: Experience[], locale: Locale): Experience[] {
  if (items.length > 0) {
    return items;
  }
  if (locale === "en") {
    return [
      { id: -1, period: "Current", title: "AI products and tools", organization: "Ongoing practice", description: "Structuring real workflows so product decisions and system behavior remain clear." },
      { id: -2, period: "Recent", title: "Design systems and frontend", organization: "Product delivery", description: "Connecting visual language, component behavior, and engineering constraints." },
      { id: -3, period: "Archive", title: "Long-running projects", organization: "Continuously updated", description: "Published experience will appear here in a concise, scannable sequence." },
    ];
  }
  if (locale === "ja") {
    return [
      { id: -1, period: "現在", title: "AI プロダクトとツール", organization: "継続的な実践", description: "実際のワークフローを整理し、判断とシステムの挙動を明快にします。" },
      { id: -2, period: "最近", title: "デザインシステムとフロントエンド", organization: "プロダクト開発", description: "視覚言語、コンポーネント、実装制約をひとつの仕組みにまとめます。" },
      { id: -3, period: "アーカイブ", title: "長期プロジェクト", organization: "継続的に更新", description: "公開された経歴は、読みやすい時系列としてここに表示されます。" },
    ];
  }
  return [
    { id: -1, period: "当前", title: "AI 产品与工具", organization: "持续实践", description: "围绕真实工作流整理需求，让产品判断和系统行为保持清楚。" },
    { id: -2, period: "近期", title: "设计系统与前端工程", organization: "产品交付", description: "把视觉语言、组件行为和工程约束连成可复用的系统。" },
    { id: -3, period: "归档", title: "长期项目与实验", organization: "持续更新", description: "已发布的经历会在这里形成简洁、连续、可扫描的时间线。" },
  ];
}

function designCopy(locale: Locale) {
  if (locale === "en") {
    return {
      contactIntro: "Share the context and the outcome you need. We can start from the problem itself.",
      contactTitle: "Want to talk about products, systems, or tools?",
      discipline: "Engineering · Product design · Design systems",
      experienceIndex: "01 / EXPERIENCE",
      experienceIntro: "A concise timeline of focus, responsibilities, and accumulated practice.",
      experienceTitle: "Work trajectory",
      featured: "Featured work",
      focusItems: [["AI products", "Real workflows"], ["Design systems", "Consistency at scale"], ["Developer tools", "Speed and reliability"]] as const,
      focusTitle: "Current focus",
      iterating: "In progress",
      projectsIndex: "03 / PROJECTS",
      projectsIntro: "Published projects flow directly from the existing content system.",
      projectsTitle: "Selected work",
      readMore: "Read more",
      socialLinks: "Social links",
      startContact: "Get in touch",
      viewProjects: "View projects",
      writingIndex: "02 / WRITING",
      writingIntro: "Notes on products, systems, and reusable engineering decisions.",
      writingTitle: "Thinking index",
    };
  }
  if (locale === "ja") {
    return {
      contactIntro: "背景と目的を共有してください。問題そのものから一緒に考えます。",
      contactTitle: "プロダクト、システム、ツールについて話しませんか？",
      discipline: "開発 · プロダクトデザイン · デザインシステム",
      experienceIndex: "01 / 経歴",
      experienceIntro: "関心、役割、積み重ねを時系列で簡潔に整理します。",
      experienceTitle: "仕事の軌跡",
      featured: "注目プロジェクト",
      focusItems: [["AI プロダクト", "実際のワークフロー"], ["デザインシステム", "一貫性と拡張性"], ["開発者ツール", "効率と信頼性"]] as const,
      focusTitle: "現在の関心",
      iterating: "継続中",
      projectsIndex: "03 / プロジェクト",
      projectsIntro: "公開されたプロジェクトは既存のコンテンツ管理から自動反映されます。",
      projectsTitle: "選んだ仕事",
      readMore: "続きを読む",
      socialLinks: "ソーシャルリンク",
      startContact: "連絡する",
      viewProjects: "プロジェクトを見る",
      writingIndex: "02 / 文章",
      writingIntro: "プロダクト、システム、実装判断を再利用できる形で記録します。",
      writingTitle: "思考の索引",
    };
  }
  return {
    contactIntro: "留下你的背景与目标，我们会从问题本身开始讨论。",
    contactTitle: "想聊聊产品、系统或工具？",
    discipline: "研发 · 产品设计 · 设计系统",
    experienceIndex: "01 / 经历",
    experienceIntro: "按时间顺序梳理关注方向、职责和持续积累。",
    experienceTitle: "工作轨迹",
    featured: "重点项目",
    focusItems: [["AI 产品", "真实工作流"], ["设计系统", "一致与可扩展"], ["开发者工具", "效率与可靠性"]] as const,
    focusTitle: "当前关注",
    iterating: "持续迭代",
    projectsIndex: "03 / 项目",
    projectsIntro: "项目内容沿用现有后台数据，发布后自动进入首页。",
    projectsTitle: "精选工作",
    readMore: "继续阅读",
    socialLinks: "社交链接",
    startContact: "发起联系",
    viewProjects: "查看项目",
    writingIndex: "02 / 写作",
    writingIntro: "围绕产品、系统和工程实践记录可复用的判断。",
    writingTitle: "思考索引",
  };
}

function textOrFallback(value: string | undefined, fallback: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}
