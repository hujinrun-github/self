import styles from "./Public.module.css";

type ProfileAvatarProps = {
  mediaID?: number | null;
  name: string;
};

export function ProfileAvatar({ mediaID, name }: ProfileAvatarProps) {
  const avatarURL = mediaID ? `/media/${mediaID}/avatar` : "";
  return (
    <div className={styles.heroAvatar}>
      {avatarURL ? (
        <img alt={name} className={styles.heroAvatarImage} decoding="async" src={avatarURL} />
      ) : (
        initialsFor(name)
      )}
    </div>
  );
}

function initialsFor(value: string) {
  const words = value
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (words.length === 0) {
    return "P";
  }
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .toUpperCase();
}
