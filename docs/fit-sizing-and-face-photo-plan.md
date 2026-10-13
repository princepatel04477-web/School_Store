# Plan: Photo sizing (Track A) and face-photo products (Track B)

Status: draft for discussion. Nothing built yet. Written 13 Oct 2026.

## 0. Read this first: what the repo already has

- **Track B is mostly built.** `orders/` already supports image customisation for the Photo Notebook and Student ID Card: pre-signed private uploads (`storage.py`, `upload_views.py`), 300 DPI print processing and thumbnails (`image_tasks.py`), signed expiring download URLs, and an ID card preview (`components/idcard/`). Tests: `orders/test_customisation.py`.
- **What is missing is the legal side of it.** There is no consent record, no retention or deletion of child photos, and the Privacy page (`LegalPages.tsx`, "What we collect") does not mention photos at all. CLAUDE.md requires that page to match what the code does. So this is a live gap today, not a future one.
- **There is no size chart model.** `ProductVariant.size` is a plain string ("32", "M"). Nothing stores centimetres.

That changes the order of work: fix Track B's consent and retention first (Phase B0), then build sizing.

## 1. Principles that hold both tracks together

1. **The sizing photo never leaves the phone.** MediaPipe runs in the browser. Only numbers (shoulder cm, confidence) are sent to the server. This is stronger than "upload, process, delete": there is nothing to leak, and the sizing frame physically cannot be reused as a face photo.
2. **The face photo is a separate, opt-in upload** made only when the parent orders a notebook or ID card, with its own consent tick.
3. **Store the least.** Height and weight are stored against the order item, not as a permanent profile, unless the parent chooses "remember for next year".
4. **Plan for the fallback first.** Height + weight + class against the size chart must work on its own. The photo only refines it.

## Track B: Face photo for notebooks and ID cards

### B0. Compliance retrofit of the existing upload (do first, about 3-4 days)
- **Consent model** `PhotoConsent`: parent user, student, purpose (`NOTEBOOK`, `ID_CARD`), policy version, timestamp, IP/device, withdrawn_at.
- **Consent step in the customisation UI**, shown before upload, plain wording in English, Gujarati and Hindi (the "Listen" read-aloud should cover it). Not pre-ticked.
- **Block the upload API** (`upload_views.py`) unless a live consent exists for that student and purpose.
- **Retention job** (Celery is already in the stack): delete the original and print files a set number of days after the order is delivered (proposal: 30 days, to allow reprints). Keep only the low-res thumbnail if the parent ticks "keep for next year's ID card", otherwise delete that too.
- **Withdraw / delete button** in the Parent area. It deletes the images and marks the consent as withdrawn.
- **Update the Privacy page**: what photo we collect, for what, who sees it (school for ID cards, print vendor), how long we keep it, how to delete it.
- **School agreement**: for ID cards the school decides what goes on the card, so it is probably the data fiduciary and we process on its behalf. Put that in writing in the school tie-up agreement. (Get a lawyer to confirm. This is a reading of the DPDP Act, not legal advice.)

### B1. Face capture quality (about 2-3 days)
- Reuse the guided-frame component from Track A, but switch to face mode: MediaPipe Face Detector checks that the face is centred, frontal, well lit and has no other faces. Auto-capture when the checks pass.
- Crop to ID card ratio on the device, then upload through the existing pre-signed flow.

### B2. Output products (mostly done)
- Notebook cover and ID card templates already render from data. Add a print proof step for the school admin to approve ID cards in bulk before printing.

## Track A: Photo sizing

### A1. Size chart foundation (about 4-5 days)
- **New model** `SizeChartRow`: product (or product type plus school), size label, shoulder cm range, chest cm range, garment length cm, recommended height range, recommended weight range.
- **School admin / boss panel** screen to enter or import charts (CSV import, same pattern as `schools/import_service.py`).
- **Selection flow**: before picking a size, ask the parent for height (cm) and weight (kg). Recommend a size from height + weight + class. Show the chart in cm next to it so parents can check.
- **Log** each recommendation and later exchanges or returns per order item. This data is what decides in A4 whether the photo is worth having at all.

### A2. Guided capture frame (about 1 week)
- MediaPipe Pose Landmarker (Tasks Vision, web build), running on the phone camera.
- On-screen body outline with a marked foot line. Live checks: whole body in frame (nose to both heels visible), shoulders level (tilt under a few degrees), facing front (both shoulders visible, left-right depth difference small), standing still for about 1 second. Auto-capture when all pass, like eKYC.
- Guidance as short text plus voice in the parent's language ("Step back", "Turn to face the phone"). Needs two people: parent holds the phone at chest height, child stands 2-2.5 m away.
- Ask for a fitted T-shirt or vest, not the loose uniform shirt.
- UI must follow CLAUDE.md: no blur or glass overlay, nothing animated on hover, no animated arrows, no emojis. Solid overlay, 1px lines, colour change only.

### A3. Measurement (about 3-4 days)
- **Scale** = typed height divided by the pixel height of the child.
- MediaPipe has **no top-of-head point**. Use the pose segmentation mask: the top-most body pixel above the nose is the top of the head; the lowest heel / foot-index point is the floor. (This replaces the Canny edge method in the research doc and is more reliable.)
- **Shoulder width (pixels)** = distance between landmarks 11 and 12, converted to cm with the scale above.
- Take 5-10 frames during the still second and use the median, not one frame.
- **Output**: shoulder cm and a confidence score. If confidence is low, quietly fall back to A1.
- Chest: stretch goal only. A front photo sees width, not circumference, so estimate chest from front width + weight with a fitted formula, and label it approximate.

### A4. Calibration and go / no-go (about 1-2 weeks, needs a partner school)
- MediaPipe's shoulder point sits on the joint, inside the outer bony edge a tailor measures to, so raw readings come out narrow. Fix that with an offset, either fixed cm or a percentage of width.
- **Sample**: 10-15 children is too few for class 1 to 12. Aim for about 10 per band across 4 bands (class 1-3, 4-6, 7-9, 10-12), about 40 children, boys and girls.
- For each child record: tape shoulder (tailor method), photo shoulder, height, weight, and **the size that actually fits** when they try on the uniform. Fit is the real target, not the tape number.
- **Report the mean absolute error per band**, not the "mean error" used in the research doc (positive and negative errors cancel out there and hide the real spread).
- **Go / no-go rule**: ship the photo step only if height + weight + photo picks the right size noticeably more often than height + weight alone on the same children. If it does not, keep A1 and drop the photo. That is a valid outcome.
- Needs written consent from the school and the parents for the trial itself.

### A5. Recommend and fall back (about 2-3 days)
- Combine shoulder cm with height + weight against `SizeChartRow`. When two sizes are close, show both with a note ("between 32 and 34, pick 34 for room to grow").
- Fall back to A1 automatically on low confidence, failed capture, or if the parent skips the photo. The photo step is always optional.

## Order of work

1. B0, the consent and retention retrofit (it is a live gap)
2. A1, size chart and height/weight recommendation (start logging)
3. A2 + A3, capture frame and measurement, behind a feature flag
4. B1, face capture mode, reusing the A2 component
5. A4, calibration trial at one partner school, then the go / no-go decision
6. A5, switch on photo sizing for the bands that passed (it may only make sense for older classes)

## Open questions for Parth

- What exchange rate for wrong sizes do schools or shops see today? That is the number the photo has to beat.
- Who issues the ID card legally: the school or SchoolStore? It decides who the data fiduciary is.
- How many days after delivery should face photos be kept for reprints?
- Which school will host the calibration trial?
