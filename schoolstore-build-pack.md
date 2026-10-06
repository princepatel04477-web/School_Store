# SchoolStore — Premium-but-Friendly Redesign Pack

Eight prompts, pasted in order into your coding agent. Each is self-contained. Run one, review, commit, then run the next.

Assumptions baked in (change the Shared Brief if wrong): existing Vite + React SPA with plain CSS, deployed on Cloudflare Workers, redesign in place, transactional, school logos arrive later, no data seeded yet.

**Paste the Shared Brief at the top of every prompt.**

---

## Shared Brief (prepend to every prompt)

```
PROJECT: SchoolStore — an online store where parents buy school uniforms, shoes,
uniform accessories, stationery and ID cards for a specific school and class.
Existing app: Vite + React SPA, plain CSS, deployed on Cloudflare Workers.
This is a REDESIGN IN PLACE. Do not migrate framework, router, state library,
API layer or build tooling. Before editing, read the repo and follow the
conventions already there (file layout, TS or JS, CSS approach, naming).
If something below conflicts with how the repo actually works, keep the repo's
mechanism and apply the design intent.

TONE: premium but friendly. A calm, well-made shop for busy parents. Editorial
type and generous space, but warm, clear and fast. Not a jewellery house.

DESIGN TOKENS (CSS variables on :root, single source of truth):
  --paper:        #F5F4EF   page background
  --paper-raised: #FFFFFF   cards, inputs
  --paper-sunk:   #ECEAE2   sunken areas, image backdrops, skeletons
  --ink:          #1B2420   primary text
  --ink-soft:     #55605A   secondary text
  --ink-faint:    #8A928D   placeholder, disabled (never body text)
  --line:         #DEDBD0   hairline borders
  --brand:        #2F5D50   brand green: primary buttons, links, active states
  --brand-deep:   #234539   hover / pressed
  --brand-tint:   #E4ECE8   selected backgrounds
  --accent:       #B8893B   brass: hairlines, thread effect, tiny details ONLY
  --accent-text:  #7A5718   brass when used as small text
  --danger:       #A23B2E   errors
  Verify every text/background pair at its real size against WCAG AA and
  darken the token if it fails.

TYPE:
  Display: "Fraunces" (variable, opsz + wght), weights 400-600, used for h1-h3
           and large numerals. Slight negative tracking (-0.02em) at large sizes.
  Body/UI: "DM Sans" (already in use), 400/500/600.
  Label:   DM Sans 500, 11-12px, uppercase, letter-spacing 0.14em. Replace the
           current monospace labels with this.
  Self-host both fonts (woff2, font-display: swap, preload the two files used
  above the fold). Body 16px min, line-height 1.55, measure 60-72ch.
  Scale: 12 / 14 / 16 / 18 / 22 / 28 / 36 / 48 / 64, fluid with clamp().

SPACE & SHAPE: 8px base (4, 8, 12, 16, 24, 32, 48, 64, 96, 128).
  Section padding 96-128px desktop, 56-64px mobile. Max content width 1200px,
  gutters 24px mobile / 48px desktop. Radius: 10px inputs and buttons,
  16px cards, 999px chips. Borders are 1px var(--line); shadows are rare and
  soft (0 1px 2px rgb(27 36 32 / 0.04), 0 8px 24px rgb(27 36 32 / 0.06)).

BUTTONS: one filled style only — primary (bg --brand, text white, hover
  --brand-deep), used for the single main action on a screen (Continue,
  Add to Bag, Pay). Everything else is outline (1px --line, text --ink) or a
  text link with an underline that draws in on hover. Min height 48px,
  min tap target 44x44.

MOTION: use the `motion` package (import from "motion/react"). Easing
  cubic-bezier(0.22, 1, 0.36, 1). Durations: 160ms micro, 280ms UI, 520ms
  reveals. Animate only transform and opacity. Everything respects
  prefers-reduced-motion (no movement, instant or simple fade).
  Signature effect: "the thread" — a 1.5px brass dashed line (stroke-dasharray
  like a running stitch) that draws itself left to right.

MONEY: store and compute in integer paise. Display with
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR',
  maximumFractionDigits: 0 }).

NEVER: emoji as icons or in UI copy, countdown timers, "only N left",
  strikethrough or fake sale prices, star ratings, trust-badge strips,
  discount pop-ups, stock gradients, glassmorphism, drop shadows on everything,
  centred-everything layouts, lorem ipsum, console.log, TypeScript `any`
  (if the repo is TS), placeholder stubs or TODO comments.

ALWAYS: semantic HTML, visible focus ring (2px --brand, 2px offset), full
  keyboard support, alt text, explicit width/height on images, designed
  loading / empty / error states for every data view, verified at 360, 768,
  1280 and 1440px wide with no horizontal scroll.

ICONS: one outline icon set (lucide-react), 1.5px stroke, 20px default.
```

