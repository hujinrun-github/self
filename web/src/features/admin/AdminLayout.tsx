import { BriefcaseBusiness, FileText, FolderKanban, Image, LogOut, Menu, MessageSquare, Mic2, UserRound, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";

import { APIRequestError, apiFetch, setCSRFToken } from "../../lib/api";
import styles from "./Admin.module.css";

const navItems = [
  { icon: UserRound, label: "资料", to: "/admin/profile" },
  { icon: BriefcaseBusiness, label: "经历", to: "/admin/experience" },
  { icon: Mic2, label: "演讲", to: "/admin/talks" },
  { icon: FileText, label: "写作", to: "/admin/writing" },
  { icon: MessageSquare, label: "互动", to: "/admin/engagement" },
  { icon: FolderKanban, label: "项目", to: "/admin/projects" },
  { icon: Image, label: "媒体", to: "/admin/media" },
];

export function AdminLayout() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarCloseRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 981px)");
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) {
        setMenuOpen(false);
      }
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const sidebar = sidebarRef.current;
    const menuButton = menuButtonRef.current;
    const sidebarClose = sidebarCloseRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Let the closed sidebar's visibility transition enter its visible frame first.
    let focusFrame = requestAnimationFrame(() => {
      focusFrame = requestAnimationFrame(() => {
        if (!sidebar?.contains(document.activeElement)) {
          sidebarClose?.focus();
        }
      });
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const controls = sidebar?.querySelectorAll<HTMLElement>("a[href], button:not(:disabled)");
      const first = controls?.[0];
      const last = controls?.[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      if (window.matchMedia("(min-width: 981px)").matches) {
        sidebar?.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
      } else {
        menuButton?.focus();
      }
    };
  }, [menuOpen]);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      try {
        const session = await apiFetch<{ admin: { id: number }; csrf_token: string }>("/api/admin/me");
        if (cancelled) {
          return;
        }
        setCSRFToken(session.csrf_token);
        setReady(true);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setCSRFToken("");
        if (error instanceof APIRequestError && error.status === 401) {
          navigate("/admin/login", { replace: true });
          return;
        }
        navigate("/admin/login", { replace: true });
      }
    }

    void restoreSession();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function signOut() {
    try {
      await apiFetch("/api/admin/logout", { method: "POST" });
    } finally {
      setCSRFToken("");
      navigate("/admin/login", { replace: true });
    }
  }

  if (!ready) {
    return (
      <div aria-busy="true" className={styles.loadingShell}>
        <aside className={styles.loadingSidebar}>
          <section className={styles.loadingPanel}>
            <span className={styles.brandBadge}>内容管理台</span>
            <strong className={styles.brandWordmark}>正在恢复会话</strong>
            <p className={styles.muted}>正在准备你的内容工作区。</p>
          </section>
        </aside>
        <main className={styles.main}>
          <section className={styles.panel}>
            <p className={styles.muted}>正在检查管理员登录状态...</p>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className={styles.shell} data-testid="admin-shell">
      {menuOpen ? (
        <button aria-label="关闭后台导航遮罩" className={styles.sidebarBackdrop} onClick={() => setMenuOpen(false)} tabIndex={-1} type="button" />
      ) : null}
      <aside
        aria-label="后台导航"
        aria-modal={menuOpen ? true : undefined}
        className={styles.sidebar}
        data-open={menuOpen}
        data-testid="admin-sidebar"
        id="admin-navigation"
        ref={sidebarRef}
        role={menuOpen ? "dialog" : undefined}
      >
        <Link className={styles.brand} onClick={() => setMenuOpen(false)} to="/admin/profile">
          <span aria-hidden="true" className={styles.brandMark}>研</span>
          <span className={styles.brandText}><strong className={styles.brandWordmark}>内容管理台</strong></span>
        </Link>
        <button aria-label="关闭后台导航" className={styles.sidebarClose} onClick={() => setMenuOpen(false)} ref={sidebarCloseRef} type="button">
          <X aria-hidden="true" size={20} />
        </button>
        <nav aria-label="Admin" className={styles.nav}>
          <span className={styles.navSectionLabel}>内容管理</span>
          {navItems.map(({ icon: Icon, label, to }) => (
            <NavLink
              className={({ isActive }) => (isActive ? `${styles.navLink} ${styles.active}` : styles.navLink)}
              key={to}
              onClick={() => setMenuOpen(false)}
              to={to}
            >
              <Icon aria-hidden="true" size={17} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className={styles.sidebarFooter}>
          <Link className={styles.button} onClick={() => setMenuOpen(false)} to="/zh">
            查看前台
          </Link>
          <button className={styles.button} onClick={() => void signOut()} type="button">
            <LogOut aria-hidden="true" size={17} />
            退出登录
          </button>
        </div>
      </aside>
      <div className={styles.contentFrame} inert={menuOpen}>
        <header className={styles.topbar}>
          <button
            aria-controls="admin-navigation"
            aria-expanded={menuOpen}
            aria-label="切换后台导航"
            className={styles.menuButton}
            onClick={() => setMenuOpen((open) => !open)}
            ref={menuButtonRef}
            type="button"
          >
            <Menu aria-hidden="true" size={20} />
          </button>
          <div>
            <strong className={styles.topbarTitle}>中文内容工作台</strong>
            <p>管理内容，记录创作。</p>
          </div>
          <div className={styles.topbarMeta}>
            <span className={styles.topbarPill}>中文主内容</span>
            <span className={styles.topbarPill}>英文 / 日文辅助语言</span>
          </div>
        </header>
        <main className={styles.main}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
