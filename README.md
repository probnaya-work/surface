PROBNAYA

Independent Computational Laboratory

# PROBNAYA

The public website of PROBNAYA, an independent computational laboratory.

The site presents the laboratory, its instruments, and its investigations. It is
a static multi-page website. Live canvas apparatuses render computational
processes through measured, frame-rate-independent simulations.

## Run locally

No installation or build step is required.

```sh
python3 -m http.server 4173
```

Open `http://localhost:4173`.

## Structure

- `index.html` and the other root HTML files define individual pages.
- `css/style.css` contains the shared visual system and responsive layout.
- `js/apparatus.js` runs the canvas simulations.
- `js/records.js` contains investigation records.
- `js/site.js` contains shared page behavior.
- `api/intake.js` accepts investigation enquiries.
- `api/machine-portrait.js` creates and directly verifies hosted Stripe Checkout Sessions for Machine Portrait issuance.

## Machine Portrait payment configuration

The Machine Portrait apparatus requires four server-side environment variables:

- `STRIPE_SECRET_KEY` — a Stripe secret key; never expose it to browser code.
- `STRIPE_PRICE_ID` — the fixed one-time EUR 5.00 Price used for issuance.
- `STRIPE_LIVEMODE` — `true` for live Stripe resources, `false` for test resources.
- `MPA_PUBLIC_URL` — the absolute `/instrument-mpa/` URL Stripe returns to.

The configured Price must be EUR 5.00. The API validates the resulting Checkout
Session's amount, currency, line item, payment state, and live/test mode before it
authorises construction. V1 intentionally has no webhook or server-side recovery
store: a paid return without its retained local draft requires manual support.

Run all serverless function tests with:

```sh
node --test api/intake.test.js api/machine-portrait.test.js
```
