# Shoulder reading: tape checks

The camera reads the shoulder two ways and blends them:

- **Joints**: MediaPipe's shoulder points, the centres of the shoulder joints. Close to the tape on slim bodies, short on heavy ones (the muscle and fat outside the joint are not counted).
- **Outline**: the body outline at shoulder height, edge to edge. Includes everything the joints miss, so it comes out wider than a tape across the back.

The shown reading is `joints + SHOULDER_EDGE_BLEND x (outline - joints)`, then multiplied by the server's `SHOULDER_CALIBRATION_FACTOR`. `SHOULDER_EDGE_BLEND` lives in `frontend/src/measure/config.ts`. It starts at 0.5, from two Indian adults measured with the joints-only reading:

| Height | Weight | Joints only | Tape | Short by |
|---|---|---|---|---|
| 170 cm | 100 kg | 40.1 cm | 45 cm | 4.9 cm |
| 167 cm | 55 kg | 35.5 cm | 37.5 cm | 2.0 cm |

0.5 matches both if their outlines read about 50 cm and 39.5 cm. Their outline readings weren't taken yet, so this is unconfirmed.

**Calibrate on Indian children.** The store is for Indian schoolchildren, so the blend and the factor are set only from tape checks on them, not from foreign body tables (ANSUR and similar are mostly US and European adults). Adults are fine for a first check; the children who will use the store decide the final numbers.

## Why a front photo alone falls short

A tape across the back follows the curve of the back. The camera, from the front, sees a straight line across. On a slim, flat back the two are close; on a heavy, round back the curve is much longer (the 100 kg adult later taped 55 cm where the camera read 44.5). How round the back is can't be seen from the front, so test mode also takes a side photo and reads the body's depth at the shoulders. Width plus depth gives the curve; the exact formula is set from the checks below.

## Mass correction (live)

The camera reading is multiplied by a curve of BMI, scaled down below the baseline build and up above it (`MASS_CURVE` in `frontend/src/measure/config.ts`):

    d = BMI - bmiBase;   multiplier = clamp(gain + alpha * d + beta * d * |d|, min, max)

Current values (`bmiBase` 22, `gain` 1.023, `alpha` 0.0198, `beta` 0) are a least-squares fit to five approximate readings from four Indian adults (BMI 19.5 to 34.6). Even the best fit misses some of them by about 2 cm: two people of the same build read 4 cm apart, and the same 100 kg adult taped 45, 55 and about 58 cm on different days. That is scatter from the tape and clothes, which no curve removes.

### Refitting

Put tape checks in a CSV with columns `height_cm, weight_kg, camera_cm, tape_cm` (`camera_cm` is the "camera" number in test mode, before the correction), then:

    python scripts/fit_shoulder_curve.py checks.csv

It prints each person's error, the error on a new person (leave-one-out: each person predicted by a curve fitted without them) and the `MASS_CURVE` line to paste. Keep `beta` at 0 until there are well over 10 checks: on five checks a bent curve fitted them better but missed a new person by 8 cm on average.

## Collecting checks

1. Open the shop with `measuredebug` in the address once, for example `/shop?measuredebug`. It stays on for that browser tab.
2. Measure a child with the camera: front photo, then the side photo it asks for (child turned sideways, arms down, phone in the same place). The results screen shows `Joints J cm, outline O cm, camera C cm, with weight W cm, side depth D cm`.
3. Measure the same child with a tape, the same way every time: across the back, tape lying on the body, from the bony point at the outer top of one shoulder to the other. Write down T. Also measure their best-fitting shirt laid flat, seam to seam, if there is one.
4. Write height, weight, C and T into the CSV for the fit; keep J, O and D too (depth may replace the weight curve later).
5. Do this for 10 to 20 children, slim and heavy, in fitted clothes (a loose shirt widens the outline).

## Setting the blend

For each child, `k = (T - J) / (O - J)`. Set `SHOULDER_EDGE_BLEND` to the median `k`.

If the readings are still off by the same percentage for everyone after that, change `SHOULDER_CALIBRATION_FACTOR` on the server instead (no new release needed).

If `k` is clearly different for slim and heavy children (for example 0.2 and 0.6), one blend can't fit both. Bring the numbers back so the blend can be made to depend on how far the outline is from the joints.