---

## Prompt 00 — Tokens, type and base styles

```
[SHARED BRIEF]

CONTEXT
The app currently has one sans font, a pale background, monospace caps labels
and no token system I can rely on. Nothing from this pack exists yet.

GOAL
Install the design foundation so every later prompt only consumes tokens.
No layout redesign in this step; the app should look the same structurally
but already feel different through type, colour and spacing.

FILES
- Inspect first: index.html, the global stylesheet, the app entry, and how
  components are currently styled. Report what you found in 5 lines.
- Create a tokens stylesheet (colours, type scale, spacing, radius, shadow,
  easing, durations as CSS variables) and import it once at the app entry.
- Create a base stylesheet: modern reset, body defaults, heading styles,
  link styles, focus ring, selection colour, .label utility,
  .container utility, .visually-hidden.
- Add self-hosted Fraunces (variable) and DM Sans woff2 files with @font-face
  and preload tags in index.html.
- Create a `formatINR(paise)` utility and a small unit test if the repo has a
  test runner.
- Install lucide-react. Create an Icon wrapper that fixes stroke width 1.5 and
  default size 20.
- Create Button (variants: primary, outline, text; sizes: md, lg; states:
  hover, focus, pressed, disabled, loading with an inline spinner),
  Input (label, hint, error, leading icon slot), Chip (selectable), and
  Skeleton (shimmer on --paper-sunk, static under reduced motion).

EXACT SPECS
- index.html: lang="en-IN", <title>SchoolStore — School uniforms and
  essentials, sorted</title>, meta description (150-160 chars, written for
  parents), theme-color #F5F4EF, viewport meta, an SVG favicon using the
  existing "S" mark in --brand.
- Replace every hard-coded colour, font-family, font-size, radius and spacing
  value in existing CSS with tokens.
- Replace the emoji search icon with the lucide Search icon.
- Replace the monospace caps labels with the .label style.
- h1 uses Fraunces 500, clamp(2.25rem, 5vw, 4rem), line-height 1.05.

CONSTRAINTS
Do not change routes, data fetching or component structure. No new CSS
framework. No inline hex values after this step.

ACCEPTANCE
- [ ] grep for hex colours outside the tokens file returns nothing
- [ ] Tab title and favicon are set
- [ ] No emoji anywhere in the UI
- [ ] Fonts load from the app's own origin with no layout shift on swap
- [ ] Button, Input, Chip, Skeleton exist with all listed states
- [ ] Focus ring is visible on every interactive element
- [ ] Build passes with no lint or type errors
```

---

## Prompt 01 — Motion base and the thread

