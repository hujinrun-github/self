import {
  ArrowRight,
  BriefcaseBusiness,
  FolderCode,
  NotebookPen,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";

import { apiFetch } from "../../lib/api";
import { usePublicPageMeta } from "./head";
import { PublicLayout } from "./PublicLayout";
import { ProfileAvatar } from "./ProfileAvatar";
import { type Locale, coerceLocale, publicLocaleCopy, withLocale, withLocaleQuery } from "./locale";
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

type SocialLink = {
  id: number;
  label: string;
  url: string;
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
  social_links: SocialLink[];
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
  const displayName = textOrFallback(profile.name, copy.portfolio);
  const displayHeadline = textOrFallback(profile.headline, copy.placeholderHeadline);
  const displaySummary = textOrFallback(profile.summary, copy.placeholderSummary);
  const bioParagraphs = paragraphize(textOrFallback(profile.bio, copy.placeholderBio));

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
    description: copy.homeDescription,
    robots: home.fallback_from || profile.fallback_from ? "noindex, follow" : "",
    title: copy.portfolio,
  });

  return (
    <PublicLayout>
      <section className={styles.hero} data-testid="public-hero">
        <div className={styles.heroCopy}>
          <div className={styles.sectionLabel}>
            <Sparkles aria-hidden="true" size={16} />
            <span>{copy.now}</span>
          </div>
          <h1>{displayName}</h1>
          <p className={styles.heroHeadline}>{displayHeadline}</p>
          <div className={styles.stack}>
            <p className={styles.lede}>{displaySummary}</p>
            <p className={styles.bodyText}>{copy.homeDescription}</p>
          </div>
          <div className={styles.actions}>
            <Link className={styles.button} to={withLocale(locale, "/contact")}>
              {copy.contact}
            </Link>
            <Link className={styles.textButton} to={withLocale(locale, "/projects")}>
              {copy.viewAllProjects}
              <ArrowRight aria-hidden="true" size={16} />
            </Link>
          </div>
        </div>
        <div className={styles.heroPanel}>
          <div className={styles.heroGlow} />
          <ProfileAvatar mediaID={profile.avatar_media_id} name={displayName} />
          <div className={styles.heroNote}>
            <strong>{copy.now}</strong>
            <p className={styles.muted}>{copy.nowDescription}</p>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.twoPanelGrid}>
          <article className={styles.panel}>
            <SectionHeading icon={<BriefcaseBusiness aria-hidden="true" size={18} />} title={copy.experience} />
            <div className={styles.timeline}>
              {experienceEntries(home.experiences, locale).map((item, index, items) => (
                <article className={styles.timelineItem} key={`${item.period}-${item.title}-${index}`}>
                  <div className={styles.timelineRail}>
                    <span className={styles.timelineDot} />
                    {index < items.length - 1 ? <span className={styles.timelineLine} /> : null}
                  </div>
                  <div className={styles.timelineMeta}>{item.period}</div>
                  <div className={styles.timelineBody}>
                    <h3>{item.title}</h3>
                    <p className={styles.muted}>{item.organization}</p>
                    <p className={styles.bodyText}>{item.description}</p>
                  </div>
                </article>
              ))}
            </div>
          </article>

          <article className={styles.panel}>
            <SectionHeading icon={<UserRound aria-hidden="true" size={18} />} title={copy.bio} />
            <div className={styles.stack}>
              <p className={styles.panelLead}>{copy.bioDescription}</p>
              {bioParagraphs.slice(0, 2).map((paragraph) => (
                <p className={styles.bodyText} key={paragraph}>
                  {paragraph}
                </p>
              ))}
            </div>
            <Link className={styles.textButton} to={withLocale(locale, "/bio")}>
              {copy.aboutMore}
              <ArrowRight aria-hidden="true" size={16} />
            </Link>
          </article>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.twoPanelGrid}>
          <article className={styles.panel} data-testid="public-section-writing">
            <SectionTitleRow
              icon={<NotebookPen aria-hidden="true" size={18} />}
              title={copy.writing}
              to={withLocale(locale, "/writing")}
              toLabel={copy.viewAllWriting}
            />
            <div className={styles.listStack}>
              {home.writing.length > 0
                ? home.writing.map((item) => (
                    <Link className={styles.listItem} key={item.id} to={`${withLocale(locale, "/writing")}/${item.slug ?? item.id}`}>
                      <div className={styles.listTitleBlock}>
                        <strong>{item.title}</strong>
                        {item.summary ? <span className={styles.muted}>{item.summary}</span> : null}
                      </div>
                      <ArrowRight aria-hidden="true" size={16} />
                    </Link>
                  ))
                : Array.from({ length: 4 }, (_, index) => (
                    <div className={`${styles.listItem} ${styles.listItemStatic}`} key={`writing-empty-${index}`}>
                      <div className={styles.listTitleBlock}>
                        <strong>{copy.emptyCollectionTitle}</strong>
                        <span className={styles.muted}>{copy.emptyCollectionDescription}</span>
                      </div>
                    </div>
                  ))}
            </div>
          </article>

          <article className={styles.panel} data-testid="public-section-projects">
            <SectionTitleRow
              icon={<FolderCode aria-hidden="true" size={18} />}
              title={copy.projects}
              to={withLocale(locale, "/projects")}
              toLabel={copy.viewAllProjects}
            />
            <div className={styles.compactShowcaseGrid}>
              {home.projects.length > 0
                ? home.projects.map((item) => (
                    <SummaryCard compact key={item.id} item={item} to={withLocale(locale, "/projects")} />
                  ))
                : Array.from({ length: 2 }, (_, index) => (
                    <EmptyShowcaseCard
                      compact
                      description={copy.emptyCollectionDescription}
                      key={`project-empty-${index}`}
                      title={copy.emptyCollectionTitle}
                    />
                  ))}
            </div>
          </article>
        </div>
      </section>
    </PublicLayout>
  );
}

