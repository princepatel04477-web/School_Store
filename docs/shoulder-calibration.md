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

## Collecting checks

1. Open the shop with `measuredebug` in the address once, for example `/shop?measuredebug`. It stays on for that browser tab.
2. Measure a child with the camera. The results screen shows `Joints J cm, outline O cm, shown S cm`.
3. Measure the same child with a tape the way the tailor does: across the back, from shoulder point to shoulder point. Write down T.
4. Do this for 10 to 20 children, slim and heavy, in fitted clothes (a loose shirt widens the outline).

## Setting the blend

For each child, `k = (T - J) / (O - J)`. Set `SHOULDER_EDGE_BLEND` to the median `k`.

If the readings are still off by the same percentage for everyone after that, change `SHOULDER_CALIBRATION_FACTOR` on the server instead (no new release needed).

If `k` is clearly different for slim and heavy children (for example 0.2 and 0.6), one blend can't fit both. Bring the numbers back so the blend can be made to depend on how far the outline is from the joints.
