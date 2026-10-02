import { Menu, X } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigationType, useParams } from "react-router-dom";

import { coerceLocale, publicLocaleCopy, supportedLocales, withLocale } from "./locale";
import styles from "./Public.module.css";

type LocaleLink = {
  locale: string;
  path: string;
};

export function PublicLayout({ alternates, children }: { alternates?: LocaleLink[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [compact, setCompact] = useState(() => window.matchMedia("(max-width: 820px), (max-height: 500px) and (pointer: coarse)").matches);
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const { locale: localeParam } = useParams();
  const location = useLocation();
  const navigationType = useNavigationType();
  const locale = coerceLocale(localeParam);
  const copy = publicLocaleCopy(locale);
  const localeLinks = alternates ?? supportedLocales.map((targetLocale) => ({
    locale: targetLocale,
    path: withLocale(targetLocale, stripLocalePrefix(location.pathname)),
  }));

  useLayoutEffect(() => {
    if (navigationType !== "POP" && !location.hash) {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }
  }, [location.pathname, location.hash, navigationType]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 820px), (max-height: 500px) and (pointer: coarse)");
    const updateLayout = (event: MediaQueryListEvent) => {
      setCompact(event.matches);
      if (!event.matches) setOpen(false);
    };
    query.addEventListener("change", updateLayout);
    return () => query.removeEventListener("change", updateLayout);
  }, []);

  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !headerRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [open]);

  return (
    <div className={styles.shell} id="top">
      <a className={styles.skipLink} href="#main-content" onClick={() => mainRef.current?.focus()}>
        {skipLinkCopy(locale)}
      </a>
      <div className={styles.surface}>
        <header
          className={styles.header}
          ref={headerRef}
          onKeyDown={(event) => {
            if (event.key === "Escape" && open) {
              event.preventDefault();
              setOpen(false);
              menuButtonRef.current?.focus();
            }
          }}
        >
          <div className={styles.bar}>
            <Link className={styles.brand} to={withLocale(locale, "/")}>
              <span aria-hidden="true" className={styles.brandMark}>研</span>
              <span className={styles.brandName}>{copy.portfolio}</span>
            </Link>
            <button
              aria-controls="public-navigation"
              aria-expanded={open}
              aria-label={copy.menuToggle}
              className={styles.menuButton}
              onClick={() => setOpen((currentOpen) => !currentOpen)}
              ref={menuButtonRef}
              type="button"
            >
              {open ? <X aria-hidden="true" size={18} /> : <Menu aria-hidden="true" size={18} />}
            </button>
            <nav aria-label="Primary" className={styles.nav} data-open={open} id="public-navigation" inert={compact && !open}>
              <Link aria-current={isActivePath(location.pathname, withLocale(locale, "/")) ? "page" : undefined} className={isActivePath(location.pathname, withLocale(locale, "/")) ? styles.navLinkActive : ""} onClick={() => setOpen(false)} to={withLocale(locale, "/")}>
                {copy.home}
              </Link>
              <Link aria-current={isActivePath(location.pathname, withLocale(locale, "/bio")) ? "page" : undefined} className={isActivePath(location.pathname, withLocale(locale, "/bio")) ? styles.navLinkActive : ""} onClick={() => setOpen(false)} to={withLocale(locale, "/bio")}>
                {copy.bio}
              </Link>
              <Link
                aria-current={isActivePath(location.pathname, withLocale(locale, "/writing")) ? "page" : undefined}
                className={isActivePath(location.pathname, withLocale(locale, "/writing")) ? styles.navLinkActive : ""}
                onClick={() => setOpen(false)}
                to={withLocale(locale, "/writing")}
              >
                {copy.writing}
              </Link>
              <Link
                aria-current={isActivePath(location.pathname, withLocale(locale, "/projects")) ? "page" : undefined}
                className={isActivePath(location.pathname, withLocale(locale, "/projects")) ? styles.navLinkActive : ""}
                onClick={() => setOpen(false)}
                to={withLocale(locale, "/projects")}
              >
                {copy.projects}
              </Link>
              <Link
                aria-current={isActivePath(location.pathname, withLocale(locale, "/contact")) ? "page" : undefined}
                className={isActivePath(location.pathname, withLocale(locale, "/contact")) ? styles.navLinkActive : ""}
                onClick={() => setOpen(false)}
                to={withLocale(locale, "/contact")}
              >
                {copy.contact}
              </Link>
            </nav>
            <nav aria-label="Locales" className={styles.localeNav}>
              {localeLinks.map((link) => {
                const active = link.locale === locale;
                return (
                  <Link
                    aria-current={active ? "page" : undefined}
                    className={`${styles.localeLink} ${active ? styles.localeLinkActive : ""}`}
                    key={link.locale}
                    onClick={() => setOpen(false)}
                    to={link.path}
                  >
                    {link.locale.toUpperCase()}
                  </Link>
                );
              })}
            </nav>
          </div>
        </header>
        <main className={styles.main} id="main-content" ref={mainRef} tabIndex={-1}>{children}</main>
        <footer className={styles.footer}>
          <div className={styles.footerRow}>
            <div>
              <strong>{copy.portfolio}</strong>
              <span>{footerCopy(locale)}</span>
            </div>
            <nav aria-label="Footer" className={styles.footerLinks}>
              <Link aria-label={footerLinkLabel(copy.home, locale)} to={withLocale(locale, "/")}>{copy.home}</Link>
              <Link aria-label={footerLinkLabel(copy.projects, locale)} to={withLocale(locale, "/projects")}>{copy.projects}</Link>
              <Link aria-label={footerLinkLabel(copy.writing, locale)} to={withLocale(locale, "/writing")}>{copy.writing}</Link>
              <Link aria-label={footerLinkLabel(copy.contact, locale)} to={withLocale(locale, "/contact")}>{copy.contact}</Link>
            </nav>
            <a className={styles.backToTop} href="#top">{backToTopCopy(locale)}</a>
          </div>
        </footer>
      </div>
    </div>
  );
}

function skipLinkCopy(locale: string) {
  if (locale === "en") {
    return "Skip to main content";
  }
  if (locale === "ja") {
    return "メインコンテンツへスキップ";
  }
  return "跳到主要内容";
}

function footerCopy(locale: string) {
  if (locale === "en") {
    return "Personal portfolio · Continuously updated";
  }
  if (locale === "ja") {
    return "個人ポートフォリオ · 継続的に更新";
  }
  return "个人作品集 · 持续更新";
}

function backToTopCopy(locale: string) {
  if (locale === "en") {
    return "Back to top";
  }
  if (locale === "ja") {
    return "トップへ戻る";
  }
  return "返回顶部";
}

function footerLinkLabel(label: string, locale: string) {
  if (locale === "en") {
    return `${label} footer link`;
  }
  if (locale === "ja") {
    return `${label} フッターリンク`;
  }
  return `${label}页脚链接`;
}

function stripLocalePrefix(pathname: string) {
  const trimmed = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  const [first, ...rest] = trimmed.split("/");
  if (first === "zh" || first === "en" || first === "ja") {
    const remainder = rest.join("/");
    return remainder ? `/${remainder}` : "/";
  }
  return pathname || "/";
}

function isActivePath(pathname: string, href: string) {
  if (href === withLocale("zh", "/") || href === withLocale("en", "/") || href === withLocale("ja", "/")) {
    return pathname === href;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
