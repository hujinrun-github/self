import { Menu } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link } from "react-router-dom";

import styles from "./Public.module.css";

export function PublicLayout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.bar}>
          <Link className={styles.brand} to="/">
            Portfolio
          </Link>
          <button
            aria-label="Toggle navigation"
            className={styles.menuButton}
            onClick={() => setOpen(!open)}
            type="button"
          >
            <Menu aria-hidden="true" size={18} />
          </button>
          <nav aria-label="Primary" className={styles.nav} data-open={open}>
            <Link to="/bio">Bio</Link>
            <Link to="/talks">Talks</Link>
            <Link to="/writing">Writing</Link>
            <Link to="/projects">Projects</Link>
            <Link to="/contact">Contact</Link>
          </nav>
        </div>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
