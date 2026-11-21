# Day 2 + Day 3 Integration Evidence Table

This table summarizes the execution results and evidence classification across the integration test cases.

> [!NOTE]
> A sample article number proves the app displays tracking details. Actual postal tracking requires evidence from a real booking.

---

## Evidence Classification Rules
- **PROVIDER-VERIFIED**: Requires live production/sandbox response from Razorpay or India Post. (Not permitted in this local test environment; 0 rows use this label).
- **SIMULATED**: Ran in local automated test suite using test doubles, test payment fixtures, or sample article numbers.
- **PENDING**: Dependent on Day 2 codebase (`orders.payment_rules`), which is not present on this branch.
- **UNVERIFIED**: Not run or run on unverified assumptions.

---

## Test Execution Matrix

| Case | Store Order Reference | Payment State | Packing Result | Dispatch Result | Parent-Visible Result | Result | Evidence Label |
|---|---|---|---|---|---|---|---|
| Case 1 (Real Day 2) | `ORD-****` | Verified online payment | Packing permitted (2 garments verified) | Dispatched via India Post | Parent sees article number; payment Paid; 1 stock deduction | **PENDING** | PENDING (Awaiting Day 2 `payment_rules`) |
| Case 2 (Real Day 2) | `ORD-****` | Pending payment / Late capture | Blocked with 409 `PACKING_BLOCKED` | Not reached | Order unchanged; no leakage | **PENDING** | PENDING (Awaiting Day 2 `payment_rules`) |
| Case 3 (Real Day 2) | `ORD-****` | Unpaid Cash on Delivery | Packing permitted for confirmed COD | Dispatched | Unpaid with amount due (₹500.00) displayed | **PENDING** | PENDING (Awaiting Day 2 `payment_rules`) |
| Case 4 (Real Day 2) | `ORD-****` | Verified prepaid | Packing permitted | Ready at School / Delivered | "Ready at school", "Delivered", no postal data | **PENDING** | PENDING (Awaiting Day 2 `payment_rules`) |
| Case 5 (Real Day 2) | `ORD-****` | Verified prepaid | First pack 200, repeat returns 200 (`changed=false`) | First dispatch 200, repeat returns 200 (`changed=false`) | Exactly 1 PACKED and 1 DISPATCHED timeline event | **PENDING** | PENDING (Awaiting Day 2 `payment_rules`) |
| Case 6 (Real Day 2) | `ORD-****` | Verified prepaid | Packed | Dispatched with consignment number | Other family receives HTTP 404; article number omitted | **PENDING** | PENDING (Awaiting Day 2 `payment_rules`) |
| Case 3 [SIMULATED] | `ORD-****` | Unpaid Cash on Delivery | Packed via packing rule test double | Dispatched | Unpaid with amount due (₹500.00) displayed | **PASS** | SIMULATED (Task C packing rule test double) |
| Case 4 [SIMULATED] | `ORD-****` | Prepaid (Simulated) | Packed via packing rule test double | Marked ready for pickup, then delivered | "Delivered", no postal data, no India Post text | **PASS** | SIMULATED (Task C packing rule test double) |
| Case 5 [SIMULATED] | `ORD-****` | Prepaid (Simulated) | Packed once, repeat changed=False | Dispatched with sample article number, repeat changed=False | Exactly 1 PACKED and 1 DISPATCHED timeline event | **PASS** | SIMULATED (Sample article number `EM555555555IN`) |
| Case 6 [SIMULATED] | `ORD-****` | Prepaid (Simulated) | Packed | Dispatched with sample article number | Other family receives HTTP 404; article number absent | **PASS** | SIMULATED (Sample article number `EM888888888IN`) |

---

*Personal data redacted: child names, telephone numbers, and addresses have been omitted or replaced with generic identifiers.*
