import { Menu } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";

import { coerceLocale, publicLocaleCopy, supportedLocales, withLocale } from "./locale";
import styles from "./Public.module.css";

type LocaleLink = {
  locale: string;
  path: string;
};

export function PublicLayout({ alternates, children }: { alternates?: LocaleLink[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { locale: localeParam } = useParams();
  const location = useLocation();
  const locale = coerceLocale(localeParam);
  const copy = publicLocaleCopy(locale);
  const localeLinks = alternates ?? supportedLocales.map((targetLocale) => ({
    locale: targetLocale,
    path: withLocale(targetLocale, stripLocalePrefix(location.pathname)),
  }));

  return (
    <div className={styles.shell}>
      <div className={styles.surface}>
        <header className={styles.header}>
          <div className={styles.bar}>
            <Link className={styles.brand} to={withLocale(locale, "/")}>
              {copy.portfolio}
            </Link>
            <button
              aria-label={copy.menuToggle}
              className={styles.menuButton}
              onClick={() => setOpen(!open)}
              type="button"
            >
              <Menu aria-hidden="true" size={18} />
            </button>
            <nav aria-label="Primary" className={styles.nav} data-open={open}>
              <Link className={isActivePath(location.pathname, withLocale(locale, "/")) ? styles.navLinkActive : ""} to={withLocale(locale, "/")}>
                {copy.home}
              </Link>
              <Link className={isActivePath(location.pathname, withLocale(locale, "/bio")) ? styles.navLinkActive : ""} to={withLocale(locale, "/bio")}>
                {copy.bio}
              </Link>
              <Link
                className={isActivePath(location.pathname, withLocale(locale, "/writing")) ? styles.navLinkActive : ""}
                to={withLocale(locale, "/writing")}
              >
                {copy.writing}
              </Link>
              <Link
                className={isActivePath(location.pathname, withLocale(locale, "/projects")) ? styles.navLinkActive : ""}
                to={withLocale(locale, "/projects")}
              >
                {copy.projects}
              </Link>
              <Link
                className={isActivePath(location.pathname, withLocale(locale, "/contact")) ? styles.navLinkActive : ""}
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
                    className={`${styles.localeLink} ${active ? styles.localeLinkActive : ""}`}
                    key={link.locale}
                    to={link.path}
                  >
                    {link.locale.toUpperCase()}
                  </Link>
                );
              })}
            </nav>
          </div>
        </header>
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
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
