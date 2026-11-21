import re
from typing import Any
from django.conf import settings
from rest_framework import serializers

# 28 States and 8 Union Territories in India
INDIAN_STATES_AND_UTS = {
    # 28 States
    "Andhra Pradesh",
    "Arunachal Pradesh",
    "Assam",
    "Bihar",
    "Chhattisgarh",
    "Goa",
    "Gujarat",
    "Haryana",
    "Himachal Pradesh",
    "Jharkhand",
    "Karnataka",
    "Kerala",
    "Madhya Pradesh",
    "Maharashtra",
    "Manipur",
    "Meghalaya",
    "Mizoram",
    "Nagaland",
    "Odisha",
    "Punjab",
    "Rajasthan",
    "Sikkim",
    "Tamil Nadu",
    "Telangana",
    "Tripura",
    "Uttar Pradesh",
    "Uttarakhand",
    "West Bengal",
    # 8 Union Territories
    "Andaman and Nicobar Islands",
    "Chandigarh",
    "Dadra and Nagar Haveli and Daman and Diu",
    "Delhi",
    "Jammu and Kashmir",
    "Ladakh",
    "Lakshadweep",
    "Puducherry",
}

# Common abbreviations, legacy names, and variants mapped to canonical names
STATE_ALIASES = {
    "delhi": "Delhi",
    "nct of delhi": "Delhi",
    "national capital territory of delhi": "Delhi",
    "new delhi": "Delhi",
    "pondicherry": "Puducherry",
    "orissa": "Odisha",
    "jammu & kashmir": "Jammu and Kashmir",
    "j&k": "Jammu and Kashmir",
    "daman and diu": "Dadra and Nagar Haveli and Daman and Diu",
    "daman & diu": "Dadra and Nagar Haveli and Daman and Diu",
    "dadra and nagar haveli": "Dadra and Nagar Haveli and Daman and Diu",
    "dadra & nagar haveli": "Dadra and Nagar Haveli and Daman and Diu",
    "dnh & dd": "Dadra and Nagar Haveli and Daman and Diu",
    "andaman & nicobar islands": "Andaman and Nicobar Islands",
    "andaman and nicobar": "Andaman and Nicobar Islands",
}

# Build lookup map for case-insensitive matching
_CANONICAL_STATE_MAP = {s.lower(): s for s in INDIAN_STATES_AND_UTS}
_CANONICAL_STATE_MAP.update(STATE_ALIASES)

PINCODE_REGEX = re.compile(r"^[1-9]\d{5}$")
INDIAN_MOBILE_REGEX = re.compile(r"^[6-9]\d{9}$")


def normalize_indian_state(value: str) -> str | None:
    """Matches an input string to a canonical Indian State or Union Territory."""
    if not value or not isinstance(value, str):
        return None
    cleaned = value.strip().lower()
    return _CANONICAL_STATE_MAP.get(cleaned)


def validate_indian_phone(value: str) -> str:
    """
    Validates and normalizes an Indian 10-digit mobile number.
    Accepts formats with leading +91, 91, or 0.
    Must resolve to a 10-digit number starting with 6, 7, 8, or 9.
    """
    if not value or not isinstance(value, str):
        raise serializers.ValidationError("Enter a valid 10-digit Indian mobile number.")

    digits = re.sub(r"\D", "", value)
    if digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    elif digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]

    if not INDIAN_MOBILE_REGEX.match(digits):
        raise serializers.ValidationError("Enter a valid 10-digit Indian mobile number.")

    return digits


def validate_pincode_format(value: str) -> str:
    """Validates that a PIN code is exactly 6 digits not starting with 0."""
    if not value or not isinstance(value, str):
        raise serializers.ValidationError("Enter a valid 6-digit Indian PIN code.")

    pin = value.strip()
    if not PINCODE_REGEX.match(pin):
        raise serializers.ValidationError("Enter a valid 6-digit Indian PIN code.")

    return pin


