import { Link } from "react-router-dom";
import { useEffect, useState } from "react";

import { apiFetch } from "../../lib/api";
import { PublicLayout } from "./PublicLayout";
import styles from "./Public.module.css";

type Summary = {
  id: number;
  title: string;
  slug?: string;
  summary?: string;
  featured?: boolean;
};

type Experience = {
  id: number;
  period: string;
  title: string;
  organization: string;
  description: string;
};

type HomePayload = {
  experiences: Experience[];
  talks: Summary[];
  writing: Summary[];
  projects: Summary[];
};

export function HomePage() {
  const [home, setHome] = useState<HomePayload | null>(null);

  useEffect(() => {
    apiFetch<HomePayload>("/api/site/home").then(setHome).catch(() => {
      setHome({ experiences: [], projects: [], talks: [], writing: [] });
    });
  }, []);

  return (
    <PublicLayout>
      <section className={styles.hero}>
        <div>
          <h1>Portfolio</h1>
          <p className={styles.lede}>Selected work, writing, talks, and professional notes.</p>
          <div className={styles.actions}>
            <Link className={styles.button} to="/contact">
              Contact
            </Link>
            <Link className={styles.button} to="/projects">
              Projects
            </Link>
          </div>
        </div>
        <div className={styles.card}>
          <strong>Now</strong>
          <p className={styles.muted}>Building reliable software systems and clear product experiences.</p>
        </div>
      </section>
      <section className={`${styles.section} ${styles.split}`}>
        <div>
          <h2>Experience</h2>
          {(home?.experiences ?? []).map((item) => (
            <article key={item.id}>
              <strong>{item.period}</strong>
              <h3>{item.title}</h3>
              <p className={styles.muted}>{item.organization}</p>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
        <div>
          <h2>Bio</h2>
          <p className={styles.lede}>A concise profile with links, background, and current focus.</p>
        </div>
      </section>
      <CardSection items={home?.talks ?? []} title="Featured Talks" to="/talks" />
      <CardSection items={home?.writing ?? []} title="Writing" to="/writing" />
      <CardSection items={home?.projects ?? []} title="Projects" to="/projects" />
    </PublicLayout>
  );
}

function CardSection({ items, title, to }: { items: Summary[]; title: string; to: string }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <section className={styles.section}>
      <h2>{title}</h2>
      <div className={styles.grid}>
        {items.map((item) => (
          <Link className={styles.card} key={item.id} to={`${to}/${item.slug ?? item.id}`}>
            <div className={styles.media} />
            <h3>{item.title}</h3>
            {item.summary ? <p className={styles.muted}>{item.summary}</p> : null}
          </Link>
        ))}
      </div>
    </section>
  );
}