```
[SHARED BRIEF]

CONTEXT
Tokens, fonts and base components from Prompt 00 exist. The app has no motion.

GOAL
Add a small, reusable motion layer. Later prompts compose these primitives and
must not invent their own timings.

FILES
- Install `motion`.
- Create a motion config module exporting the shared easing, durations and a
  `useReducedMotion`-aware helper.
- Wrap the app in <MotionConfig reducedMotion="user">.
- Create these components:
  1. Reveal — fades and lifts children 16px on entering the viewport, once.
     Props: delay, as. Uses whileInView with viewport={{ once: true,
     margin: "-10% 0px" }}.
  2. Stagger — parent that staggers Reveal children by 60ms.
  3. Thread — an inline SVG running-stitch line. Props: width (default 100%),
     animate (boolean), delay. stroke var(--accent), stroke-width 1.5,
     stroke-dasharray "6 5", stroke-linecap round. Draws left to right in
     700ms by animating a clip/mask (not stroke-dashoffset, so the dashes stay
     crisp). Static and fully drawn under reduced motion. aria-hidden.
  4. StepTransition — AnimatePresence wrapper (mode="wait") for swapping
     step panels: exit fades and slides -12px on x, enter fades and slides in
     from +12px, 280ms. Direction reverses when going back a step.
  5. PageTransition — 200ms cross-fade between routes, scroll restored to top
     on forward navigation and preserved on back.
  6. PressScale — whileTap scale 0.98 for buttons and cards.

EXACT SPECS
- No animation runs longer than 700ms. Nothing loops. Nothing animates on
  scroll position continuously (no parallax, no scroll-jacking, no smooth
  scroll library).
- Reveal is never applied to content above the fold on first paint, to protect
  LCP.
- Apply PressScale to the Button component.

CONSTRAINTS
Transform and opacity only. No layout-affecting animation. No GSAP, no Lenis:
this is a shop, speed matters more than choreography.

ACCEPTANCE
- [ ] With OS reduced motion on, nothing moves; content is fully visible
- [ ] Thread renders crisply at 1x and 2x and draws once
- [ ] StepTransition reverses direction on back
- [ ] No CLS introduced (check in Lighthouse)
- [ ] A hidden /dev route or story page shows every primitive for review,
      excluded from the production build
```

---

## Prompt 02 — Header and footer

```
[SHARED BRIEF]

CONTEXT
Prompts 00-01 are done. The current header is a logo and a "Sign in" link.
There is no footer.

GOAL
Build the global chrome so the site reads as a real, trustworthy shop.

FILES
- Header component, Footer component, MobileMenu (sheet), SkipLink.
- A site-config module holding support phone, WhatsApp number, support email,
  business name and address as constants with clearly named placeholder
  values, exported from ONE place so the owner can fill them in.

EXACT SPECS
Header
- Height 72px desktop, 60px mobile. Background --paper, 1px bottom hairline
  that appears only after scrolling 8px. Sticky.
- Left: existing "S" mark + wordmark, wordmark set in Fraunces 500.
- Centre (desktop >= 1024px): text links — Uniform, Shoes, Accessories,
  Stationery, ID Cards. Active link gets a short Thread underline.
- Right: Search icon button, Sign in (text link; becomes account icon when
  signed in), Bag icon button with a small count dot in --brand
  (count announced via aria-live="polite").
- Mobile: menu icon left of logo opens a full-height sheet from the left with
  the same links at 22px Fraunces, plus Help and Sign in. Focus trapped,
  Escape closes, body scroll locked, focus returns to the trigger.
- If a school is already selected, show a compact pill after the logo:
  "[monogram] School name · Class 5" with a "Change" action that returns to
  step 1.

Footer
- Background --paper-sunk, top hairline. Four columns desktop, accordion on
  mobile: Shop (the 5 categories), Help (Size guide, Delivery, Returns and
  exchanges, Track order, FAQ), Company (About, For schools, Contact),
  Contact (phone, WhatsApp, email, hours).
- Phone, email and WhatsApp are plain <a href="tel:">, <a href="mailto:"> and
  <a href="https://wa.me/..."> anchors, never router links.
- Bottom row: copyright with the current year, Privacy, Terms, Refund policy.
- A full-width Thread sits above the bottom row and draws when in view.

Skip link: "Skip to content", visible on focus, targets <main id="main">.

CONSTRAINTS
Links to pages that do not exist yet must route to a simple designed
"Coming soon" page, not a dead href="#".

ACCEPTANCE
- [ ] Header and footer render on every route
- [ ] Mobile sheet is fully keyboard and screen-reader operable
- [ ] Bag count updates live and is announced
- [ ] No dead links
- [ ] Checked at 360, 768, 1280, 1440
```

