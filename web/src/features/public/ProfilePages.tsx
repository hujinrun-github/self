import { ArrowRight, Mail, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";

import { MarkdownView } from "../../components/markdown/MarkdownView";
import { apiFetch } from "../../lib/api";
import { usePublicPageMeta } from "./head";
import { coerceLocale, publicLocaleCopy, withLocale, withLocaleQuery } from "./locale";
import { ProfileAvatar } from "./ProfileAvatar";
import { PublicLayout } from "./PublicLayout";
import { SocialLinkCard, type PublicSocialLink } from "./SocialLinkCard";
import styles from "./Public.module.css";

type SocialLink = PublicSocialLink;

type ProfilePayload = {
  avatar_media_id?: number | null;
  bio: string;
  email: string;
  fallback_from?: string;
  headline: string;
  name: string;
  requested_locale: string;
  resolved_locale: string;
  social_links: SocialLink[];
  summary: string;
};

export function BioPage() {
  const { locale, profile } = usePublicProfile();
  const location = useLocation();
  const copy = publicLocaleCopy(locale);
  const canonicalPath = profile?.fallback_from ? withLocale(profile.resolved_locale as "zh" | "en" | "ja", "/bio") : location.pathname;
  const displayName = textOrFallback(profile?.name, copy.portfolio);
  const displayHeadline = textOrFallback(profile?.headline, copy.placeholderHeadline);
  const displaySummary = textOrFallback(profile?.summary, copy.placeholderSummary);
  const biography = textOrFallback(profile?.bio, copy.placeholderBio);

  usePublicPageMeta({
    alternates: (["zh", "en", "ja"] as const).map((targetLocale) => ({
      href: withLocale(targetLocale, "/bio"),
      hreflang: targetLocale,
    })),
    canonicalPath,
    description: displaySummary,
    robots: profile?.fallback_from ? "noindex, follow" : "",
    title: profile?.name ? `${profile.name} | ${copy.portfolio}` : `${copy.bio} | ${copy.portfolio}`,
  });

  return (
    <PublicLayout>
      <section className={styles.hero} data-testid="public-profile-hero">
        <div className={styles.heroCopy}>
          <div className={styles.sectionLabel}>
            <UserRound aria-hidden="true" size={16} />
            <span>{copy.bio}</span>
          </div>
          <h1>{displayName}</h1>
          <p className={styles.heroHeadline}>{displayHeadline}</p>
          <div className={styles.stack}>
            <p className={styles.lede}>{displaySummary}</p>
            <p className={styles.bodyText}>{copy.profileDescription}</p>
          </div>
          <div className={styles.actions}>
            <Link className={styles.button} to={withLocale(locale, "/contact")}>
              {copy.stayInTouch}
            </Link>
            <Link className={styles.textButton} to={withLocale(locale, "/projects")}>
              {copy.viewAllProjects}
              <ArrowRight aria-hidden="true" size={16} />
            </Link>
          </div>
        </div>
        <div className={styles.heroPanel}>
          <div className={styles.heroGlow} />
          <ProfileAvatar mediaID={profile?.avatar_media_id} name={displayName} />
          <div className={styles.heroNote}>
            <strong>{copy.contact}</strong>
            <p className={styles.muted}>{profile?.email?.trim() || copy.contactDescription}</p>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.twoPanelGrid}>
          <article className={styles.panel}>
            <SectionHeading icon={<UserRound aria-hidden="true" size={18} />} title={copy.bio} />
            {profile?.bio?.trim() ? (
              <MarkdownView markdown={profile.bio} media={{}} />
            ) : (
              <div className={styles.stack}>
                {paragraphize(biography).map((paragraph) => (
                  <p className={styles.bodyText} key={paragraph}>
                    {paragraph}
                  </p>
                ))}
              </div>
            )}
          </article>

          <aside className={styles.panel} data-testid="public-profile-sidebar">
            <SectionHeading icon={<Mail aria-hidden="true" size={18} />} title={copy.stayInTouch} />
            {profile?.email?.trim() ? (
              <a className={styles.contactCard} href={`mailto:${profile.email}`}>
                <strong>{profile.email}</strong>
                <span className={styles.muted}>{copy.contactDescription}</span>
              </a>
            ) : (
              <div className={`${styles.contactCard} ${styles.contactCardStatic}`}>
                <strong>{copy.contact}</strong>
                <span className={styles.muted}>{copy.contactDescription}</span>
              </div>
            )}
            <div className={styles.socialGrid}>
              {profile?.social_links?.length ? (
                profile.social_links.map((link) => (
                  <SocialLinkCard key={link.id} link={link} />
                ))
              ) : (
                <div className={`${styles.socialCard} ${styles.socialCardStatic}`}>
                  <strong>{copy.emptyCollectionTitle}</strong>
                  <span className={styles.muted}>{copy.emptyCollectionDescription}</span>
                </div>
              )}
            </div>
          </aside>
        </div>
      </section>
    </PublicLayout>
  );
}

