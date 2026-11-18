# Veylora Development Checklist

Quick reference for implementation priorities and progress tracking.

## Phase 1: Foundation ✅ COMPLETE

- [x] Next.js 16 setup with App Router
- [x] TypeScript strict mode configuration
- [x] Directory structure and module organization
- [x] Zustand store setup
- [x] ESLint configuration
- [x] Development environment
- [x] Build pipeline

---

## Phase 2: Frontend & Design System ✅ COMPLETE

### Components
- [x] AppShell (main layout)
- [x] CoverArt (image display)
- [x] SeriesCard (grid/list item)
- [x] Shelf (horizontal scroll)
- [x] LibraryView (search/filter)
- [x] DetailView (series details)
- [x] ReaderView (reading interface)
- [x] SettingsView (preferences)

### Routes & Pages
- [x] `/` - Dashboard
- [x] `/main/library` - Search & browse
- [x] `/main/series/[id]` - Details
- [x] `/reader/[chapterId]` - Reader
- [x] `/main/recently-added` - New
- [x] `/main/continue-reading` - In progress
- [x] `/main/history` - History
- [x] `/main/collections` - Collections
- [x] `/main/favorites` - Favorites
- [x] `/main/categories` - Genres
- [x] `/main/authors` - Creators
- [x] `/main/settings` - Settings

### Design System
- [x] Theme tokens (colors, spacing, typography)
- [x] Dark/light/system theme toggle
- [x] Responsive layouts
- [x] Tailwind CSS integration
- [x] Accessibility basics
- [x] Component library

### Mock Data
- [x] 50+ series titles
- [x] Chapter hierarchies
- [x] Author/genre taxonomy
- [x] Reading progress simulation

---

## Phase 3: Database Integration 🟡 IMPLEMENTED; VERIFICATION PENDING

### Schema Design
- [x] Create PostgreSQL tables
- [x] `series` - Main titles table
- [x] `chapters` - Chapter hierarchy
- [x] `chapter_pages` - Page tracking
- [x] `authors`, `genres` - Metadata
- [x] `user_preferences` - Settings
- [x] `reading_progress` - User progress
- [x] `reading_history` - Reading events
- [x] `collections`, `bookmarks` - User data
- [x] `scan_jobs` - Durable scan job tracking
- [x] `library_directories` - Roots

### ORM & Migrations
- [x] Install Drizzle ORM
- [x] Create schema definitions
- [ ] Generate TypeScript types
- [x] Write initial migration
- [ ] Implement rollback strategy
- [ ] Create seed data scripts
- [x] Document migration process

### API Routes
- [x] GET `/api/series` - List
- [x] GET `/api/series/[id]` - Details
- [x] GET `/api/series/[id]/chapters` - Chapters
- [x] GET `/api/series/[id]/chapters/[cid]/pages` - Pages
- [x] POST `/api/reading-progress` - Save
- [x] GET `/api/reading-progress` - Fetch
- [x] POST `/api/collections` - Create
- [x] GET `/api/collections` - List
- [x] GET `/api/search` - Full-text search

### Validation & Monitoring
- [x] Zod and equivalent input validation on routes that accept input
- [ ] Request/response logging
- [x] GET `/api/health` - Health check
- [x] Database connection validation
- [x] Shared API error handling
- [ ] Rate limiting configuration

---

## Phase 4: Filesystem & Archive Integration 🟡 PARTIAL

### File System
- [x] Secure root path validation
- [x] Prevent path traversal attacks
- [ ] Permission checks
- [x] Directory watching setup

### Archive Support
- [x] Support CBZ format
- [x] Support CBR format
- [x] Support ZIP format
- [x] Archive enumeration
- [x] Infer series/chapter metadata and index archive pages
- [x] Error handling for corrupted files

### Import Queue
- [ ] Bull/BullMQ setup
- [ ] Import worker process
- [x] Bulk series imports
- [x] Progress tracking
- [x] Durable PostgreSQL scan worker with lease-based recovery
- [x] Scan cancellation, automatic retry with backoff, and manual retry
- [x] Recent scan history in Settings
- [ ] Background processing, cancellation, retry, and history for archive uploads

### Caching & Processing
- [x] Page extraction from archives
- [x] Disk cache implementation
- [ ] LRU memory cache
- [x] Cache invalidation
- [x] Disk usage monitoring

### Image Processing
- [ ] Generate thumbnails
- [ ] Create responsive variants
- [ ] Image format optimization
- [x] Lazy loading implementation
- [ ] Process image queue

---

## Phase 5: Persistence & State Management 🟡 PARTIAL

### Reading Progress
- [x] Track current page per chapter
- [x] Save reading position with timestamp
- [x] Generate "continue reading" list
- [ ] Implement sort by last read

### Reading History
- [x] Log read events with timestamps
- [x] Create history view
- [ ] Filter by date range
- [ ] Export functionality (PDF, JSON)
- [ ] Privacy/retention policies

### User Preferences
- [x] Reader settings (persist mode and direction; provide in-session zoom)
- [x] Theme persistence
- [ ] Language/locale selection
- [ ] View preferences (grid/list)
- [ ] Keyboard shortcuts customization

### Bookmarks & Favorites
- [x] Save/unsave favorites
- [ ] Per-chapter bookmarks
- [ ] Bookmark notes
- [ ] Quick access sidebar

### Collections
- [x] Create custom collections
- [x] Add/remove series
- [ ] Collection descriptions
- [ ] Collection organization
- [ ] Export collection

### Sync Strategy
- [ ] Local-first sync
- [ ] Offline change handling
- [ ] Conflict resolution
- [ ] Batch sync on reconnection
- [ ] Offline fallback

