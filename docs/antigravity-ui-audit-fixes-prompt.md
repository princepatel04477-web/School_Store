# Antigravity prompt: fix the mobile UI/UX audit (P0 + P1)

Paste everything below the line into Antigravity.

---

You are fixing UI/UX problems in SchoolStore, a school uniform shop for Indian parents. 95% of parents use phones. Every change must look right at 360px, 390px and 414px wide. Desktop is secondary.

## Where to work (read first)

- Work ONLY in this folder: `C:\Users\rebel\OneDrive\Documents\GitHub\School_Store-uifix` (a git worktree, branch `fix/product-back-accessories`).
- Do NOT touch the main `School_Store` folder. Do NOT switch branches. Do NOT push. Do NOT deploy. Do NOT commit unless told.
- This branch already has uncommitted work you must KEEP: the product page "Back to Uniform" bar, the `?item=` history entry for the product page, the Uniform card + Accessories row + chips on shop step 4, the solid white header back button, and the animation fill change in `theme/emerald.css` (`backwards`, not `both`). Do not revert or rewrite these. Build on top of them.
- Read `CLAUDE.md` in the repo root before changing anything. Its design rules are the client's, and they are strict:
  - No stock icon sets (draw new icons in the style of `frontend/src/components/ui/icons.tsx`).
  - No drop shadows (only `inset`). Separate surfaces with a 1px `var(--line)` border.
  - Corners only `--radius-sm` (3px), `--radius-md` (4px), `--radius-lg` (6px). Circles only for small markers like count badges and radio dots.
  - Hover may change colour only. Nothing moves, lifts, scales or nudges on hover (the ID card flip is the one exception).
  - No glass/blur, harsh gradients, neon, basic pastels, purple, emojis, sparkle glyphs, checkmark bullets.
  - No em dashes in UI text. Use a full stop, comma or colon.
  - Page backgrounds use `var(--paper)`, not plain white. Font is Anek Latin / the existing theme fonts, never Inter, Geist or Space Grotesk.
  - Skeleton loaders while data loads.
- Every new UI string goes into `frontend/src/i18n/messages.ts` with `en`, `gu` (Gujarati) and `hi` (Hindi). No hard-coded English in components.
- Tap targets at least 44px tall. Text at least 12px (count badges can be smaller).
- The audit with screenshots is in `docs/ui-audit-2026-11-23.md` and `docs/ui-audit-2026-11-23/`. Look at the screenshots.

## How to run it

- Frontend: `cd frontend` then `npx vite --port 5198 --strictPort`. API proxy: set `VITE_API_PROXY_TARGET=http://127.0.0.1:8015` if a local Django API is running there, otherwise it proxies to the live site.
- Note: reloading the shop sends it back to step 1 on purpose ("fresh flow on refresh"). Click through state > city > school > class > boy/girl again after a reload.
- Checks before you finish: `npx tsc -b --noEmit` (must pass) and `npx vitest run` (all 108 tests must still pass; update a test only if the behaviour change is intended and say which).

## The fixes, in this order

### P0-1. Real Help pages instead of "This page is being prepared"
Files: `frontend/src/App.tsx` (routes `/help`, `/size-guide`, `/contact`, `/for-schools` all render `ComingSoonPage`), `frontend/src/pages/InfoPages.tsx`, `frontend/src/components/Footer.tsx` (links go to `/help?topic=size-guide`, `/help?topic=delivery`, `/help?topic=returns`, `/help?topic=faq`).
- Build one Help page at `/help` with sections that each have an id: Size guide, Delivery, Size exchange, Questions (FAQ). `?topic=` scrolls to and opens that section. Use accordions like the product page's (`ProductSheet.tsx`, `.product-accordions`).
- Content must match what the code really does. Reuse the existing text: `product.delivery`, `product.exchange`, `product.care` in `messages.ts`, the size guide in `components/product/SizeGuide.tsx`, and the Refund page in `pages/LegalPages.tsx`. Do not invent policies (days, fees, areas) that are not already written somewhere in the code or legal pages. If something is missing, leave a short neutral line and list it in your report for the owner.
- `/size-guide` redirects to `/help?topic=size-guide`.
- `/contact`: a real page showing phone, WhatsApp and email from `siteConfig` (see P0-2). If none are set, show a short "Contact details coming soon" line and a button to the Help page. No dead "being prepared" page.
- `/for-schools`: short page with what the store offers schools (reuse the home page "Partner your school" section text) and the contact block.
- Each page has the normal site header with the back button and a skeleton is not needed (static content).

### P0-2. Contact details shown everywhere they are needed
File: `frontend/src/siteConfig.ts` has `SUPPORT_PHONE`, `WHATSAPP_NUMBER`, `SUPPORT_EMAIL`, all empty.
- Do NOT make up numbers. Leave them empty. The owner will fill them in.
- Make sure that when they are filled in, they appear in: the footer (already wired), the Contact page, the Help page (a "Still need help?" block at the end), the empty bag, and the out-of-stock message (P1-4). Hidden when empty.
- In your report, tell the owner exactly which three constants to fill in and the format (comments in the file show it).

