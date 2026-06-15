import { Link } from "react-router-dom";

import styles from "./Admin.module.css";

export function ContentListPage({ resource }: { resource: string }) {
  return (
    <section className={`${styles.panel} ${styles.stack}`}>
      <div className={styles.actions}>
        <h1>{titleFor(resource)}</h1>
        <Link className={`${styles.button} ${styles.primary}`} to={`/admin/${resource}/new`}>
          New
        </Link>
      </div>
      <p>Draft, publish, archive, reorder, and edit {titleFor(resource).toLowerCase()} entries.</p>
    </section>
  );
}

function titleFor(resource: string) {
  if (resource === "projects") {
    return "Projects";
  }
  if (resource === "writing") {
    return "Writing";
  }
  if (resource === "talks") {
    return "Talks";
  }
  return "Experience";
}
