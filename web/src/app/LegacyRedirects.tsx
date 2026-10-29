import { Navigate, useParams } from "react-router-dom";

export function LegacyJournalRedirect() {
  const { notebookId = "" } = useParams();
  return (
    <Navigate replace to={`/zh/journal/${encodeURIComponent(notebookId)}`} />
  );
}

export function LegacySlugRedirect({
  resource,
}: {
  resource: "projects" | "writing";
}) {
  const { slug = "" } = useParams();
  return <Navigate replace to={`/zh/${resource}/${slug}`} />;
}

export function LocaleHomeRedirect() {
  const { locale = "zh" } = useParams();
  return <Navigate replace to={`/${locale}`} />;
}
