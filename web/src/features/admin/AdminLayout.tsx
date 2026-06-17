import { BriefcaseBusiness, FileText, Image, LogOut, Mic2, UserRound } from "lucide-react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";

import { apiFetch, setCSRFToken } from "../../lib/api";
import styles from "./Admin.module.css";

const navItems = [
  { icon: UserRound, label: "Profile", to: "/admin/profile" },
  { icon: BriefcaseBusiness, label: "Experience", to: "/admin/experience" },
  { icon: Mic2, label: "Talks", to: "/admin/talks" },
  { icon: FileText, label: "Writing", to: "/admin/writing" },
  { icon: BriefcaseBusiness, label: "Projects", to: "/admin/projects" },
  { icon: Image, label: "Media", to: "/admin/media" },
];

export function AdminLayout() {
  const navigate = useNavigate();

  async function signOut() {
    await apiFetch("/api/admin/logout", { method: "POST" });
    setCSRFToken("");
    navigate("/admin/login");
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} to="/admin/profile">
          <span>Portfolio</span>
          <strong>Admin</strong>
        </Link>
        <nav aria-label="Admin" className={styles.nav}>
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
          <Link className={styles.button} to="/">
            View site
          </Link>
          <button className={styles.button} onClick={() => void signOut()} type="button">
            <LogOut aria-hidden="true" size={17} />
            Sign out
          </button>
        </div>
      </aside>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
