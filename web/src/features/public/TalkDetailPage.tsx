import { useParams } from "react-router-dom";

import { DetailPage } from "./detail";

export function TalkDetailPage() {
  const { slug = "" } = useParams();
  return <DetailPage endpoint={`/api/site/talks/${slug}`} />;
}
