"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, BookmarkCheck, BookOpen, ChevronLeft, ChevronRight, Library, Play, Sparkles, Tags } from "lucide-react";
import { CoverArt } from "@/components/cover-art";
import { Shelf } from "@/components/shelf";
import { useSeriesList } from "@/services/library";

export function Dashboard() {
  const { data } = useSeriesList({ limit: 24, sort: "updated" });
  const { data: featuredData } = useSeriesList({ featured: true, limit: 500, sort: "updated" });
  const seriesLibrary = data?.items ?? [];
  const featuredSeries = featuredData?.items ?? [];
  const heroSlides = featuredSeries.length > 0 ? featuredSeries : seriesLibrary.slice(0, 1);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [hoveringHero, setHoveringHero] = useState(false);
  const [focusingHero, setFocusingHero] = useState(false);
  const activeIndex = heroSlides.length ? activeSlideIndex % heroSlides.length : 0;
  const featured = heroSlides[activeIndex];
  const continueItems = seriesLibrary.filter((series) => series.status === "Reading" && series.lastChapterId);
  const plannedItems = seriesLibrary.filter((series) => series.status === "Plan to read");
  const featuredIds = new Set(featuredSeries.map((series) => series.id));
  const otherItems = seriesLibrary.filter((series) => !featuredIds.has(series.id) && series.id !== featured?.id);

  useEffect(() => {
    if (heroSlides.length < 2 || hoveringHero || focusingHero) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setTimeout(() => {
      setActiveSlideIndex((index) => (index + 1) % heroSlides.length);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [activeSlideIndex, focusingHero, heroSlides.length, hoveringHero]);

  const showSlide = (index: number) => {
    setActiveSlideIndex((index % heroSlides.length + heroSlides.length) % heroSlides.length);
  };

  return (
    <div className="dashboard-page page-enter">
      <section
        className="hero-banner"
        role="region"
        aria-roledescription="carousel"
        aria-label="Featured series"
        aria-live="off"
        onMouseEnter={() => setHoveringHero(true)}
        onMouseLeave={() => setHoveringHero(false)}
        onFocusCapture={() => setFocusingHero(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusingHero(false);
        }}
      >
        {featured && <div className="hero-artwork" key={`art-${featured.id}`}><CoverArt series={featured} priority /></div>}
        <div className="hero-banner-shade" />
        <div className="hero-content" key={`copy-${featured?.id ?? "empty"}`}>
          <p className="hero-kicker"><span className="hero-kicker-mark"><Sparkles size={13} /></span> YOUR STORIES. YOUR SCREEN.</p>
          <h1>{featured?.title ?? "Your next favorite story starts here."}</h1>
          {featured ? (
            <>
              <div className="hero-meta">
                <span className="hero-featured-tag"><Sparkles size={12} /> FEATURED SERIES</span>
                <span><BookOpen size={13} /> {featured.chapters} chapters</span>
                {featured.genres.slice(0, 2).map((genre) => <span key={genre}><Tags size={12} /> {genre}</span>)}
              </div>
              <p className="hero-description">{featured.description || "A new story is waiting in your collection."}</p>
              <div className="hero-actions">
                <Link
                  href={featured.lastChapterId ? `/reader/${featured.lastChapterId}` : `/series/${featured.id}`}
                  className="button hero-primary"
                >
                  <Play size={16} fill="currentColor" />
                  {featured.lastChapterId ? "Continue reading" : "Explore series"}
                </Link>
                <Link href={`/series/${featured.id}`} className="button hero-secondary">
                  <BookOpen size={16} /> More info
                </Link>
              </div>
            </>
          ) : (
            <>
              <p className="hero-description">Import your CBZ and ZIP books to build a personal streaming library that stays right on your device.</p>
              <div className="hero-actions">
                <Link href="/library" className="button hero-primary"><BookOpen size={16} /> Explore library</Link>
              </div>
            </>
          )}
        </div>
        <div className="hero-carousel-controls">
          <div className="hero-index"><span>VEYLORA</span><i /> {featured ? String(activeIndex + 1).padStart(2, "0") : "00"} / {String(heroSlides.length).padStart(2, "0")}</div>
          {heroSlides.length > 1 && (
            <div className="hero-carousel-actions" aria-label="Featured series controls">
              <button type="button" className="hero-carousel-button" onClick={() => showSlide(activeIndex - 1)} aria-label="Previous featured series" title="Previous featured series">
                <ChevronLeft size={17} />
              </button>
              <div className="hero-carousel-dots" role="group" aria-label="Choose a featured series">
                {heroSlides.map((series, index) => (
                  <button
                    key={series.id}
                    type="button"
                    className={index === activeIndex ? "active" : ""}
                    onClick={() => showSlide(index)}
                    aria-label={`Show featured series ${index + 1}: ${series.title}`}
                    aria-pressed={index === activeIndex}
                  />
                ))}
              </div>
              <button type="button" className="hero-carousel-button" onClick={() => showSlide(activeIndex + 1)} aria-label="Next featured series" title="Next featured series">
                <ChevronRight size={17} />
              </button>
            </div>
          )}
        </div>
      </section>

      <div className="dashboard-content">
        <div className="dashboard-library-heading">
          <div>
            <p className="eyebrow"><span className="eyebrow-line" /> YOUR PERSONAL COLLECTION</p>
            <h2>Stories picked for you.</h2>
          </div>
          <Link href="/library" className="text-link">Browse all titles <ArrowRight size={14} /></Link>
        </div>

        <div className="dashboard-ritual" aria-label="Explore your library">
          <Link href="/library" className="dashboard-ritual-card">
            <span className="dashboard-ritual-icon"><Library size={18} /></span>
            <span className="dashboard-ritual-copy"><strong>Every story, together</strong><small>Browse your personal archive</small></span>
            <ArrowRight size={15} />
          </Link>
          <Link href="/continue-reading" className="dashboard-ritual-card">
            <span className="dashboard-ritual-icon ritual-icon-warm"><BookmarkCheck size={18} /></span>
            <span className="dashboard-ritual-copy"><strong>Pick up the thread</strong><small>Your place is always saved</small></span>
            <ArrowRight size={15} />
          </Link>
          <Link href="/categories" className="dashboard-ritual-card">
            <span className="dashboard-ritual-icon ritual-icon-soft"><Tags size={18} /></span>
            <span className="dashboard-ritual-copy"><strong>Find your next mood</strong><small>Explore stories by genre</small></span>
            <ArrowRight size={15} />
          </Link>
        </div>

        {continueItems.length > 0 && (
          <Shelf title="Continue reading" note="Jump back into your story" items={continueItems} href="/continue-reading" compact />
        )}
        {otherItems.length > 0 && (
          <Shelf title="Recently added" note="Fresh from your library" items={otherItems} href="/recently-added" />
        )}
        {plannedItems.length > 0 && (
          <Shelf title="On your list" note="Your next great read" items={plannedItems} href="/library" compact />
        )}

        {seriesLibrary.length === 0 && (
          <div className="dashboard-empty">
            <span><BookOpen size={21} /></span>
            <div><strong>Your library is ready for its first story.</strong><p>Use Import in the navigation to add local book archives.</p></div>
          </div>
        )}

        <div className="dashboard-local-note"><Sparkles size={15} /><span>Your library, beautifully organized and always on your device.</span><Link href="/settings">Library settings <ArrowRight size={13} /></Link></div>
      </div>
    </div>
  );
}