---

## Phase 6: API Integration & Performance 🟡 PARTIAL

### Remove Mock Data
- [x] Remove mock adapters
- [x] Implement real API clients
- [x] Delete mock data files
- [x] Update imports

### TanStack Query Setup
- [x] Configure query client
- [x] Set stale time
- [x] Implement retry logic
- [ ] Add exponential backoff
- [x] Create reusable hooks

#### Query Hooks
- [x] `useSeries(id)`
- [x] `useSeriesList(filters, pagination)`
- [x] `useChapters(seriesId)`
- [ ] `useReadingProgress(userId, seriesId)`
- [ ] `useCollections(userId)`
- [ ] `useSearchSeries(query)`

### Error Handling
- [ ] Error boundary components
- [ ] Fallback UI for routes
- [x] Error logging setup
- [ ] Recovery actions
- [x] User-friendly messages

### Loading States
- [ ] Skeleton screens
- [x] Progressive loading
- [x] Loading indicators
- [ ] Estimated time remaining
- [ ] Cancellation option

### Optimistic Updates
- [ ] Reading progress
- [ ] Favorites toggle
- [ ] Collection updates
- [ ] Bookmark creation
- [ ] Error rollback

---

## Phase 7: Testing, Hardening & Performance 🟡 PARTIAL; VALIDATION PENDING

### Performance Testing
- [ ] Benchmark 10k+ titles
- [ ] Profile memory usage
- [ ] Monitor CPU during load
- [ ] Test slow network (3G)
- [ ] Measure core web vitals
  - [ ] First Contentful Paint (FCP)
  - [ ] Largest Contentful Paint (LCP)
  - [ ] Cumulative Layout Shift (CLS)

### Virtual Scrolling
- [x] Optimize cell sizes
- [x] Configure overscan
- [ ] Scroll position restoration
- [ ] Test with 100k+ items

### Database Optimization
- [x] Add B-tree indexes
- [x] Create search indexes
- [ ] Query execution plans
- [ ] Connection pooling (PgBouncer)
- [ ] Query monitoring

### Search Optimization
- [x] Full-text search (PostgreSQL)
- [x] Trigram indexes (pg_trgm)
- [x] Search query cache
- [ ] Search ranking
- [ ] Advanced search syntax

### Caching
- [x] HTTP caching headers
- [ ] Edge caching (CDN ready)
- [x] Browser cache control
- [ ] ETags
- [ ] Stale-while-revalidate

### Security Hardening
- [x] Input validation on API routes and uploads
- [ ] Content sanitization
- [x] Same-origin checks on state-changing requests
- [ ] Rate limiting
- [ ] Session security
- [ ] Content Security Policy
- [x] SQL injection prevention (parameterized database queries)
- [x] File upload validation

### Integration Testing
- [ ] End-to-end workflows
- [ ] Data consistency
- [ ] Error scenarios
- [ ] Concurrent operations
- [ ] Archive imports

### Load Testing
- [ ] Simulate 1000+ concurrent users
- [ ] Database pool testing
- [ ] Resource monitoring
- [ ] Bottleneck identification
- [ ] Performance baselines

### Monitoring
- [ ] Error tracking (Sentry)
- [ ] Web Vitals monitoring
- [ ] Metrics dashboard
- [ ] Alert configuration
- [ ] Incident procedures

### Documentation
- [ ] API documentation (OpenAPI)
- [ ] Architecture decisions
- [ ] Database schema docs
- [ ] Deployment procedures
- [ ] Troubleshooting guide

---

## Phase 8+: Future Enhancements 🚀 PLANNING

### Mobile & Desktop
- [ ] React Native mobile app
- [ ] Electron desktop app
- [ ] Browser extension
- [ ] CLI tool

### Cloud & Sync
- [ ] Cloud backup
- [ ] Cross-device sync
- [ ] Collaborative collections
- [ ] Profile linking

### Discovery
- [ ] Similar titles algorithm
- [ ] Recommendation engine
- [ ] Trending/popular lists
- [ ] Community ratings

### Social
- [ ] User profiles
- [ ] Review system
- [ ] Reading challenges
- [ ] Social sharing
- [ ] Forums

### Advanced
- [ ] Smart tagging
- [ ] Statistics dashboard
- [ ] Goal tracking
- [ ] Custom lists
- [ ] Series grouping

---

## Quick Status

```
Phase 1: ✅ 100% Complete
Phase 2: ✅ 100% Complete
Phase 3: 🟡 Implemented; app-runtime verification and remaining items open
Phase 4: 🟡 Partial; durable scan jobs are implemented; upload workers and image processing remain
Phase 5: 🟡 Partial; sync, exports, and several user workflows remain
Phase 6: 🟡 Partial; optimistic updates, error boundaries, and missing hooks remain
Phase 7: 🟡 Partial; testing, security review, load, and performance verification remain
Phase 8+: 🚀  Planned
```

---

## Build Status

```
✅ Type Checking: PASSING
✅ Linting: PASSING
✅ Production Build: PASSING
```

---

Remaining work is tracked by unchecked items above; implementation status does not imply runtime, security, load, or performance verification.

---

## Instructions

1. Copy this checklist to an issue tracker (GitHub, Jira, Trello, etc.)
2. Check off items as they're completed
3. Use Phase 3+ sections as sprint planning templates
4. Reference DELIVERY_PHASES.md for detailed requirements
5. Update timestamps when phases start/complete

---

Last Updated: November 17, 2026
Build: Typecheck, lint, and production build verified; deployment validation remains open
Next Focus: Verify scan recovery/cancellation, then add durable upload processing and image thumbnails; complete security/performance testing
