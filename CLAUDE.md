# SchoolStore

School uniform and stationery store for Indian parents. 95% of visitors are on phones.

## Design rules for the web UI (frontend/)

The client has banned these. Do not add them back.

- Lucide (or any stock icon set). Use `frontend/src/components/ui/icons.tsx` and draw new icons in the same style.
- Drop shadows (`box-shadow` other than `inset`). Separate surfaces with a 1px `var(--line)` border.
- Soft, rounded corners. Use `--radius-sm` (3px), `--radius-md` (4px) or `--radius-lg` (6px). Only small round markers (radio dots, count badges) can be circles.
- Hover animations: nothing moves, lifts, tilts, scales or nudges on hover. Hover may change colour only. The one exception is the ID card flip, which the client asked for.
- Animated arrows.
- Glass and blur (`backdrop-filter`). Use solid backgrounds.
- Harsh gradients, radial orbs, dot grids, neon colours, basic pastels, purple, purple and black together.
- Emojis, sparkle glyphs (✦ ✳), and checkmark bullets.
- Em dashes in UI text. Use a full stop, comma or colon. Use `-` for an empty value.
- Rows of 3 feature cards, bento grids, 3 pricing tiers, terminal windows, fake testimonials, "Likes".
- The copy pattern "it's not X, it's Y".
- The fonts Inter, Geist and Space Grotesk. The site uses Anek Latin (self-hosted in `frontend/public/fonts`).
- Plain white page backgrounds. Use `var(--paper)`.

These must exist:

- Real product photos (still to be supplied by the client).
- Skeleton loaders while data loads.
- Terms, Privacy and Refund pages (`frontend/src/pages/LegalPages.tsx`). Keep them in step with what the code does with data.

The home page uses the four house colours (red, blue, green, yellow) on purpose. Shop pages use the selected school's single colour.

## Git

Never push to `main`.
