import { DetailView } from "@/components/detail-view";

export default async function SeriesDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DetailView seriesId={id} />;
}