def clean_delivery_details(raw: Any, fulfillment_type: str) -> dict:
    """
    Validates, trims, bounds, and normalizes delivery_details.

    - HOME_DELIVERY requires:
      1. recipient_name (non-empty, max 120 chars)
      2. phone (valid 10-digit Indian mobile)
      3. address (street address, non-empty, max 300 chars)
      4. city (non-empty, max 100 chars)
      5. state (valid Indian state/UT, normalized)
      6. pincode (6-digit Indian PIN code)

    - SCHOOL_PICKUP:
      Does NOT require a home address (street, city, state, PIN).
      Optional recipient_name, phone, and notes are cleaned if provided.
    """
    if raw is None:
        raw = {}

    if not isinstance(raw, dict):
        raise serializers.ValidationError({"delivery_details": ["Delivery details must be a valid JSON object."]})

    from .models import Order

    errors = {}
    cleaned = {}

    # Read flexible input keys for backwards compatibility
    recipient = str(raw.get("recipient_name") or raw.get("recipient") or raw.get("name") or "").strip()
    phone_raw = str(raw.get("phone") or raw.get("mobile") or raw.get("phone_number") or "").strip()
    address_raw = str(raw.get("address") or raw.get("address_line1") or raw.get("street_address") or "").strip()
    address_line2_raw = str(raw.get("address_line2") or "").strip()
    city_raw = str(raw.get("city") or raw.get("city_name") or "").strip()
    state_raw = str(raw.get("state") or raw.get("state_name") or "").strip()
    pincode_raw = str(raw.get("pincode") or raw.get("pin_code") or raw.get("pin") or raw.get("postal_code") or "").strip()
    notes_raw = str(raw.get("notes") or raw.get("note") or "").strip()

    if fulfillment_type == Order.FulfillmentType.HOME_DELIVERY:
        # 1. Recipient
        if not recipient:
            errors["recipient_name"] = ["Recipient name is required for home delivery."]
        else:
            cleaned["recipient_name"] = recipient[:120]

        # 2. Phone
        if not phone_raw:
            errors["phone"] = ["A valid Indian mobile number is required for home delivery."]
        else:
            try:
                cleaned["phone"] = validate_indian_phone(phone_raw)
            except serializers.ValidationError as err:
                errors["phone"] = err.detail if isinstance(err.detail, list) else [str(err.detail)]

        # 3. Address
        if not address_raw:
            errors["address"] = ["Street address is required for home delivery."]
        elif len(address_raw) < 3:
            errors["address"] = ["Street address is too short."]
        else:
            cleaned["address"] = address_raw[:300]
            if address_line2_raw:
                cleaned["address_line2"] = address_line2_raw[:300]

        # 4. City
        if not city_raw:
            errors["city"] = ["City is required for home delivery."]
        elif len(city_raw) < 2:
            errors["city"] = ["City name is too short."]
        else:
            cleaned["city"] = city_raw[:100]

        # 5. State / UT
        if not state_raw:
            errors["state"] = ["State or Union Territory is required for home delivery."]
        else:
            canonical_state = normalize_indian_state(state_raw)
            if not canonical_state:
                errors["state"] = ["Enter a valid Indian state or union territory."]
            else:
                cleaned["state"] = canonical_state

        # 6. PIN code
        if not pincode_raw:
            errors["pincode"] = ["PIN code is required for home delivery."]
        else:
            try:
                cleaned["pincode"] = validate_pincode_format(pincode_raw)
            except serializers.ValidationError as err:
                errors["pincode"] = err.detail if isinstance(err.detail, list) else [str(err.detail)]

        if notes_raw:
            cleaned["notes"] = notes_raw[:500]

        if errors:
            raise serializers.ValidationError({"delivery_details": errors})

        return cleaned

    else:
        # SCHOOL_PICKUP or other fulfillment types:
        # Pickup works without a home address
        if recipient:
            cleaned["recipient_name"] = recipient[:120]
        if phone_raw:
            try:
                cleaned["phone"] = validate_indian_phone(phone_raw)
            except serializers.ValidationError:
                # If non-empty but invalid phone provided, flag error
                errors["phone"] = ["Enter a valid 10-digit Indian mobile number."]
        if notes_raw:
            cleaned["notes"] = notes_raw[:500]

        # Preserve pickup tag if present (e.g. from seed data)
        if raw.get("pickup"):
            cleaned["pickup"] = str(raw["pickup"])[:50]

        # If any optional home address fields were supplied, sanitize them
        if address_raw:
            cleaned["address"] = address_raw[:300]
        if address_line2_raw:
            cleaned["address_line2"] = address_line2_raw[:300]
        if city_raw:
            cleaned["city"] = city_raw[:100]
        if state_raw:
            canonical_state = normalize_indian_state(state_raw)
            if canonical_state:
                cleaned["state"] = canonical_state
            else:
                cleaned["state"] = state_raw[:100]
        if pincode_raw and PINCODE_REGEX.match(pincode_raw):
            cleaned["pincode"] = pincode_raw

        if errors:
            raise serializers.ValidationError({"delivery_details": errors})

        return cleaned