---

## Prompt 03 — Home

```
[SHARED BRIEF]

CONTEXT
Prompts 00-02 are done. Today the root route drops straight into
"Step 1 of 3 — Select your School" inside a single white card and shows
"No schools found" on an empty search. There is no landing experience.

GOAL
Give the root route a real home page whose single job is to get a parent to
pick their school. The selection flow itself is rebuilt in Prompt 04; here,
choosing a school hands off to it.

FILES
- Home page component and its section components.
- A seed data module with 8 realistic sample schools (name, city, board,
  short code for a monogram, slug), 3 classes-per-school groupings, and
  12 sample products across the 5 categories with paise prices and sizes.
  Mark it clearly as seed data and wire it behind the existing data layer so
  real API data replaces it without touching components. If the API returns
  an empty list in development, fall back to seed; in production show the
  designed empty state instead.
- Create a SchoolCrest component: shows the school logo when a URL exists,
  otherwise a monogram (2 letters, Fraunces 500, --brand on --brand-tint,
  inside a soft shield or rounded-square shape). This is the placeholder
  until real logos arrive.

EXACT SPECS (sections in order)
1. Hero — asymmetric two-column on desktop (7/5), stacked on mobile.
   Left: label "Uniforms · Shoes · Stationery · ID cards"; h1 in Fraunces
   "School essentials, sorted."; a Thread drawing under the last word; one
   sentence of supporting copy (max 18 words) about picking the school and
   class and getting the exact list; then the school search field, large
   (56px high), with Search icon, placeholder "Search your school", and a
   primary "Find my school" button. Typing shows a combobox list
   (role="combobox", arrow keys, Enter selects, Escape closes) of matching
   schools with SchoolCrest, name and city. Empty query shows
   "Popular schools". No match shows "We don't have that school yet" with a
   "Request your school" text link.
   Right: a composed image area on --paper-sunk with a 16px radius, built to
   take one photograph later. Until then, render a tasteful flat-lay
   composition from simple SVG shapes (shirt, shoe, notebook, ID card) in
   brand tints. No stock photo, no gradient.
2. How it works — three numbered steps in a row (stack on mobile): large
   Fraunces numerals 01 / 02 / 03 in --accent-text, a short title and one
   line each: Choose your school / Pick the class / Add the list to your bag.
   A Thread connects the three numerals on desktop.
3. Shop by category — NOT five identical cards. Editorial grid: Uniform as a
   large tile spanning two rows, the other four as smaller tiles. Each tile:
   --paper-sunk image area, category name in Fraunces, a one-line descriptor,
   and an arrow that nudges 4px on hover. Whole tile is one link.
4. Featured schools — grid of SchoolCrest cards (4 across desktop, 2 across
   mobile) with name and city; "View all schools" text link.
5. Reassurance — one calm row of three plain-text points with small outline
   icons: exact school-approved items, easy size exchange, delivery to home
   or school. Text only, no badges, no logos, no invented numbers.
6. For schools — a slim band: one sentence inviting schools to partner and an
   outline "Talk to us" button.

Motion: hero content is static on first paint (LCP). Sections 2-6 use
Reveal/Stagger. Tiles lift 2px on hover with a hairline turning --brand.

CONSTRAINTS
Do not invent statistics, testimonials, partner counts or delivery promises.
Copy is short, plain and written for a parent in a hurry.

ACCEPTANCE
- [ ] Root route shows the home page, not the stepper
- [ ] Selecting a school from the hero lands in step 2 of the flow with that
      school carried over
- [ ] With seed data the page looks complete; with empty production data the
      featured section shows a designed empty state, never "No schools found"
- [ ] Combobox passes keyboard and screen-reader checks
- [ ] LCP element is the h1 or hero image and loads under 2.5s on throttled 4G
- [ ] Checked at 360, 768, 1280, 1440
```

---

## Prompt 04 — Selection flow (school, class, items)

