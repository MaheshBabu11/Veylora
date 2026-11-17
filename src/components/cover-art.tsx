import type { Series } from "@/types/library";
import Image from "next/image";

const artwork: Record<Series["art"], React.ReactNode> = {
  mountain: (
    <>
      <i className="cover-sun" />
      <i className="cover-peak cover-peak-back" />
      <i className="cover-peak cover-peak-front" />
      <i className="cover-person" />
    </>
  ),
  moon: (
    <>
      <i className="cover-moon" />
      <i className="cover-cloud cover-cloud-one" />
      <i className="cover-cloud cover-cloud-two" />
      <i className="cover-person" />
    </>
  ),
  flower: (
    <>
      <i className="cover-stem" />
      <i className="cover-bloom" />
      <i className="cover-leaf cover-leaf-one" />
      <i className="cover-leaf cover-leaf-two" />
    </>
  ),
  ocean: (
    <>
      <i className="cover-moon" />
      <i className="cover-wave cover-wave-one" />
      <i className="cover-wave cover-wave-two" />
      <i className="cover-boat" />
    </>
  ),
  city: (
    <>
      <i className="cover-city-block cover-city-one" />
      <i className="cover-city-block cover-city-two" />
      <i className="cover-city-block cover-city-three" />
      <i className="cover-sun" />
    </>
  ),
  sun: (
    <>
      <i className="cover-sun cover-sun-large" />
      <i className="cover-horizon" />
      <i className="cover-person" />
    </>
  ),
};

export function CoverArt({
  series,
  className = "",
  priority = false,
}: {
  series: Series;
  className?: string;
  priority?: boolean;
}) {
  if (series.coverUrl) {
    return (
      <div
        className={`cover-art cover-art-${series.art} ${className}`}
        style={{ "--cover-color": series.color, "--cover-accent": series.accent, position: "relative" } as React.CSSProperties}
      >
        <Image
          src={series.coverUrl}
          alt={`${series.title} cover`}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          fill
          unoptimized
          sizes={priority ? "100vw" : "(max-width: 650px) 45vw, 220px"}
          style={{ objectFit: "cover" }}
        />
      </div>
    );
  }
  return (
    <div
      className={`cover-art cover-art-${series.art} ${className}`}
      style={{ "--cover-color": series.color, "--cover-accent": series.accent } as React.CSSProperties}
      aria-label={`${series.title} cover`}
      role="img"
    >
      <div className="cover-grain" />
      <div className="cover-illustration">{artwork[series.art]}</div>
      <div className="cover-copy">
        <span className="cover-kicker">{series.author.split(" ")[0]} / VEYLORA</span>
        <strong>{series.title}</strong>
        <span>{series.subtitle}</span>
      </div>
      <span className="cover-volume">VOL. {String(series.chapters).padStart(2, "0")}</span>
    </div>
  );
}
