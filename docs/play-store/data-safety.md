# Google Play Data Safety Declaration: Colorbenz School Store

This document maps the exact answers and declarations required for the **Google Play Console Data Safety Form** for Colorbenz School Store.

---

## 1. Overview & Summary Declarations

| Question | Answer | Notes |
| :--- | :--- | :--- |
| **Does your app collect or share any user data?** | **Yes** | Required for user authentication, delivery address, and order fulfillment. |
| **Is all user data encrypted in transit?** | **Yes** | All network communications use TLS 1.3 / HTTPS. Cleartext HTTP traffic is disabled. |
| **Do you provide a way for users to request that their data be deleted?** | **Yes** | In-app account deletion under Profile settings and email request to `privacy@colorbenz.com`. |
| **Is this app targeted at children under 13?** | **No** | Target audience is strictly parents, guardians, and adult school administrators. Complies with Google Play Families Policy. |

---

## 2. Data Types Collected & Purpose

### A. Personal Info
- **Name**: Collected for account creation and delivery dispatch.
- **Email Address**: Collected for account authentication, invoice delivery, and order status updates.
- **Phone Number**: Collected for OTP authentication and delivery carrier coordination.
- **Physical Address**: Collected for home or school delivery of uniform parcels.
- *Data Sharing*: Shared only with verified delivery partners strictly for logistics fulfillment. Never sold or shared for marketing.

### B. Financial Info
- **Payment Information**: Payment processing is handled end-to-end via Razorpay's PCI-DSS Level 1 compliant gateway. Colorbenz servers never collect, process, or store credit/debit card numbers or UPI PINs.

### C. Photos & Videos
- **Photos / Videos**: **NOT COLLECTED**.
- *Camera Permission Justification*: If the user chooses the optional camera-based sizing tool, camera frames are processed 100% locally on the device in volatile RAM by Google MediaPipe. No photos, videos, or image frames are ever saved to disk or transmitted to any remote server.

### D. Physical Attributes (Sizing & Uniforms)
- **Height, Weight & Approximate Shoulder Width**: Entered voluntarily by the parent to calculate uniform sizing advice.
- *Purpose*: App functionality (size matching). Stored securely with the student profile under parental control. Anonymized sizing statistics are retained for size chart calibration.
- *Sharing*: Never shared with any third parties.

### E. Device Identifiers & Push Tokens
- **FCM Push Notification Token**: Collected upon user permission to deliver order lifecycle updates (Dispatched, Out for Delivery, Delivered) and post-delivery fit feedback reminders.
- *Sharing*: Sent to Google Firebase Cloud Messaging strictly for push delivery.

### F. App Performance & Diagnostics
- **Crash Data & Diagnostic Logs**: Ephemeral app state and error logs collected to diagnose crashes and maintain application performance.

---

## 3. Security & Retention Practices

1. **Encryption in Transit**: All endpoints enforce HTTPS with TLS 1.3. Android Network Security Configuration disallows cleartext traffic (`usesCleartextTraffic="false"`).
2. **Data Minimization**: Passwords hashed using Argon2/PBKDF2. Payment cards never touch backend infrastructure.
3. **Retention & Deletion**:
   - Inactive accounts and associated student profiles can be deleted upon request within 30 days.
   - Anonymized sizing records strip all personal identifiers (student name, parent name, order ID, school affiliation) to comply with data protection regulations.
