# Day 1–3 integration evidence

The integration branch combines the parent-account and order work from
`feat/parent-orders` with the payment recovery work from `fix/razorpay-return-recovery`.
Order migrations apply payment recovery in `0014_payment_recovery` and fulfilment in
`0015_fulfilment`.

| Scenario | Evidence |
| --- | --- |
| Payment recovery after returning to My Orders | Simulated capture updates the receipt and refreshes the order timeline. The Day 2 gateway and browser fixtures cover this flow. |
| Unpaid online order or open payment review | API rejects the claim. The seeded browser queue showed Awaiting payment and disabled claiming. A simulated capture opened packing on the live order and left the cancelled order blocked for refund review. |
| Prepaid and COD packing | API tests cover payment eligibility, claim ownership and line confirmation. The seeded browser run took a prepaid pickup and COD home delivery through packing. |
| Simultaneous claims | PostgreSQL regression uses two separate connections and requires one successful claim, one conflict, and one processing event. |
| Postal handover and corrections | The seeded browser run recorded an article number, corrected its case, and displayed the correction history to staff. API tests cover retries, article-number collisions, invalid receipt values and client-supplied booking times. |
| Parent tracking and privacy | The seeded parent account displayed the corrected article number and booking date. Copy put the displayed number on the clipboard. Staff audit notes stayed private. |
| School pickup | Staff marked the seeded pickup collected. Its parent detail showed collection without a postal link or article number. |
| Legacy statuses | API includes legacy SHIPPED orders in the sent queue. Timeline tests cover legacy SHIPPED and PENDING in Gujarati and Hindi. |

Provider checks use simulated Razorpay responses and sample article numbers. A real
Razorpay capture, live India Post consignment and Android release build remain
unverified.
