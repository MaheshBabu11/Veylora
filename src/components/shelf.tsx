import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SeriesCard } from "@/components/series-card";
import type { Series } from "@/types/library";

export function Shelf({
  title,
  note,
  items,
  href,
  compact = false,
}: {
  title: string;
  note?: string;
  items: Series[];
  href?: string;
  compact?: boolean;
}) {
  return (
    <section className="shelf-section">
      <div className="section-heading">
        <div>
          <div className="section-title-row"><h2>{title}</h2>{note && <span className="section-note">{note}</span>}</div>
        </div>
        {href && <Link href={href} className="text-link">See all <ArrowRight size={14} /></Link>}
      </div>
      <div className={`series-grid ${compact ? "series-grid-compact" : ""}`}>
        {items.map((series) => <SeriesCard key={series.id} series={series} compact={compact} />)}
      </div>
    </section>
  );
}
