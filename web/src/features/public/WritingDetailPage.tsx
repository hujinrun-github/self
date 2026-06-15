import { useParams } from "react-router-dom";

import { DetailPage } from "./detail";

export function WritingDetailPage() {
  const { slug = "" } = useParams();
  return <DetailPage endpoint={`/api/site/writing/${slug}`} />;
}