### P0-3. Home page "What do you need?" uses the same Uniform + Accessories layout
File: `frontend/src/pages/HomePage.tsx` (section 3, `.editorial-category-grid` with `.cat-tile`), styles in `pages/home.css` and `theme/emerald.css`.
- Replace the three equal tiles (Uniform, Shoes, Tie belt & socks) with one large Uniform card and one slim Accessories row under it, matching shop step 4 (see `.cat-main` / `.cat-strip` in `pages/flow.css` and the markup in `pages/SelectionFlowPage.tsx`). Reuse those class names or extract a shared component; do not create a third different style.
- Uniform links to `SHOP_LINK` with `?cat=Uniform`, Accessories to `SHOP_LINK` with `?cat=School Shoes` (check that the shop keeps `cat` after the parent picks school, class and boy/girl; if it is dropped, keep plain `/shop`).
- Keep the four house colours rule for the home page in mind: the home page may use red/blue/green/yellow accents, but no pastel fills.

### P1-4. "Out of stock" is not a dead end
Files: `components/product/ProductCard.tsx` (`.card-unavailable`), `components/product/ProductSheet.tsx` (`.sheet-unavailable`), `components/product/product.css` (dashed border makes it look like a text field).
- Make it a plain label, not a box that looks like an input: solid 1px `var(--line)` border or no border, `var(--paper-sunk)` background, `var(--ink-soft)` text.
- On the product page, under the label, add one action: "Ask on WhatsApp when it's back" linking to `siteConfig.whatsappHref` with a prefilled message naming the product and school. Hide the action when WhatsApp is not set.
- In the step 4 list, show items with at least one size in stock first, out-of-stock items after them, keeping the existing required/optional sections.

### P1-5. Login page: a way back and bigger links
File: `frontend/src/pages/Login.tsx` (`.login-page`, `.login-art`, `.login-card`).
- Add a back control at the top of the login screen on phones, same look as the product page's Back bar (`.sheet-back` in `product.css`): "← Back". It goes to the previous page if there is store history (`hasStoreHistory()` in `components/BackButton.tsx`), otherwise home.
- "New here? Create a parent account" and "Just browsing? View the catalogue" must be at least 44px tall tap targets (padding, not bigger text).

### P1-6. Remove banned hover movement
File: `frontend/src/theme/emerald.css`, roughly lines 663-690 (`.cat-tile`, `.school-select-card`, `.gender-card`, `.product-card` hover `translate: 0 -6px` and `box-shadow`, `.class-tile` hover `translate`, `.cat-tile-media img` hover `scale: 1.07`, `.cat-arrow` / `.school-row-arrow` hover `translate: 5px 0`), around line 998 (`.state-tile-mark` hover translate), around line 1094 (`.pick-row-arrow` hover translate), around line 1418 (`img.state-emblem` hover translate). Also check `pages/aboutPage.css` for hover `transform`.
- Replace each with a colour-only hover (border-color or color change). Keep `:active` press feedback (that is a tap, not hover). Search the whole `frontend/src` for `:hover` rules containing `translate`, `transform`, `scale` or `box-shadow` and fix them all, except the ID card flip.
- Also find the non-inset box-shadow on `.emerald-container` on the home page and remove it.

### P1-7. No text under 12px
- Raise to at least 12px (use `--text-sm` or a 12px token, not new magic numbers): the school name above the step headings (`.label` in `SelectionFlowPage.tsx` step headers), group labels like "CLASS 1 TO 5" on step 2, section eyebrows like "OUR PROMISE" and "INSTITUTIONAL PARTNERSHIP" on home, "WELCOME TO SCHOOLSTORE" on login, footer column headings, and the footer Privacy / Terms / Refunds links (also make those 44px tap targets).
- Count badges may stay smaller.

### P1-8. Shop steps 1 to 3: get the choices higher on the screen
File: `frontend/src/pages/SelectionFlowPage.tsx` (step pill around line 589, `.step-back-btn` "Change school / Change state" links around lines 646, 688, 799), styles in `pages/flow.css`.
- On phones (under 768px) the class buttons start about 500px down an 844px screen. Bring them up: put the "Step 2 of 4" pill and the "Change school" link on one row, reduce the big top padding, and put "Listen" next to the heading instead of on its own row.
- Keep the "Change …" links (the header back button does the same thing, but parents use both). Keep every existing behaviour, including the bag-clear warning on step 4.
- Target: on a 390x844 screen the first row of class buttons and the boy/girl cards are visible without scrolling.

### P1-9. Home "All schools" section
File: `frontend/src/pages/HomePage.tsx` section 4 (`.schools-accordion-toggle`, collapsed by default).
- Right now it is a heading with a lone chevron and an empty gap below. Make the toggle look like a button: a full-width row with the heading, a short line under it ("See the schools we supply"), and the chevron, with a 1px border. Remove the empty gap when collapsed.

### P1-10. Checkout with an empty bag
File: `frontend/src/pages/CheckoutPage.tsx` around line 284.
- Add top spacing so the heading is not jammed under the header.
- Change the button to "Find my school" linking to `SHOP_LINK` (same wording as the empty bag drawer), as the primary button.

## When you are done

1. Run `npx tsc -b --noEmit` and `npx vitest run`, and report the results.
2. Check every changed screen at 360px and 390px wide (DevTools device mode), on the home page, Help, Contact, Login, shop steps 1 to 4, a product page and the empty checkout. Confirm there is no sideways scrolling.
3. Search your diff for banned things: `box-shadow` without `inset`, `border-radius` above 6px (except small circles), `backdrop-filter`, `—` (em dash) in UI strings, emojis.
4. Write a short report in `docs/ui-audit-fixes-report.md`: what you changed per item (P0-1 to P1-10), screenshots at 390px, anything you could not do, and what the owner must supply (contact numbers, any missing policy text).
5. Do not commit, push or deploy.
