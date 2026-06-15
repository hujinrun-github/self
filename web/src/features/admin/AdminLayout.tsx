import { Link, Outlet } from "react-router-dom";

import styles from "./Admin.module.css";

export function AdminLayout() {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.bar}>
          <strong>Portfolio Admin</strong>
          <nav aria-label="Admin" className={styles.nav}>
            <Link to="/admin/profile">Profile</Link>
            <Link to="/admin/experience">Experience</Link>
            <Link to="/admin/talks">Talks</Link>
            <Link to="/admin/writing">Writing</Link>
            <Link to="/admin/projects">Projects</Link>
            <Link to="/admin/media">Media</Link>
          </nav>
        </div>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
