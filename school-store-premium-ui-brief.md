# School Store: Premium UI, Images and Motion Brief

Live site: https://school-store.aqualite.workers.dev/

You are upgrading an existing school e-commerce store (uniforms, shoes, accessories, stationery, ID cards). Parents pick a school and class, then buy that school's approved items. Most buyers are on mid-range Android phones, so everything must stay fast and smooth there, not only on a desktop.

## How to work

- Do the phases in order. Finish one, run its acceptance checks, give me a short report, then start the next.
- Before Phase 1, read the whole frontend and tell me the framework, styling approach, routing, data-fetching method and any animation library already installed. Adapt the instructions below to that stack instead of rewriting it.
- Do not add features, rename the brand, or change backend behaviour beyond what is written here. The brand name is still undecided, so keep the name and logo text in one config constant.
- Do not add GSAP, Anime.js or any animation library other than the two named in Phase 2.

## Global rules (apply to every phase)

- Animate only `transform`, `opacity`, `clip-path` and `filter`. Never animate width, height, top, left or margin.
- One easing for the whole site: `[0.16, 1, 0.3, 1]`. Three durations only: fast 0.2s (hover, press), base 0.5s (reveals), slow 0.9s (hero, page transitions). Define them as shared constants and use nothing else.
- No bounce, no spring overshoot, no animation that replays every time an element scrolls into view. Reveals run once.
- `prefers-reduced-motion`: all movement is disabled and elements appear in their final state.
- Every animation must hold 60fps with Chrome DevTools CPU throttling at 4x. If it does not, simplify it.
- Keep the existing palette: warm off-white background, dark green brand colour, near-black text, one gold accent. Gold is used only for thin lines and small details, never as a large fill.
- No countdown timers, fake urgency, star ratings, discount pop-ups or emoji in the UI.
- Check every change at 360, 768, 1280 and 1440px wide.

---

## Phase 1: Fix before polish

1. **School selection.** Find where the selected school is stored. If a school is selected by a hardcoded default or seed value, remove it so a first-time visitor has no school selected. Keep guest persistence in localStorage. On sign-in, merge the guest's school and guest cart into the account.
2. **Header.** The nav items "ID Cards" and "Sign in" wrap onto two lines at 1280-1440px. Make every nav item single-line (`white-space: nowrap`), tighten the gaps, truncate the school name with an ellipsis, and collapse the nav into a hamburger drawer below 1024px.
3. **Primary button.** "Find my school" is an unstyled default button. Style it as the primary CTA: dark green fill matching the logo, white text, 12px radius, with hover, pressed and focus-visible states. Apply the same style to every primary button on the site.
4. **Hero state.** If a school is already selected, replace the search box with "Shopping for {school name}", a "Continue shopping" CTA and a small "Change school" link. Show the search box only when no school is selected.

**Acceptance:** no wrapped nav text at any of the four widths; a fresh incognito visit shows no school and an empty cart; no console errors.

---

## Phase 2: Motion foundation

Install `motion` (import from `motion/react`) and `lenis`. Nothing else.

**Smooth scroll.** Enable Lenis on desktop pointer devices only (lerp 0.1). Disable it on touch devices and for reduced-motion users; they get native scroll.

**Build these reusable components in one folder:**

- `Reveal`: opacity 0 to 1, 24px rise, blur 6px to 0, base duration, on first entry.
- `Stagger`: wraps children and reveals them 60ms apart.
- `TextReveal`: headline split by line; each line rises from a masked container, 80ms apart, slow duration.
- `ImageCurtain`: image uncovers with a clip-path wipe while scaling from 1.15 to 1, slow duration.
- `Parallax`: element moves at most 40px against scroll, transform only, desktop only.
- `Magnetic`: primary buttons pull up to 6px toward the cursor, desktop only.
- `PageTransition`: use the View Transitions API where supported, with a 0.3s cross-fade fallback.
- `Hairline`: a 1px gold line under key headings that draws left to right once on entry. This is the site's single recurring signature detail; use it under section headings only.
- Hover states: cards lift 4px with a soft shadow; buttons darken slightly and scale to 0.98 on press. Fast duration.

