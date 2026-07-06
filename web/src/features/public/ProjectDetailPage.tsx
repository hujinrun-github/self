import { useParams } from "react-router-dom";

import { DetailPage } from "./detail";
import { coerceLocale, withLocaleQuery } from "./locale";

export function ProjectDetailPage() {
  const { locale: localeParam, slug = "" } = useParams();
  const locale = coerceLocale(localeParam);
  return <DetailPage endpoint={withLocaleQuery(`/api/site/projects/${slug}`, locale)} />;
}