```
[SHARED BRIEF]

CONTEXT
Prompts 00-03 are done. The existing flow is "Step 1 of 3" in one card with
category chips above it. Seed data and SchoolCrest exist.

GOAL
Rebuild the three-step flow so it feels guided and quick: School, then Class,
then Items. Keep the existing routes and state mechanism if they work; add
URL state if selections are currently lost on refresh.

FILES
- Flow layout, Stepper, StepSchool, StepClass, StepItems, SelectionSummary,
  EmptyState, ErrorState.

EXACT SPECS
Stepper
- Horizontal, three nodes labelled School / Class / Items, joined by a Thread
  that draws up to the current step. Completed steps show a check icon and are
  clickable to go back; future steps are not focusable. aria-current="step".
  On mobile it collapses to "Step 2 of 3 · Class" with a thin progress line.
- Step heading in Fraunces, focus moves to it on each step change so screen
  readers announce it.
- Steps swap with StepTransition.

Step 1 — School
- Search input at top, then a grid of school cards (3 across desktop,
  1 across mobile as rows): SchoolCrest, name, city, board. Selected card gets
  a --brand border and --brand-tint background. Results filter as you type,
  debounced 150ms, match highlighted in weight 600.
- Loading: 6 skeleton cards. Empty search with data: show all schools,
  alphabetical, with a sticky A-Z jump on desktop if more than 24.
- No match: designed empty state with an outline illustration, "We couldn't
  find that school", and a "Request your school" link.
- No data at all: "Schools are being added. Check back soon." plus the
  WhatsApp contact link. Never a bare "No schools found".

Step 2 — Class
- Classes grouped under small labels (Pre-primary, Primary, Middle,
  Secondary) as large selectable tiles (min 64px high) in a wrap grid. If the
  school has gender- or house-specific uniforms, show that as a second chip
  row beneath, only when the data has it.

Step 3 — Items
- Category chips become tabs here (Uniform, Shoes, Accessories, Stationery,
  ID Cards) with counts, sticky under the header, horizontally scrollable on
  mobile with edge fade.
- "The required list for Class X" appears first as a checklist-style group
  with an "Add full set" primary button and the set total; optional items
  follow in a product grid (see Prompt 05 for the card).
- Desktop: a sticky SelectionSummary on the right (school crest, class,
  items added, subtotal, "View bag" primary button). Mobile: the same as a
  bottom bar with subtotal and "View bag", safe-area padding included.

Persistence: school and class survive refresh and are reflected in the header
pill from Prompt 02.

CONSTRAINTS
One primary button per step. Back is a text link. No modal dialogs in the
flow. No step may require horizontal scrolling of the page itself.

ACCEPTANCE
- [ ] Whole flow completes with keyboard only
- [ ] Refresh on step 3 keeps school and class
- [ ] Loading, empty, no-match and error states all exist and are designed
- [ ] Back navigation reverses the transition and restores scroll
- [ ] Bottom bar does not cover content or the footer on mobile
- [ ] Checked at 360, 768, 1280, 1440
```

---

## Prompt 05 — Product card and product page