**Acceptance:** components exported from one folder and demonstrated on the home hero only; no layout shift; 60fps at 4x CPU throttle.

---

## Phase 3: Image system and hero

1. **`SmartImage` component.** Fixed aspect-ratio box, blurred placeholder, lazy loading below the fold, eager loading with high fetch priority for the hero, WebP/AVIF sources with responsive sizes, explicit width and height, required alt text.
2. **Product images** come from the product record in the database/API. Where a product has no image, show a neutral branded placeholder (category icon on the beige surface), never a broken image icon.
3. **Hero.** Replace the flat illustration with a photograph slot: one 4:5 image of school children in uniform, wrapped in `ImageCurtain`, plus two small floating cards (a school shoe and a notebook) that drift 6px on a slow loop. If you can generate images, generate these three in soft natural light on a warm neutral background and save them to `/public/images/hero/`. If you cannot, create named placeholder files and list them for me.
4. **Category tiles** under the hero: Uniform, Shoes, Accessories, Stationery, ID Cards. Each has a 1:1 image slot, a title and an arrow. The image scales to 1.05 on hover. Generate one mood image per category under the same style, saved to `/public/images/categories/`.
5. **Do not generate images for individual product listings.** Those must be real photos of the real products; leave placeholders and list what is missing.

**Acceptance:** the hero image is the LCP element and loads in under 2.5s on throttled 4G; CLS under 0.05; no image without alt text.

---

## Phase 4: Animate the pages

Apply the Phase 2 components across the site.

- **Home.** `TextReveal` on the headline; `Reveal` on the subtext and search box; `Stagger` on category tiles and on the three "How it works" steps; `Hairline` under each section heading; light `Parallax` on the hero image.
- **School picker.** Search results stagger in. The selected school chip in the header animates with a shared layout transition when the school changes.
- **Product grid.** Cards stagger in. Filter and sort changes re-order cards with layout animation instead of a hard swap. Clicking a card morphs its image into the product page image using a shared `layoutId`.
- **Product page.** Gallery thumbnails cross-fade. The size selector has a sliding active pill. Add-to-cart button shows a brief success state (label changes to "Added", then returns).
- **Cart.** Drawer slides in from the right over 0.3s with a dimmed backdrop. The badge count pops (scale 1 to 1.2 to 1) when an item is added. Removing an item collapses its row smoothly.
- **Header.** Becomes slightly smaller with a subtle background blur after 80px of scroll.

**Acceptance:** same easing and durations everywhere; nothing replays on re-entry; reduced-motion users see instant states.

---

## Phase 5: Perceived speed

The site currently feels slow. Smooth animation on top of slow responses still feels slow, so make every interaction respond immediately.

1. **Skeletons.** Every data fetch shows a skeleton shaped like the final content with a soft shimmer. No blank areas and no spinners.
2. **Optimistic UI.** Add to cart, remove from cart, quantity change and school selection update the screen instantly and reconcile with the server afterwards. On failure, roll back and show a toast.
3. **Prefetch.** Prefetch a route's code and data when its link is hovered or scrolled into view.
4. **Caching.** Cache the school list, category lists and product lists on the client with stale-while-revalidate, so going back to a page is instant.
5. **Code splitting.** Lazy-load the cart drawer, search overlay and anything below the fold. Load Lenis only on desktop.
6. **Fonts.** Self-host fonts, preload the two weights used above the fold, use `font-display: swap` with a size-matched fallback to prevent layout shift.

**Acceptance:** every tap or click produces visible feedback within 100ms; navigating back to a visited page shows content with no loading state.

---

## Phase 6: Verify and report

1. Run Lighthouse (mobile) on the home page, a product list and a product page. Report LCP, CLS, INP and JS bundle size, before and after this work.
2. Fix anything where LCP > 2.5s, CLS > 0.05 or INP > 200ms.
3. Check keyboard navigation and a visible focus ring on every interactive element.
4. Record a performance trace while scrolling the home page at 4x CPU throttle and confirm there are no long frames caused by animation.
5. Give me a final list of: every image still a placeholder, every place the brand name appears, and anything in this brief you could not complete and why.
