import { ReaderView } from "@/components/reader-view";

export default async function ReaderPage({ params }: { params: Promise<{ chapterId: string }> }) {
  const { chapterId } = await params;
  return <ReaderView key={chapterId} chapterId={chapterId} />;
}