export function ContactPage() {
  const { locale, profile } = usePublicProfile();
  const location = useLocation();
  const copy = publicLocaleCopy(locale);
  const canonicalPath =
    profile?.fallback_from ? withLocale(profile.resolved_locale as "zh" | "en" | "ja", "/contact") : location.pathname;
  const displayHeadline = textOrFallback(profile?.headline, copy.placeholderHeadline);
  const displaySummary = textOrFallback(profile?.summary, copy.placeholderSummary);

  usePublicPageMeta({
    alternates: (["zh", "en", "ja"] as const).map((targetLocale) => ({
      href: withLocale(targetLocale, "/contact"),
      hreflang: targetLocale,
    })),
    canonicalPath,
    description: displaySummary,
    robots: profile?.fallback_from ? "noindex, follow" : "",
    title: `${copy.contact} | ${copy.portfolio}`,
  });

  return (
    <PublicLayout>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <div className={styles.sectionLabel}>
            <Mail aria-hidden="true" size={16} />
            <span>{copy.contact}</span>
          </div>
          <h1>{copy.stayInTouch}</h1>
          <p className={styles.heroHeadline}>{displayHeadline}</p>
          <div className={styles.stack}>
            <p className={styles.lede}>{displaySummary}</p>
            <p className={styles.bodyText}>{copy.contactDescription}</p>
          </div>
        </div>
        <div className={styles.heroPanel}>
          <div className={styles.heroGlow} />
          <ProfileAvatar mediaID={profile?.avatar_media_id} name={profile?.name?.trim() || copy.contact} />
          <div className={styles.heroNote}>
            <strong>{copy.contact}</strong>
            <p className={styles.muted}>{profile?.email?.trim() || copy.contactDescription}</p>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.twoPanelGrid}>
          <article className={styles.panel}>
            <SectionHeading icon={<Mail aria-hidden="true" size={18} />} title={copy.contact} />
            {profile?.email?.trim() ? (
              <a className={styles.contactCard} href={`mailto:${profile.email}`}>
                <strong>{profile.email}</strong>
                <span className={styles.muted}>{copy.contactDescription}</span>
              </a>
            ) : (
              <div className={`${styles.contactCard} ${styles.contactCardStatic}`}>
                <strong>{copy.contact}</strong>
                <span className={styles.muted}>{copy.contactDescription}</span>
              </div>
            )}
          </article>

          <article className={styles.panel}>
            <SectionHeading icon={<UserRound aria-hidden="true" size={18} />} title={copy.bio} />
            <div className={styles.socialGrid}>
              {profile?.social_links?.length ? (
                profile.social_links.map((link) => (
                  <SocialLinkCard key={link.id} link={link} />
                ))
              ) : (
                <div className={`${styles.socialCard} ${styles.socialCardStatic}`}>
                  <strong>{copy.emptyCollectionTitle}</strong>
                  <span className={styles.muted}>{copy.emptyCollectionDescription}</span>
                </div>
              )}
            </div>
          </article>
        </div>
      </section>
    </PublicLayout>
  );
}

function usePublicProfile() {
  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const { locale: localeParam } = useParams();
  const locale = coerceLocale(localeParam);

  useEffect(() => {
    apiFetch<ProfilePayload>(withLocaleQuery("/api/site/profile", locale)).then(setProfile).catch(() => {
      setProfile(null);
    });
  }, [locale]);

  return useMemo(() => ({ locale, profile }), [locale, profile]);
}

function SectionHeading({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className={styles.sectionHeading}>
      {icon}
      <h2>{title}</h2>
    </div>
  );
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
