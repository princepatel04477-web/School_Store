# Courier Delivery & PIN Serviceability Provider Configuration

This document specifies the architecture, environment configuration, adapter contract, and operational policies for Indian delivery address verification and courier serviceability in School Store.

---

## 1. Core Architecture Principles

Three concerns are strictly decoupled:
1. **PIN Code Format Validation**: A 6-digit number not beginning with 0 (`^[1-9]\d{5}$`). Format validity ensures syntactic correctness only.
2. **Geographical Lookup**: Mapping a 6-digit PIN to its postal district/city and Indian State or Union Territory.
3. **Courier Serviceability**: Actual confirmation from an active logistics provider (e.g., Shiprocket, Delhivery, Blue Dart) that they pick up and deliver to the parent's doorstep.

### Golden Rule
**A valid PIN format or geographical match must NEVER produce a false delivery promise.**
If the courier provider is unconfigured, unreachable, or responds with an error, the serviceability status MUST be marked `UNKNOWN`, never `SERVICEABLE`.

---

## 2. Environment Variables

The following environment variables configure the courier serviceability provider on the backend:

| Variable | Type | Default | Description |
|---|---|---|---|
| `DELIVERY_PROVIDER_URL` | string (URL) | `""` | The HTTP endpoint for the courier serviceability check (e.g. `https://apiv2.shiprocket.in/v1/external/courier/serviceability/`) |
| `DELIVERY_PROVIDER_API_KEY` | string (secret) | `""` | Bearer token / API token for authenticating to the provider API |
| `DELIVERY_PROVIDER_NAME` | string | `"Shiprocket"` | Human-readable provider label (e.g., `Shiprocket`, `Delhivery`, `Blue Dart`) |

### Production Configuration Example (.env)
```env
DELIVERY_PROVIDER_URL=https://apiv2.shiprocket.in/v1/external/courier/serviceability/
DELIVERY_PROVIDER_API_KEY=your_production_courier_api_token
DELIVERY_PROVIDER_NAME=Shiprocket
```

When `DELIVERY_PROVIDER_URL` or `DELIVERY_PROVIDER_API_KEY` is empty, the system operates in **unconfigured provider mode**:
- PIN codes are formatted and geocoded via reference data.
- Serviceability returns status `UNKNOWN` with the honest message:
  *"Courier serviceability unconfirmed. Provider integration not configured."*
- Parents can still complete their orders; store administration and dispatch verify local courier availability during order processing.

---

## 3. Provider Adapter Contract (`backend/orders/delivery.py`)

The `PinServiceAdapter` class manages external courier calls:

```python
class PinServiceAdapter:
    def is_provider_configured(self) -> bool:
        return bool(self.provider_url and self.provider_api_key)

    def lookup_geography(self, pincode: str) -> dict:
        """Returns {"found": bool, "pincode": str, "city": str | None, "state": str | None}"""

    def check_serviceability(self, pincode: str) -> dict:
        """
        Returns:
        {
            "status": "SERVICEABLE" | "UNSERVICEABLE" | "UNKNOWN",
            "message": str,
            "provider": str | None
        }
        """
```

### Timeout & Failure Handling
- Calls to the courier provider enforce a strict 5-second network timeout.
- Network errors, timeouts, or HTTP non-200 responses safely fall back to:
  ```json
  {
    "status": "UNKNOWN",
    "message": "Courier serviceability check timed out or failed.",
    "provider": "Shiprocket"
  }
  ```

---

## 4. Frontend Behaviour & UX Safeguards

1. **State Independence**:
   - The unconditional Gujarat default has been removed.
   - If the parent browses a school in another state (e.g., Punjab, Maharashtra, Delhi), the state pre-fills with that school's state.
   - If no school state is available, the parent is asked to select their State or Union Territory from the 36 standard Indian States and UTs.
2. **Preserving Manual Corrections**:
   - If a parent manually modifies their City or State, subsequent PIN lookups will NOT overwrite the parent's manual edits.
3. **Transparent Serviceability States**:
   - `SERVICEABLE`: Displays home delivery confirmation.
   - `UNSERVICEABLE`: Advises parent that home delivery is not available for that PIN and prompts school pickup.
   - `UNKNOWN`: Informs the parent that delivery availability to their area will be verified by the school store after booking.
4. **School Pickup Exemption**:
   - For school pickup orders, home delivery address fields (street, city, state, PIN) are not required and are not prompted.
