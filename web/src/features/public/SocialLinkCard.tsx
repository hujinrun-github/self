import styles from "./Public.module.css";

export type PublicSocialLink = {
  icon?: string;
  id: number;
  label: string;
  url: string;
};

export function SocialLinkCard({ link }: { link: PublicSocialLink }) {
  const iconURL = mediaURLFromIcon(link.icon);

  return (
    <a
      aria-label={`${link.label} ${link.url}`}
      className={styles.socialCard}
      href={link.url}
      rel="noreferrer"
      target="_blank"
    >
      <span className={styles.socialIcon}>
        {iconURL ? <img alt={link.label} src={iconURL} /> : <span aria-hidden="true">{initialFor(link.label)}</span>}
      </span>
      <span className={styles.socialText}>
        <strong>{link.label}</strong>
        <span className={styles.muted}>{link.url}</span>
      </span>
    </a>
  );
}

function mediaURLFromIcon(icon?: string) {
  const match = icon?.match(/media:\/\/asset\/(\d+)\/([a-zA-Z0-9_-]+)/);
  return match ? `/media/${match[1]}/${match[2]}` : "";
}

function initialFor(label: string) {
  return label.trim().charAt(0).toUpperCase() || "L";
}