```
[SHARED BRIEF]

CONTEXT
Prompts 00-04 are done. Step 3 lists items but the product presentation is
basic. Real product photography is not available yet.

GOAL
Design the product card and product page so sizing — the main source of
returns for uniforms — is effortless.

FILES
- ProductCard, ProductPage (or ProductSheet if the app has no product route:
  then use a route-backed side sheet on desktop and full-screen sheet on
  mobile), SizeSelector, SizeGuide, QuantityStepper, ProductImage.

EXACT SPECS
ProductImage
- 4:5 ratio, --paper-sunk background, object-fit contain with 8% inner
  padding. When no image URL exists, render a category-specific outline
  illustration (shirt, trousers, skirt, shoe, tie, belt, notebook, ID card)
  in --ink-faint. Explicit width/height, lazy below the fold, eager for the
  first row.

ProductCard
- Image, then name (DM Sans 500, 16px, max 2 lines), a one-line descriptor
  (fabric or pack size), price via formatINR. Bottom row: compact size
  selector if the product has sizes, and an outline "Add" button that becomes
  a QuantityStepper once the item is in the bag.
- Hover: image scales 1.03 inside its frame, hairline turns --brand.
- The image carries layoutId={`product-${id}`} so it morphs into the product
  page image on open.
- Required-list items show a small "Required" label in --accent-text.
- Out of stock for a size: that size is disabled with a diagonal hairline and
  an accessible "unavailable" label. No urgency copy.

ProductPage
- Desktop two columns (7/5): gallery left (main image + thumbnails, arrow
  keys move, swipe on touch), details right and sticky.
- Details order: breadcrumb (School / Class / Category), name in Fraunces
  28-36px, price, short description, SizeSelector, QuantityStepper, primary
  "Add to Bag" (full width on mobile, becomes "Added" with a check for 1.2s),
  then accordions: Fabric and care, Delivery, Exchange and returns.
- SizeSelector: radio group of size tiles (min 48x48), selected tile filled
  --brand-tint with --brand border. "Size guide" text link beside the label.
  Adding without a size scrolls to the selector and shows an inline error —
  no alert().
- SizeGuide: sheet with a measurement table (age, height in cm, chest, waist),
  an outline "how to measure" diagram and a one-line tip to size up for
  growth. Table scrolls inside its own container on mobile.
- Adding to bag opens the bag drawer (built in Prompt 06; until then, update
  the count and show a toast).

CONSTRAINTS
No star ratings, no "people are viewing", no strikethrough prices. If a real
discount exists in data, show the price only and a plain "Set price" note.
Do not invent fabric compositions or measurements: use seed values marked as
sample in the seed module.

ACCEPTANCE
- [ ] Card image morphs smoothly into the page image and back
- [ ] Size is required before add, with an inline accessible error
- [ ] Gallery and size selector work by keyboard and touch
- [ ] Every product renders well with zero photographs
- [ ] Prices render in en-IN format from paise
- [ ] Checked at 360, 768, 1280, 1440
```

---

## Prompt 06 — Bag and checkout

```
[SHARED BRIEF]

CONTEXT
Prompts 00-05 are done. The site is transactional. Inspect the repo first and
report in 5 lines what already exists for cart state, orders, auth and
payments. Reuse it. If no payment integration exists, build the full UI
against a clearly isolated payment adapter interface and stop before real
payment calls — do not hard-code keys or fake a successful payment in
production builds.

GOAL
A bag and checkout a parent can finish on a phone in under two minutes.

FILES
- BagDrawer, BagLine, Checkout (single page, sectioned), OrderSummary,
  AddressForm, DeliveryOptions, OrderConfirmation, payment adapter interface.

EXACT SPECS
BagDrawer
- Slides from the right, 440px desktop, full width mobile, 280ms. Focus
  trapped, Escape closes, scroll locked, focus returns to trigger.
- Lines grouped under the school and class they belong to. Each line:
  thumbnail, name, size, QuantityStepper, line total, "Remove" text link with
  a 5s inline Undo.
- Footer: subtotal, a "Taxes and delivery calculated at checkout" note,
  primary "Checkout", text link "Continue shopping".
- Empty: outline illustration, "Your bag is empty", outline button
  "Find my school".

Checkout
- One page, three numbered sections that open in sequence and collapse to a
  summary when done (editable): 1 Contact, 2 Delivery, 3 Payment.
- Contact: parent name, mobile (Indian 10-digit, inputmode="numeric"),
  email; student name and class/section (prefilled from the flow).
- Delivery: radio choice between Home delivery and Collect at school (only if
  the data says the school supports it). Home shows AddressForm: PIN code
  first (6 digits) then address lines, city, state. Correct autocomplete
  attributes on every field.
- Payment: methods exposed by the adapter (UPI first, then card, net
  banking, and COD only if enabled). Never build custom card-number fields:
  hand off to the provider's hosted fields or redirect.
- OrderSummary: sticky right column desktop, collapsible at top on mobile
  showing total. Lines, subtotal, GST shown as its own row, delivery, total.
  All maths in integer paise.
- Validation inline on blur and on submit, error text under the field in
  --danger with an icon, aria-describedby wired, first error focused.
- Primary button reads "Pay ₹X" with the live total; shows loading state and
  is disabled while submitting to prevent double orders.

OrderConfirmation
- Fraunces heading "Order placed", a Thread drawing beneath it, order number,
  what happens next in three plain lines, order summary, outline
  "Track order" and text link "Back to home". Nothing else.

CONSTRAINTS
No upsell modals, no forced account creation (guest checkout allowed if the
backend permits it), no countdown or "reserve your items" pressure. Do not
store card data. Do not log personal data.

ACCEPTANCE
- [ ] Add, change quantity, remove and undo all work and persist on refresh
- [ ] Checkout completes by keyboard only with a screen reader
- [ ] Totals match line-by-line arithmetic in paise
- [ ] Double-clicking Pay cannot create two orders
- [ ] Payment adapter is the only file that knows about the provider
- [ ] Checked at 360, 768, 1280, 1440
```