# Built-in reference data for major Indian Postal PIN prefixes
# Format validation, geographical lookup, and actual courier serviceability must remain strictly separate.
PIN_PREFIX_GEOGRAPHY = {
    # Delhi (11)
    "110001": ("New Delhi", "Delhi"),
    "110003": ("New Delhi", "Delhi"),
    "110010": ("Delhi Cantt", "Delhi"),
    "110047": ("South Delhi", "Delhi"),
    "110062": ("Pushp Vihar", "Delhi"),
    # Punjab (14, 15) & Chandigarh (16)
    "144001": ("Jalandhar", "Punjab"),
    "144008": ("Jalandhar", "Punjab"),
    "141001": ("Ludhiana", "Punjab"),
    "143001": ("Amritsar", "Punjab"),
    "160003": ("Chandigarh", "Chandigarh"),
    "160009": ("Chandigarh", "Chandigarh"),
    "160014": ("Chandigarh", "Chandigarh"),
    "160015": ("Chandigarh", "Chandigarh"),
    "160017": ("Chandigarh", "Chandigarh"),
    "160019": ("Chandigarh", "Chandigarh"),
    "160022": ("Chandigarh", "Chandigarh"),
    "160030": ("Chandigarh", "Chandigarh"),
    "160036": ("Chandigarh", "Chandigarh"),
    "160047": ("Chandigarh", "Chandigarh"),
    # Haryana (12, 13)
    "122001": ("Gurugram", "Haryana"),
    "121001": ("Faridabad", "Haryana"),
    "131001": ("Sonipat", "Haryana"),
    # Uttar Pradesh (20-28) & Uttarakhand (24, 26)
    "201301": ("Noida", "Uttar Pradesh"),
    "201001": ("Ghaziabad", "Uttar Pradesh"),
    "226001": ("Lucknow", "Uttar Pradesh"),
    "248001": ("Dehradun", "Uttarakhand"),
    # Rajasthan (30-34)
    "302001": ("Jaipur", "Rajasthan"),
    "342001": ("Jodhpur", "Rajasthan"),
    # Gujarat (36-39)
    "380001": ("Ahmedabad", "Gujarat"),
    "380015": ("Ahmedabad", "Gujarat"),
    "390001": ("Vadodara", "Gujarat"),
    "395001": ("Surat", "Gujarat"),
    "395007": ("Surat", "Gujarat"),
    "395009": ("Surat", "Gujarat"),
    "360001": ("Rajkot", "Gujarat"),
    # Maharashtra (40-44)
    "400001": ("Mumbai", "Maharashtra"),
    "400050": ("Mumbai", "Maharashtra"),
    "411001": ("Pune", "Maharashtra"),
    "440001": ("Nagpur", "Maharashtra"),
    # Madhya Pradesh (45-48) & Goa (403)
    "403001": ("Panaji", "Goa"),
    "452001": ("Indore", "Madhya Pradesh"),
    "462001": ("Bhopal", "Madhya Pradesh"),
    # Telangana (50) & Andhra Pradesh (51-53)
    "500001": ("Hyderabad", "Telangana"),
    "530001": ("Visakhapatnam", "Andhra Pradesh"),
    # Karnataka (56-59)
    "560001": ("Bengaluru", "Karnataka"),
    "570001": ("Mysuru", "Karnataka"),
    # Tamil Nadu (60-64) & Kerala (67-69)
    "600001": ("Chennai", "Tamil Nadu"),
    "641001": ("Coimbatore", "Tamil Nadu"),
    "695001": ("Thiruvananthapuram", "Kerala"),
    "682001": ("Kochi", "Kerala"),
    # West Bengal (70-74)
    "700001": ("Kolkata", "West Bengal"),
    # Bihar (80-85)
    "800001": ("Patna", "Bihar"),
}