function SummaryCard({ compact = false, item, to }: { compact?: boolean; item: Summary; to: string }) {
  return (
    <Link className={`${styles.showcaseCard} ${compact ? styles.showcaseCardCompact : ""}`} to={`${to}/${item.slug ?? item.id}`}>
      <div className={styles.media} />
      <div className={styles.stack}>
        <h3>{item.title}</h3>
        {item.summary ? <p className={styles.muted}>{item.summary}</p> : null}
      </div>
    </Link>
  );
}

function EmptyShowcaseCard({
  compact = false,
  description,
  title,
}: {
  compact?: boolean;
  description: string;
  title: string;
}) {
  return (
    <div className={`${styles.showcaseCard} ${styles.showcaseCardStatic} ${compact ? styles.showcaseCardCompact : ""}`}>
      <div className={styles.media} />
      <div className={styles.stack}>
        <h3>{title}</h3>
        <p className={styles.muted}>{description}</p>
      </div>
    </div>
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

function SectionTitleRow({
  icon,
  title,
  to,
  toLabel,
}: {
  icon: React.ReactNode;
  title: string;
  to: string;
  toLabel: string;
}) {
  return (
    <div className={styles.sectionTitleRow}>
      <SectionHeading icon={icon} title={title} />
      <Link className={styles.textButton} to={to}>
        {toLabel}
        <ArrowRight aria-hidden="true" size={16} />
      </Link>
    </div>
  );
}

function experienceEntries(items: Experience[], locale: Locale) {
  if (items.length > 0) {
    return items;
  }
  switch (locale) {
    case "zh":
      return [
        {
          id: -1,
          period: "当前",
          title: "AI 产品与工具",
          organization: "作品集内容持续整理中",
          description: "新的公开经历会在这里按时间顺序展示，帮助访问者快速理解你的能力脉络。",
        },
        {
          id: -2,
          period: "近期",
          title: "设计系统与前端工程",
          organization: "界面与内容将同步更新",
          description: "这一栏适合放职责、成果和协作方式，让整个首页更像一张可信的职业摘要。",
        },
        {
          id: -3,
          period: "归档",
          title: "长期项目与实验",
          organization: "发布后自动进入时间线",
          description: "保持时间线稳定、简洁、可扫描，比堆砌大段文本更适合首页的信息节奏。",
        },
      ];
    case "ja":
      return [
        {
          id: -1,
          period: "現在",
          title: "AI プロダクトとツール",
          organization: "ポートフォリオの内容を整理中",
          description: "公開された経歴はここに時系列で並び、どんな強みがあるかをすばやく伝えます。",
        },
        {
          id: -2,
          period: "最近",
          title: "デザインシステムとフロントエンド",
          organization: "見た目と内容をあわせて更新",
          description: "役割、成果、進め方を短く置くことで、信頼感のあるプロフィール要約になります。",
        },
        {
          id: -3,
          period: "アーカイブ",
          title: "長期プロジェクトと実験",
          organization: "公開後に自動反映",
          description: "長文よりも、流れが追いやすいタイムラインの方がトップページには向いています。",
        },
      ];
    default:
      return [
        {
          id: -1,
          period: "Current",
          title: "AI products and tools",
          organization: "Portfolio content is being organized",
          description: "Published experience will appear here in a clear sequence so visitors can scan strengths quickly.",
        },
        {
          id: -2,
          period: "Recent",
          title: "Design systems and frontend engineering",
          organization: "Visual polish and content will land together",
          description: "This space works best for role, outcome, and collaboration notes rather than a dense wall of text.",
        },
        {
          id: -3,
          period: "Archive",
          title: "Long-running projects and experiments",
          organization: "Auto-filled after publishing",
          description: "A stable, readable timeline gives the homepage a stronger professional rhythm even before everything is filled in.",
        },
      ];
  }
}

function paragraphize(value: string) {
  return value
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function textOrFallback(value: string | undefined, fallback: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}
