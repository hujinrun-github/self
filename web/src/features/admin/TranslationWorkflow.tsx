import { CheckCircle2, Languages, Save, Sparkles } from "lucide-react";

import styles from "./Admin.module.css";
import {
  adminTranslationLanguageName,
  translationStatusLabel,
  type TranslationLocale,
  type TranslationStatus,
} from "./adminI18n";

type TranslationWorkflowState = {
  etag: string | null;
  exists: boolean;
  stale: boolean;
  translation_status: TranslationStatus;
};

export function TranslationWorkflow({
  busy,
  locale,
  onGenerate,
  onReview,
  onSave,
  onUnpublish,
  translation,
}: {
  busy: boolean;
  locale: TranslationLocale;
  onGenerate: () => void;
  onReview: () => void;
  onSave: () => void;
  onUnpublish: () => void;
  translation: TranslationWorkflowState;
}) {
  const languageName = adminTranslationLanguageName(locale);
  const isPublished = translation.translation_status === "reviewed" && !translation.stale;
  const canReview = translation.exists && Boolean(translation.etag) && !translation.stale;
  const generateLabel = translation.exists ? `重新 AI 翻译为${languageName}` : `AI 翻译为${languageName}`;

  return (
    <section aria-label={`${languageName}翻译与发布`} className={styles.translationWorkflow}>
      <div className={styles.translationWorkflowHeader}>
        <div className={styles.translationWorkflowCopy}>
          <strong>{languageName}版本</strong>
          <span>{translationWorkflowHint(translation)}</span>
        </div>
        <span className={`${styles.statusBadge} ${translation.stale ? styles.statusStale : ""}`}>
          {translationStatusLabel(translation.translation_status, translation.stale)}
        </span>
      </div>
      <div className={styles.translationWorkflowActions}>
        <button
          aria-label={generateLabel}
          className={`${styles.button} ${!translation.exists || translation.stale ? styles.primary : ""}`}
          disabled={busy}
          onClick={onGenerate}
          type="button"
        >
          <Sparkles aria-hidden="true" size={17} />
          {generateLabel}
        </button>
        <button className={styles.button} disabled={busy} onClick={onSave} type="button">
          <Save aria-hidden="true" size={17} />
          {isPublished ? "保存修改并转为草稿" : "保存人工修改"}
        </button>
        {isPublished ? (
          <button className={styles.button} disabled={busy} onClick={onUnpublish} type="button">
            <Languages aria-hidden="true" size={17} />
            取消发布并转为草稿
          </button>
        ) : (
          <button
            className={`${styles.button} ${canReview ? styles.primary : ""}`}
            disabled={busy || !canReview}
            onClick={onReview}
            type="button"
          >
            <CheckCircle2 aria-hidden="true" size={17} />
            人工审核并发布
          </button>
        )}
      </div>
    </section>
  );
}

function translationWorkflowHint(translation: TranslationWorkflowState) {
  if (translation.stale) {
    return "中文内容已更新，当前译文已失效，请重新翻译或保存后再发布。";
  }
  if (translation.translation_status === "reviewed") {
    return "该版本已在前台生效；再次修改或重新翻译会先转回草稿。";
  }
  if (translation.translation_status === "ai_draft") {
    return "AI 草稿尚未公开，请人工校对后再审核发布。";
  }
  return "尚未生成译文，可以 AI 翻译，也可以直接在下方人工填写。";
}
