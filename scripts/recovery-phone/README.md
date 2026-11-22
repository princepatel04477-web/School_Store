# Phone-size payment recovery run (local only)

Runs the parent and staff recovery flows in a Pixel 7 Playwright profile against a local
Django server whose Razorpay calls are replaced by a scripted fake (`simserver.py`).
Razorpay's `checkout.js` is stubbed and every request to a non-local host is blocked and
reported. Nothing here talks to Razorpay, the live Workers or the store server.

1. Start Django with the fake gateway (throwaway `backend/dev_db.sqlite3`):

   ```powershell
   $env:USE_SQLITE='1'; $env:OTP_THROTTLE_RATE='100/min'; $env:SIM_BACKEND="$PWD\backend"
   $env:RAZORPAY_KEY_ID='rzp_test_localsim'; $env:RAZORPAY_KEY_SECRET='localsim_secret'; $env:RAZORPAY_WEBHOOK_SECRET='localsim_webhook'
   python scripts\recovery-phone\simserver.py
   ```

2. Start Vite pointed at it. Without `VITE_API_PROXY_TARGET` the dev proxy goes to the live Worker.

   ```powershell
   $env:VITE_API_PROXY_TARGET='http://127.0.0.1:8000'; npx vite --port 5173 --strictPort
   ```

3. Run `scripts\recovery-phone\reset-and-run.ps1`. It empties the local database, seeds
   one school, parent, child and two SKUs, and runs cases A to F. Screenshots go to
   `recovery-evidence/review/`. Set `CHROME_EXE` if your Playwright browser build differs.

`seed.json`, `state.json` and screenshots written next to these scripts are local output.
