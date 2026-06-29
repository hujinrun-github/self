import { BriefcaseBusiness, FileText, FolderKanban, Image, LogOut, Mic2, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";

import { APIRequestError, apiFetch, setCSRFToken } from "../../lib/api";
import styles from "./Admin.module.css";

const navItems = [
  { icon: UserRound, label: "资料", to: "/admin/profile" },
  { icon: BriefcaseBusiness, label: "经历", to: "/admin/experience" },
  { icon: Mic2, label: "演讲", to: "/admin/talks" },
  { icon: FileText, label: "写作", to: "/admin/writing" },
  { icon: FolderKanban, label: "项目", to: "/admin/projects" },
  { icon: Image, label: "媒体", to: "/admin/media" },
];

export function AdminLayout() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

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
            <p className={styles.muted}>正在恢复后台工作区与 CSRF 会话。</p>
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
      <aside className={styles.sidebar} data-testid="admin-sidebar">
        <Link className={styles.brand} to="/admin/profile">
          <span className={styles.brandBadge}>中文主语言控制台</span>
          <strong className={styles.brandWordmark}>内容管理台</strong>
          <span className={styles.brandSubline}>中文主内容、英日辅助语言和媒体素材在同一工作区统一管理。</span>
        </Link>
        <section className={styles.workspaceCard}>
          <div className={styles.sectionIntro}>
            <span className={styles.workspaceEyebrow}>工作区</span>
            <h2>中文主语言工作区</h2>
          </div>
          <p className={styles.workspaceNote}>先维护中文主内容，再推进英日辅助语言草稿、审核和正式发布。</p>
          <div className={styles.workspaceStats}>
            <div className={styles.workspaceStat}>
              <span>主语言</span>
              <strong>中文</strong>
            </div>
            <div className={styles.workspaceStat}>
              <span>辅助语言</span>
              <strong>2</strong>
            </div>
            <div className={styles.workspaceStat}>
              <span>流程</span>
              <strong>AI + 审核</strong>
            </div>
          </div>
        </section>
        <nav aria-label="Admin" className={styles.nav}>
          <span className={styles.navSectionLabel}>内容管理</span>
          {navItems.map(({ icon: Icon, label, to }) => (
            <NavLink
              className={({ isActive }) => (isActive ? `${styles.navLink} ${styles.active}` : styles.navLink)}
              key={to}
              to={to}
            >
              <Icon aria-hidden="true" size={17} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className={styles.sidebarFooter}>
          <Link className={styles.button} to="/zh">
            查看前台
          </Link>
          <button className={styles.button} onClick={() => void signOut()} type="button">
            <LogOut aria-hidden="true" size={17} />
            退出登录
          </button>
        </div>
      </aside>
      <div className={styles.contentFrame}>
        <header className={styles.topbar}>
          <div>
            <span className={styles.topbarEyebrow}>后台工作台</span>
            <h1 className={styles.topbarTitle}>中文内容工作台</h1>
            <p>以中文主表驱动内容管理，再审核英文、日文辅助语言，确保每个公开页面都可控上线。</p>
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