# 2-digit PIN prefix to state mapping for broad geographic lookup fallback
PIN_PREFIX_2_STATE = {
    "11": ("Delhi", "Delhi"),
    "12": ("Haryana", "Haryana"),
    "13": ("Haryana", "Haryana"),
    "14": ("Punjab", "Punjab"),
    "15": ("Punjab", "Punjab"),
    "16": ("Chandigarh", "Chandigarh"),
    "17": ("Himachal Pradesh", "Himachal Pradesh"),
    "18": ("Jammu and Kashmir", "Jammu and Kashmir"),
    "19": ("Jammu and Kashmir", "Jammu and Kashmir"),
    "20": ("Uttar Pradesh", "Uttar Pradesh"),
    "21": ("Uttar Pradesh", "Uttar Pradesh"),
    "22": ("Uttar Pradesh", "Uttar Pradesh"),
    "23": ("Uttar Pradesh", "Uttar Pradesh"),
    "24": ("Uttarakhand", "Uttarakhand"),
    "25": ("Uttar Pradesh", "Uttar Pradesh"),
    "26": ("Uttar Pradesh", "Uttar Pradesh"),
    "27": ("Uttar Pradesh", "Uttar Pradesh"),
    "28": ("Uttar Pradesh", "Uttar Pradesh"),
    "30": ("Jaipur", "Rajasthan"),
    "31": ("Rajasthan", "Rajasthan"),
    "32": ("Rajasthan", "Rajasthan"),
    "33": ("Rajasthan", "Rajasthan"),
    "34": ("Rajasthan", "Rajasthan"),
    "36": ("Gujarat", "Gujarat"),
    "37": ("Gujarat", "Gujarat"),
    "38": ("Ahmedabad", "Gujarat"),
    "39": ("Surat", "Gujarat"),
    "40": ("Mumbai", "Maharashtra"),
    "41": ("Pune", "Maharashtra"),
    "42": ("Maharashtra", "Maharashtra"),
    "43": ("Maharashtra", "Maharashtra"),
    "44": ("Nagpur", "Maharashtra"),
    "45": ("Indore", "Madhya Pradesh"),
    "46": ("Bhopal", "Madhya Pradesh"),
    "47": ("Madhya Pradesh", "Madhya Pradesh"),
    "48": ("Madhya Pradesh", "Madhya Pradesh"),
    "49": ("Chhattisgarh", "Chhattisgarh"),
    "50": ("Hyderabad", "Telangana"),
    "51": ("Andhra Pradesh", "Andhra Pradesh"),
    "52": ("Andhra Pradesh", "Andhra Pradesh"),
    "53": ("Visakhapatnam", "Andhra Pradesh"),
    "56": ("Bengaluru", "Karnataka"),
    "57": ("Karnataka", "Karnataka"),
    "58": ("Karnataka", "Karnataka"),
    "59": ("Karnataka", "Karnataka"),
    "60": ("Chennai", "Tamil Nadu"),
    "61": ("Tamil Nadu", "Tamil Nadu"),
    "62": ("Madurai", "Tamil Nadu"),
    "63": ("Tamil Nadu", "Tamil Nadu"),
    "64": ("Coimbatore", "Tamil Nadu"),
    "67": ("Kerala", "Kerala"),
    "68": ("Kochi", "Kerala"),
    "69": ("Thiruvananthapuram", "Kerala"),
    "70": ("Kolkata", "West Bengal"),
    "71": ("West Bengal", "West Bengal"),
    "72": ("West Bengal", "West Bengal"),
    "73": ("West Bengal", "West Bengal"),
    "74": ("West Bengal", "West Bengal"),
    "75": ("Odisha", "Odisha"),
    "76": ("Odisha", "Odisha"),
    "77": ("Odisha", "Odisha"),
    "78": ("Assam", "Assam"),
    "79": ("North East", "Meghalaya"),
    "80": ("Patna", "Bihar"),
    "81": ("Bihar", "Bihar"),
    "82": ("Jharkhand", "Jharkhand"),
    "83": ("Ranchi", "Jharkhand"),
    "84": ("Bihar", "Bihar"),
    "85": ("Bihar", "Bihar"),
}


