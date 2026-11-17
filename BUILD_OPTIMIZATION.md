# Build Optimization Guide

## Overview

Veylora is configured for production-grade optimization with the latest Next.js 16 Turbopack compiler, comprehensive type safety, and efficient static/dynamic rendering patterns.

## Build Configuration

### Next.js Optimization (`next.config.ts`)

- **Turbopack** - High-performance build compiler (default in Next.js 16)
- **React Strict Mode** - Development-only double-render checks to catch side effects
- **HTTP Compression** - Enabled globally for all responses
- **Production Source Maps Disabled** - Reduces build output by ~80%
- **Image Optimization** - WebP/AVIF format support with responsive device sizes

#### Image Configuration
```typescript
images: {
  formats: ["image/avif", "image/webp"],
  deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
  imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  unoptimized: false,
}
```

### TypeScript Configuration (`tsconfig.json`)

- **Strict Mode** - Full type safety enforcement
- **ES2017 Target** - Modern JavaScript with broad compatibility
- **Module Aliasing** - `@/*` paths for cleaner imports
- **Incremental Builds** - Faster rebuilds with type information caching
- **Isolated Modules** - Each file compiles independently (Turbopack compatible)

## Build Scripts

### Development
```bash
npm run dev              # Start dev server with hot reload (Turbopack enabled)
npm run typecheck       # Type checking only
npm run typecheck:watch # Watch mode type checking
```

### Production Build
```bash
npm run build            # Full build with type-check + lint + next build
npm run build:prod       # Production export (if needed)
npm run start            # Start production server
```

### Code Quality
```bash
npm run lint            # ESLint with strict warnings=0
npm run lint:fix        # Auto-fix linting issues
```

### Analysis
```bash
npm run analyze         # Bundle analysis with Webpack Bundle Analyzer (if configured)
```

## Performance Metrics

### Build Performance
- **Turbopack Compilation**: ~2.8 seconds for full build
- **Type Checking**: ~2.9 seconds
- **Static Pages Generated**: 10 static routes
- **Dynamic Routes**: 2 (series/[id], reader/[chapterId])

### Build Output
- **Total Build Size**: ~46 MB (.next directory)
- **Static Assets**: ~968 KB
- **Main Bundle**: Optimized with code splitting

## Optimization Strategies

### 1. Code Splitting
Routes are automatically split into separate bundles:
- `pages/` - Each page gets its own chunk
- `node_modules/` - Vendor code separated for caching
- `common/` - Shared dependencies across pages

### 2. Rendering Strategy
- **Static Generation (SSG)** - Dashboard, library, settings routes (10 pages)
- **On-Demand ISR** - Series details and reader pages
- **Client-Side Hydration** - Interactive components with React 19

### 3. Image Optimization
- Automatic WebP/AVIF conversion
- Responsive image serving by device
- Lazy loading with native `loading="lazy"`
- Prevents layout shift with intrinsic sizing

### 4. Caching Strategy

#### HTTP Caching Headers
```
public/              - Cache 1 year (immutable assets)
.next/static/        - Cache 1 year (content hash in filename)
.next/server/        - No cache (dynamic content)
```

#### Browser Caching
- Service Worker support (can be added in Phase 8)
- Static assets versioned with content hash

### 5. Bundle Analysis

Check bundle sizes with:
```bash
npm run analyze
```

Look for:
- Duplicate dependencies
- Large tree-shaking opportunities
- Unused polyfills

## Production Deployment

### Pre-deployment Checklist
- [ ] All TypeScript strict mode checks pass
- [ ] ESLint lint passes with 0 warnings
- [ ] Build completes successfully
- [ ] Test critical user flows
- [ ] Verify image optimization

### Deployment Steps
```bash
# 1. Type check
npm run typecheck

# 2. Lint
npm run lint

# 3. Build
npm run build

# 4. Test production build locally
npm run start

# 5. Deploy .next/ directory with:
#    - node_modules/ (or use pnpm --prod)
#    - public/
#    - package.json
#    - .env.production (if needed)
```

### Environment Variables
Create `.env.production.local` for production secrets:
```env
DATABASE_URL=postgresql://...
NEXT_PUBLIC_VERSION=0.1.0
```

Never commit secrets to version control.

## Performance Tuning

### Monitoring
- Use Next.js Analytics (built-in)
- Monitor First Contentful Paint (FCP)
- Track Largest Contentful Paint (LCP)
- Watch Cumulative Layout Shift (CLS)

### Optimization Tips

1. **Reduce JavaScript**
   - Use dynamic imports for heavy components
   - Keep client bundles minimal
   - Move logic to server components

2. **Image Optimization**
   - Always use Next.js `Image` component
   - Provide `width` and `height` for static dimensions
   - Use `priority` prop for above-the-fold images

3. **Data Fetching**
   - Leverage ISR for semi-static content
   - Use TanStack Query for client-side caching
   - Implement request deduplication

4. **Third-party Scripts**
   - Use `next/script` for external scripts
   - Load with `strategy="lazyOnload"` when possible
   - Monitor impact with Lighthouse

## Phase-Specific Optimization

### Phase 3 (Database Integration)
- Add database connection pooling
- Implement query result caching
- Use prepared statements

### Phase 4 (Archive Scanning)
- Implement background job queuing (Bull/BullMQ)
- Stream large files to avoid memory issues
- Use worker threads for CPU-intensive tasks

### Phase 6 (API Integration)
- Configure TanStack Query for efficient caching
- Implement request batching
- Add retry logic with exponential backoff

### Phase 7 (Large Library Performance)
- Implement virtual scrolling (already included)
- Add infinite scroll with pagination
- Use database query optimization
- Profile with Chrome DevTools

## Troubleshooting

### Build Errors

**Turbopack Compilation Error**
```
This build is using Turbopack with a webpack config
```
Solution: Remove webpack config, use turbopack config instead.

**Type Errors After Build**
```
Cannot find module '...'
```
Solution: Run `npm run typecheck` and fix errors, then clean `.next/` and rebuild.

### Runtime Performance

**Slow Page Load**
- Check Network tab in DevTools
- Look for large JavaScript bundles
- Verify images are optimized
- Consider using dynamic imports

**High Memory Usage**
- Monitor Node.js process memory
- Check for memory leaks in components
- Use Heap Snapshots in DevTools
- Profile with Chrome DevTools

## Continuous Integration

### GitHub Actions Example
```yaml
name: Build & Deploy
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run build
      - run: npm run start & sleep 3 && curl http://localhost:3000
```

## Future Improvements (Phase 8+)

- [ ] Add bundle analyzer for visual insights
- [ ] Implement service worker for offline support
- [ ] Set up Web Vitals monitoring
- [ ] Configure Sentry for error tracking
- [ ] Implement request logging and tracing
- [ ] Add E2E performance tests
- [ ] Set up automated lighthouse CI checks

## References

- [Next.js Optimization Documentation](https://nextjs.org/docs/app/building-your-application/optimizing)
- [Web Vitals](https://web.dev/vitals/)
- [Turbopack Documentation](https://turbo.build/pack)
- [React 19 Performance](https://react.dev/reference/react/version-19)