---

## Prompt 07 — Hardening and anti-template pass

```
[SHARED BRIEF]

CONTEXT
Prompts 00-06 are done. This step changes no features. It finds and fixes
quality gaps.

GOAL
Ship-ready quality: accessible, fast, consistent, and free of anything that
looks like a template.

TASKS
1. Accessibility: run axe on every route and fix all serious and critical
   issues. Check heading order, landmark regions, form labels, colour
   contrast, focus order, focus visibility, and that every dialog, sheet and
   combobox follows the ARIA authoring pattern. Check at 200% zoom.
2. Performance: targets LCP < 2.5s, CLS < 0.05, INP < 200ms on a mid-range
   Android over 4G. Code-split routes, lazy-load checkout and the size guide,
   preload only the two above-the-fold font files, serve images as AVIF/WebP
   with srcset and sizes, confirm long-cache headers on hashed assets from
   the Worker. Report bundle size before and after.
3. SEO and sharing: unique title and meta description per route, canonical
   URLs, Open Graph and Twitter tags, a 1200x630 OG image in brand style,
   robots.txt, sitemap, JSON-LD for Organization on home and Product on
   product pages (price from paise, INR), BreadcrumbList where breadcrumbs
   show. Make sure deep links work on refresh (SPA fallback in the Worker).
4. Mobile pass at 360px: no horizontal scroll, tap targets >= 44px, sticky
   bars respect safe areas, keyboard does not cover focused inputs, numeric
   keyboards on numeric fields.
5. Consistency sweep: no hex values outside tokens, no font sizes outside the
   scale, no spacing off the 8px scale, one icon set, one button style per
   role, identical radius per component type.
6. Anti-template sweep — remove or redesign anything that matches:
   emoji in UI; three or more identical cards in a centred row with icon,
   title, text; default blue links; grey-on-grey placeholder boxes; generic
   copy such as "Welcome to", "Lorem", "Your one-stop shop"; unstyled native
   selects, alerts or confirm dialogs; leftover scaffold files, unused assets,
   console.log, commented-out code, TODO comments.
7. Resilience: designed 404 page, global error boundary with a retry,
   offline/timeout message on failed requests, and an empty state for every
   list.

OUTPUT
A short report: issues found, what was fixed, Lighthouse scores per route
(mobile), bundle size before/after, and anything that needs the owner
(real logos, photography, support contact details, payment keys,
custom domain to replace *.workers.dev).

ACCEPTANCE
- [ ] axe: zero serious or critical issues on every route
- [ ] Lighthouse mobile: Performance >= 90, Accessibility >= 95,
      Best Practices >= 95, SEO >= 95 on home and flow
- [ ] All seven tasks reported with evidence
- [ ] Build, lint and type checks pass clean
```

---

## What you need to supply

| Item | Needed by |
|---|---|
| Support phone, WhatsApp, email, business address | Prompt 02 |
| School logos (SVG or 512px PNG, transparent) | Any time; monograms cover until then |
| One hero photograph and category images | Any time; SVG compositions cover until then |
| Real school, class and product data | Replaces seed after Prompt 03 |
| Payment provider and keys | Prompt 06 |
| Custom domain on Cloudflare | Before launch |
