import { LibraryView } from "@/components/library-view";

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ collection?: string | string[] }>;
}) {
  const { collection } = await searchParams;
  return <LibraryView collectionId={typeof collection === "string" ? collection : undefined} />;
}
