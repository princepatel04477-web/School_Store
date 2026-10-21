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

## Weight correction (live)

Until side photos give enough data for a depth formula, the curve is estimated from weight for height. The camera reading is raised 1.5% for every BMI point above 20, at most 30% (`BACK_CURVE` in `frontend/src/measure/config.ts`). From three Indian adults with the camera reading before this correction:

| Height | Weight | BMI | Camera | Tape | Corrected |
|---|---|---|---|---|---|
| 166 cm | 55 kg | 20.0 | 39.5 cm | 40 cm | 39.5 cm |
| not given | not given | about 24 | 3 to 4 cm short | | about +6% |
| 170 cm | 100 kg | 34.6 | 44.9 cm | 55 cm | 54.7 cm |

The same 100 kg adult once taped 45 cm, so the tape method has to be the same every time (below) or the correction chases the wrong number.

## Collecting checks

1. Open the shop with `measuredebug` in the address once, for example `/shop?measuredebug`. It stays on for that browser tab.
2. Measure a child with the camera: front photo, then the side photo it asks for (child turned sideways, arms down, phone in the same place). The results screen shows `Joints J cm, outline O cm, shown S cm, side depth D cm`.
3. Measure the same child with a tape, the same way every time: across the back, tape lying on the body, from the bony point at the outer top of one shoulder to the other. Write down T. Also measure their best-fitting shirt laid flat, seam to seam, if there is one.
4. Send J, O, S, D, T (and the shirt) for each person.
5. Do this for 10 to 20 children, slim and heavy, in fitted clothes (a loose shirt widens the outline).

## Setting the blend

For each child, `k = (T - J) / (O - J)`. Set `SHOULDER_EDGE_BLEND` to the median `k`.

If the readings are still off by the same percentage for everyone after that, change `SHOULDER_CALIBRATION_FACTOR` on the server instead (no new release needed).

If `k` is clearly different for slim and heavy children (for example 0.2 and 0.6), one blend can't fit both. Bring the numbers back so the blend can be made to depend on how far the outline is from the joints.
