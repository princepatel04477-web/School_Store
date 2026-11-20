# Missing Kendriya Vidyalaya product photos

The 16 photos in `kv-uniform-photos.zip` are live in the KV catalog. These items
are still waiting for a photo from the new set. Each keeps the older photo it
already had, so no card shows a blank or a stand-in.

When a photo arrives, save it as a square PNG with the exact name below, then run
`node scripts/convert-product-photos.mjs <folder>` from `frontend/` and set
`replaced=True` on its entry in `backend/catalog/kv_photos.py`. Re-running the
migration is not needed for these items: the file name stays the same.

## Still to supply

| Photo to make | Items that use it | Shows now |
|---|---|---|
| `kv-boys-1-5-shirt-summer` | KV Boys Summer Shirt (Class 1-5): check mandarin-collar shirt with grey shorts | Older photo, same name |
| `kv-house-tshirt-red` | KV Red House PT T-Shirt (Class 1-5 and 6-12) | Older photo, same name |
| `kv-house-tshirt-blue` | KV Blue House PT T-Shirt (Class 1-5 and 6-12) | Older photo, same name |
| `kv-house-tshirt-green` | KV Green House PT T-Shirt (Class 1-5 and 6-12) | Older photo, same name |
| `kv-house-tshirt-yellow` | KV Yellow House PT T-Shirt (Class 1-5 and 6-12) | Older photo, same name |

## Items the photo set has no row for

Four bottoms were not in the photo table. Their current photos stay as they are.

| Item | Classes | Photo |
|---|---|---|
| KV Boys Grey Shorts | 1-5 | `kv-boys-1-5-shorts` |
| KV Boys Grey Trousers | 6-12 | `kv-boys-6-12-trousers` |
| KV Girls Grey Divided Skirt | 3-8 | `kv-girls-3-8-skirt` |
| KV Girls Grey Trousers | 9-12 | `kv-girls-9-12-trousers` |

## To check with the client

- KV Girls Winter Full-Sleeve Shirt is sold for Classes 1-8, but the KVS pattern
  puts this shirt at Classes III-VIII. Classes 1 and 2 see the III-VIII photo.
