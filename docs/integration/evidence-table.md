# Day 2 + Day 3 Integration Evidence Table

This table summarizes the execution results and evidence classification across the integration test cases.

> [!NOTE]
> A sample article number proves the app displays tracking details. Actual postal tracking requires evidence from a real booking.

---

## Evidence Classification Rules
- **PROVIDER-VERIFIED**: Requires live production/sandbox response from Razorpay or India Post. (Not permitted in this local test environment; 0 rows use this label).
- **SIMULATED**: Ran in local automated test suite using test doubles, test payment fixtures, or sample article numbers.
- **PENDING**: Dependent on unmerged modules or unrun tests.
- **UNVERIFIED**: Not run or run on unverified assumptions.

---

## Test Execution Matrix

| Case | Store Order Reference | Payment State | Packing Result | Dispatch Result | Parent-Visible Result | Result | Evidence Label |
|---|---|---|---|---|---|---|---|
| Case 1 (Day 2 + Day 3) | `ORD-INT-001` | Verified online payment | Claimed & Packed (stock deducted once) | Dispatched (`EM123456789IN`) | Parent detail shows `PAID`, `CONFIRMED`, article number | **PASS** | SIMULATED (Test payment fixture + fake gateway) |
| Case 2 (Day 2 + Day 3) | `ORD-INT-PENDING`, `ORD-INT-LATE` | Pending online payment / Late capture cancelled | Claim & pack blocked with 409 `PACKING_BLOCKED` | Not dispatched | N/A | **PASS** | SIMULATED (Conservative packing rule) |
| Case 3 (Day 2 + Day 3) | `ORD-SIM-COD` | Unpaid Cash on Delivery (`COD_DUE`) | Allowed to pack (`COD_DUE`) | Dispatched | Unpaid with amount due (₹500.00) displayed | **PASS** | SIMULATED (COD payment rule) |
| Case 4 (Day 2 + Day 3) | `ORD-SIM-PICKUP` | Verified prepaid school pickup | Claimed & Packed | Ready for pickup, then delivered | "Delivered", no postal data, no India Post text | **PASS** | SIMULATED (School pickup flow) |
| Case 5 (Day 2 + Day 3) | `ORD-SIM-REPEAT` | Verified prepaid | Packed once, repeat changed=False | Dispatched with sample article number, repeat changed=False | Exactly 1 PACKED and 1 DISPATCHED timeline event | **PASS** | SIMULATED (Idempotent packing & dispatch) |
| Case 6 (Day 2 + Day 3) | `ORD-SIM-SECURE` | Verified prepaid | Packed | Dispatched with sample article number | Other family receives HTTP 404; article number absent | **PASS** | SIMULATED (Parent scoping & privacy) |
| Case 3 [SIMULATED Variant] | `ORD-SIM-COD` | Unpaid Cash on Delivery | Packed via packing rule test double | Dispatched | Unpaid with amount due (₹500.00) displayed | **PASS** | SIMULATED (Task C packing rule test double) |
| Case 4 [SIMULATED Variant] | `ORD-SIM-PICKUP` | Prepaid (Simulated) | Packed via packing rule test double | Marked ready for pickup, then delivered | "Delivered", no postal data, no India Post text | **PASS** | SIMULATED (Task C packing rule test double) |
| Case 5 [SIMULATED Variant] | `ORD-SIM-REPEAT` | Prepaid (Simulated) | Packed once, repeat changed=False | Dispatched with sample article number, repeat changed=False | Exactly 1 PACKED and 1 DISPATCHED timeline event | **PASS** | SIMULATED (Sample article number `EM555555555IN`) |
| Case 6 [SIMULATED Variant] | `ORD-SIM-SECURE` | Prepaid (Simulated) | Packed | Dispatched with sample article number | Other family receives HTTP 404; article number absent | **PASS** | SIMULATED (Sample article number `EM888888888IN`) |

---

*Personal data redacted: child names, telephone numbers, and addresses have been omitted or replaced with generic identifiers.*