class PinServiceAdapter:
    """
    Adapter keeping three distinct layers strictly separated:
    1. Syntax format validation: is it a 6-digit Indian PIN code?
    2. Geographical lookup: what City / State does this PIN correspond to?
    3. Courier serviceability: has a configured courier provider confirmed delivery?

    CRITICAL RULE:
    Format validity or geographic match must NEVER produce a false delivery promise.
    When courier serviceability provider is unconfigured, unreachable, or fails,
    serviceability status MUST be 'UNKNOWN', never 'SERVICEABLE'.
    """

    @property
    def provider_url(self) -> str:
        return getattr(settings, "DELIVERY_PROVIDER_URL", "")

    @property
    def provider_api_key(self) -> str:
        return getattr(settings, "DELIVERY_PROVIDER_API_KEY", "")

    @property
    def provider_name(self) -> str:
        return getattr(settings, "DELIVERY_PROVIDER_NAME", "Shiprocket")

    def is_provider_configured(self) -> bool:
        """Returns True only when live courier serviceability credentials are set."""
        return bool(self.provider_url and self.provider_api_key)

    def lookup_geography(self, pincode: str) -> dict:
        """
        Looks up City and State for a PIN code.
        Returns a dict: {"found": bool, "pincode": str, "city": str | None, "state": str | None}
        """
        if not pincode or not isinstance(pincode, str):
            return {"found": False, "pincode": "", "city": None, "state": None}

        pin = pincode.strip()
        if not PINCODE_REGEX.match(pin):
            return {"found": False, "pincode": pin, "city": None, "state": None}

        # 1. Exact match in reference data
        if pin in PIN_PREFIX_GEOGRAPHY:
            city, state = PIN_PREFIX_GEOGRAPHY[pin]
            return {"found": True, "pincode": pin, "city": city, "state": state}

        # 2. Check active School records for registered PIN codes
        try:
            from schools.models import School
            school = School.objects.filter(pincode=pin, active=True).select_related("city").first()
            if school and school.city:
                return {
                    "found": True,
                    "pincode": pin,
                    "city": school.city.name,
                    "state": school.city.state or "Gujarat",
                }
        except Exception:
            pass

        # 3. Fallback to 2-digit postal prefix circle
        prefix = pin[:2]
        if prefix in PIN_PREFIX_2_STATE:
            city_fallback, state = PIN_PREFIX_2_STATE[prefix]
            return {"found": True, "pincode": pin, "city": city_fallback, "state": state}

        return {"found": False, "pincode": pin, "city": None, "state": None}

    def check_serviceability(self, pincode: str) -> dict:
        """
        Evaluates courier serviceability for a PIN code.

        Returns:
            {
                "status": "SERVICEABLE" | "UNSERVICEABLE" | "UNKNOWN",
                "message": str,
                "provider": str | None,
            }

        If provider credentials are missing or call fails, status is 'UNKNOWN'.
        Delivery is NEVER promised based on PIN validity alone.
        """
        if not pincode or not isinstance(pincode, str):
            return {
                "status": "UNKNOWN",
                "message": "Invalid PIN code format.",
                "provider": None,
            }

        pin = pincode.strip()
        if not PINCODE_REGEX.match(pin):
            return {
                "status": "UNKNOWN",
                "message": "PIN code must be 6 digits starting with 1-9.",
                "provider": None,
            }

        if not self.is_provider_configured():
            # Provider is unconfigured: honest UNKNOWN status
            return {
                "status": "UNKNOWN",
                "message": "Courier serviceability unconfirmed. Provider integration not configured.",
                "provider": None,
            }

        # If a live provider is configured, invoke it with strict timeout
        try:
            import requests
            resp = requests.get(
                self.provider_url,
                params={"pincode": pin},
                headers={"Authorization": f"Bearer {self.provider_api_key}"},
                timeout=5,
            )
            if resp.status_code == 200:
                data = resp.json()
                is_serviceable = bool(data.get("serviceable") or data.get("is_serviceable"))
                if is_serviceable:
                    return {
                        "status": "SERVICEABLE",
                        "message": "Home delivery available to this PIN code.",
                        "provider": self.provider_name,
                    }
                else:
                    return {
                        "status": "UNSERVICEABLE",
                        "message": "Home delivery is currently not available to this PIN code.",
                        "provider": self.provider_name,
                    }
            else:
                return {
                    "status": "UNKNOWN",
                    "message": "Courier serviceability could not be confirmed.",
                    "provider": self.provider_name,
                }
        except Exception:
            return {
                "status": "UNKNOWN",
                "message": "Courier serviceability check timed out or failed.",
                "provider": self.provider_name,
            }


# Default shared adapter instance
pin_service = PinServiceAdapter()
