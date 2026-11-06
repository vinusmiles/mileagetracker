# GaadiKhata

*(Formerly MileageMate. The repository is still `mileagetracker`; internal storage keys keep the old name so existing data keeps working.)*

A mobile-first website to track fuel fills, mileage (km/L) and fuel spend for two-wheelers and four-wheelers, with **Smart fuel entry**: photograph the fuel receipt and the odometer, and GaadiKhata reads the details for you to check and save.

Plain HTML, CSS and JavaScript (ES modules, no build step), hosted on GitHub Pages. Indian conventions throughout: ₹, km, litres, dates shown as 22-Oct-2026.

## Status (October 2026)

| Part | State |
|---|---|
| Phase 1: vehicles, fuel entries, dashboard, history, mileage engine | ✅ Live |
| Phase 2: Google sign-in, Cloud Firestore storage, security rules, import of device data | ✅ Live |
| Smart fuel entry Stage 1: photo capture, review screen, checks, duplicate warning | ✅ Live |
| Smart fuel entry Stage 2: real photo reading (Cloudflare Worker + Claude Haiku 5.5) | ✅ Live, first real receipt read correctly |
| Maintenance Stage 1: service history, manual entry, multi-page invoice scan, review/edit, pages kept in Firestore | ✅ Live (v0.6) |
| Maintenance Stage 2: real invoice reading (Worker 0.5.0, route `/extract-invoice`) | ✅ Built (v0.7), to verify on the Nexon invoice |
| v0.8: GaadiKhata name, Add service on vehicles, pump-display photos, example photos, no "Looks right" prompts, 22-Oct-2026 dates | ✅ Built |
| v0.9: CNG vehicles (kg, ₹/kg, km/kg), CNG dispenser photos, optional vehicle odometer, in-app photo viewer | ✅ Built |
| v1.0–1.1: redesign (hybrid look: white app bar, green month card; month-first dashboard, vehicle tiles, compact fill rows, collapsible filters, required ✱ marks, simpler service form) | ✅ Built |
| v1.2: **Scan** centre button; compact vehicle dropdown; service reminders (service-centre recommendation + GaadiKhata's generic intervals, kept separate) | ✅ Built |
| v1.3: Scan opens Add fuel (smart or manual); new scan-fuel icon; Instagram contact buttons with a rotating border | ✅ Built |
| v1.4: traffic challans (check online + records, scan a challan photo), monthly spend split by vehicle, scan defaults to the most-used vehicle, link preview, REMINDERS in the logo | ✅ Built |
| v1.5: camera-first **Scan** (opens the camera directly; bill read in the background; one sheet for vehicle + odometer), start-up splash instead of a UI flash | ✅ Built |
| v1.6: compact forms (fields side by side), vehicle dropdown in Scan for 3+ vehicles, pinch and 1×/2×/3× zoom in the scanner | ✅ Built |
| v1.7: no splash for returning signed-in users (and the sign-in library preloads), green section headings, smaller buttons, Upcoming service shown only within a month of being due | ✅ Built |
| v1.8: mobile-app layout. Home with spend card, vehicle chips and six icon tiles; tabs Home · Vehicles · Scan · Reports · More; app bar with back arrow, title and a reminders bell; new Reminders, Challans and More screens; two-tone icon set | ✅ Built |
| v1.9: one-tap scan. After the snap: **Save · Full tank** / **Save · Partial** (pinned); saves straight away when the reading is clean, with an Edit link in the confirmation; opens the review (Confirm pinned) only when something needs checking | ✅ Built |
| v2.0: **Install as an app (PWA)** (Install card on Home and in More, browser install prompt, manual steps per browser, hidden once installed, service worker `sw.js`); new capture button (camera with a fuel pump) and keyboard "Type it"; red Cancel on the scan sheet and review; back buttons; iPhone alignment fixes | ✅ Built |
| v2.1: Install button on the sign-in screen; on iPhone/iPad an arrow points at the Share button ("Tap Share, then Add to Home Screen") instead of a list of steps | ✅ Built |
| v2.2: **Pay with UPI app** on the Saved message (opens PhonePe, GPay or Paytm; no payee or payment details). Beta: open the site once with `?beta=1` to see it, `?beta=0` to hide it | ✅ Built, to check on a real phone |
| Maintenance analytics, production tests | To do |
| Phone (SMS OTP) sign-in | Built, switched off (needs Firebase Blaze plan) |
| Phase 3: deployment checklist | To do |
| Stage 4: more real-world photo tests (other companies, glare, faded receipts) | Ongoing |

## Live setup

| What | Where |
|---|---|
| Website | **https://gaadikhata.co.in** (custom domain, registered at GoDaddy; GitHub repo `vinusmiles/mileagetracker`, files at the repo root, `CNAME` file holds the domain). The old https://vinusmiles.github.io/mileagetracker/ address redirects to it |
| Firebase project | `mileagemate-1311` (Spark plan, free): Authentication (Google) and Firestore (`asia-south1`, Mumbai) |
| Authorised domains | `vinusmiles.github.io`, `gaadikhata.co.in`, `www.gaadikhata.co.in` |
| Photo reader | Cloudflare Worker `mileagemate-reader` at https://mileagemate-reader.vinusmiles.workers.dev (worker version 0.7.0) |
| Reader settings | Secret `ANTHROPIC_API_KEY`; text `FIREBASE_PROJECT_ID`, `ALLOWED_ORIGINS`, `DAILY_LIMIT` (30); KV binding `SCANS` → namespace `mileagemate-scans` |
| AI provider | Claude API (Claude Console, individual account, prepaid credit), key `mileagemate-reader-2`, no expiry, model `claude-haiku-5-5` |

The Firebase web config (`js/firebase-config.js`) and the reader address (`js/smart/config.js`) are public by design. The only secret is the Claude API key, and it lives **only** in the Worker's encrypted secret: never in this repository, chat or website files.

## How it fits together

```
Phone browser (GitHub Pages site)
  ├─ Firebase Auth ──── Google sign-in
  ├─ Cloud Firestore ── users/{uid}/vehicles/{id}/fuelEntries/{id} (rules: owner only)
  └─ Smart fuel entry
       photos resized to 1600 px, metadata stripped
       ──► Cloudflare Worker (checks website, Firebase sign-in token, 30 scans/user/day)
            ──► Claude API (reads the photos, returns fields only)
       ◄── fields ──► review screen ──► user confirms ──► Firestore
```

Photos are never stored: not on the phone, in Firestore, in the Worker or in its logs.

## Folder structure

```
mileagemate/
├── index.html            App shell: top bar, navigation, dialog
├── firestore.rules       Security rules to paste into Firebase
├── worker/
│   ├── worker.js         Cloudflare Worker: the secure photo reader (paste into Cloudflare)
│   └── README.md         Step-by-step reader setup
├── css/styles.css        All styles (mobile first, light and dark)
├── assets/icon.svg       App icon
├── js/
│   ├── app.js            Starts the app; hash router (#/history, #/fuel/new …)
│   ├── firebase-config.js  Your Firebase web settings (public, not secret)
│   ├── auth.js           Google and phone sign-in, sign-out, error messages
│   ├── sync.js           Copy this device's data into your account
│   ├── cloud/firebase.js Loads the Firebase SDK (pinned version) only when configured
│   ├── backends/         local.js (this device) and firestore.js (cloud)
│   ├── store.js          Data layer used by every screen; talks to a backend
│   ├── demo-data.js      Clearly marked sample vehicles and fills
│   ├── format.js         ₹, km, litres, DD-MM-YYYY formatting
│   ├── ui.js             Shared UI helpers (dialog, toasts, odometer digits, form errors)
│   ├── charts.js         Small SVG bar chart, no library
│   ├── smart/            Smart fuel entry
│   │   ├── config.js     readerUrl (the Worker address; empty = demo reader), size limits
│   │   ├── extractor.js  One entry point; providers are swappable
│   │   ├── providers/cloud.js  Real reader: sends photos + sign-in token to the Worker
│   │   ├── providers/mock.js   Labelled demo reader (does not read photos)
│   │   ├── schema.js     Cleans any provider's result; unreadable → null + review
│   │   ├── checks.js     Review checks (arithmetic, fuel type, odometer, dates)
│   │   ├── duplicates.js Possible-duplicate detection
│   │   └── images.js     File checks, resize to 1600 px, strips photo metadata
│   ├── smart/invoice-schema.js, invoice-extractor.js  Invoice reader result cleaning; reader choice
│   ├── core/             Pure logic, no browser code, fully tested (service.js: totals, reconciliation, duplicates, odometer timeline)
│   │   ├── calc.js       Mileage, intervals, monthly totals, price/total maths
│   │   ├── validate.js   Vehicle and fuel entry checks
│   │   ├── dates.js      Local-date helpers
│   │   └── model.js      Vehicle types, fuel types and units
│   └── views/            One file per screen
│       ├── dashboard.js  Overview and per-vehicle dashboard
│       ├── vehicles.js   List, add, edit, delete vehicles
│       ├── fuel-form.js  Add and edit fuel entries
│       ├── history.js    Filters, totals, monthly chart, all fills
│       ├── smart.js      Smart fuel entry: photos → review → save
│       ├── login.js      Sign-in screen
│       ├── maintenance.js  Service history, invoice scan, review/edit form, details
│       ├── settings.js   Sample data, delete all data
│       └── shared.js     Pieces used by several screens
├── tests/
│   ├── calc.test.js      Test cases for the calculations and validation
│   ├── smart.test.js     Test cases for photo-reading results, checks, duplicates
│   ├── store.test.js     Test cases for the data layer (saving, deleting, importing)
│   ├── harness.js        Tiny test runner (no install needed)
│   ├── run-node.js       Run tests with Node
│   └── index.html        Run tests in any browser
├── package.json          Only for `npm test`; the site does not need Node
└── .gitignore
```

## Run it on your computer

The app uses JavaScript modules, which browsers refuse to load from a double-clicked file (`file://`). Serve the folder instead:

- **VS Code:** install the *Live Server* extension, right-click `index.html`, choose *Open with Live Server*.
- **Python:** in this folder run `python -m http.server 8000`, then open http://localhost:8000/

## Run the tests

- In a browser: open `tests/` on your local server or on the live site (for example `https://<username>.github.io/mileagemate/tests/`).
- With Node 18 or newer: `npm test` (nothing to install).

## Publishing: what goes to GitHub and what stays local

The working folder `D:\Vinod data\Vinu apps\Mileage tracker` has everything. The public repository gets only the website:

- **Published:** `index.html`, `manifest.webmanifest`, `css/`, `js/`, `assets/` (logo `logo-full.webp`, icons in `assets/icons/`, example photos in `assets/samples/`), `CNAME`, `LICENSE`, `README.md`, `firestore.rules`, `.gitignore`.
- Keep your own photos and screenshots in `test-photos` (never published). PNG files elsewhere are published, because the browser icons are PNG.
- **Kept local only:** `worker/` (the photo reader and its AI instructions, deployed by pasting into Cloudflare), `tests/` (including the sample invoice fixture), `package.json`, `_archive`, `test-photos`.

Publish command:

```
robocopy "D:\Vinod data\Vinu apps\Mileage tracker" "D:\Vinod data\Vinu apps\mileagetracker-repo" /E /XD _archive test-photos .git worker tests /XF *.zip *.jpg *.jpeg package.json
```

## Updating the live site

1. On github.com, open the `mileagetracker` repository → **Add file → Upload files**, and drag in the changed files or folders, keeping the same folder structure.
2. Commit. GitHub Pages updates in about a minute. On the phone, close and reopen the tab if you still see the old version.
3. **Never upload an empty `js/firebase-config.js` or `js/smart/config.js`.** The site would fall back to "this device only" mode or the demo reader. Current zips already contain the live values.
4. When `worker/worker.js` changes, also paste it into Cloudflare (Workers & Pages → mileagemate-reader → Edit code → Deploy). GitHub does not deploy the Worker.

## Vehicle maintenance (service records)

Bottom bar → **Maintenance** (Settings moved to the ⚙️ in the top bar).

- **Service history** per vehicle: a timeline of services (date, odometer, centre, type, total, parts replaced), filters by year, service type and centre. Tap a record for all line items, the financial breakdown, total checks and the kept invoice pages; edit or delete from there.
- **Scan service invoice**: add up to 6 pages of one invoice (camera or upload several at once), reorder or remove them, then **Read invoice**. All pages are read together as one service visit. *Stage 1 uses a labelled demo reader; real reading arrives in Stage 2.*
- **Review**: every field editable; sections for vehicle, service details, odometer, parts replaced, labour and services (with an "optional service" tick), financial breakdown and the pages. Unsure values must be fixed or marked **Looks right**. Live checks: gross + adjustment = grand total, parts and labour lines against their totals (±₹1 rounding), odometer against the fuel/service timeline, possible duplicates (same invoice or job card number, or same date and total).
- **Add manually** for services without an invoice photo.
- **Invoice pages** are kept compressed (about 100–300 KB each) in `users/{uid}/vehicles/{vid}/serviceRecords/{id}/pages/{n}`, only when signed in. They show your name and address, and are visible only to your account. Deleting a record deletes its pages.
- Service records never count as fuel fills and never change mileage. Their odometer readings join the vehicle's odometer timeline for warnings.

**After uploading v0.6, publish the updated `firestore.rules`** (Firebase → Firestore Database → Rules → paste → Publish). Without it, saving a service record shows "The cloud refused this change".

## Install as an app (PWA)

- `manifest.webmanifest` (name, icons incl. a maskable 512 px icon, standalone display) and `sw.js` (service worker) make GaadiKhata installable. The service worker is **network first**: online you always get the latest files; saved copies are used only offline. It never touches other sites (sign-in, database, photo reader).
- Home shows an **Install GaadiKhata** card (also in More). Where the browser offers it (Android Chrome, Edge, Samsung Internet; desktop Chrome/Edge), the button opens the browser's own install confirmation. Elsewhere (iPhone Safari etc.) it shows short steps for that browser.
- After installing: a confirmation, and the install buttons disappear. They come back if the app is removed.
- **Updating:** when you change `sw.js`, bump `CACHE` (e.g. `gk-2.1`) so old saved copies are cleared.

## Service reminders

Two separate sources, never mixed:

- **Service-centre recommendation:** on the service review/entry form, "Did the service centre recommend when your next service is due?" (Yes / No / Not sure). With Yes: date and/or km, centre and notes. If the invoice prints it explicitly, the reader pre-fills it ("Read from the invoice"); it never works one out. Stored in `users/{uid}/vehicles/{vid}/recommendations/{id}`, linked to the service record. Editable later (Service details → Next service → Edit). When a new service is saved, the form asks whether it is the recommended service; Yes marks the old recommendation completed (it is kept, never deleted).
- **GaadiKhata suggestion (general guide):** routine service and engine-oil change, counted from the last service (oil: the last service with an engine-oil line). Defaults: two-wheeler 6 months or 6,000 km; four-wheeler 12 months or 15,000 km. Changeable per vehicle (Edit vehicle → Service reminder intervals), saved as `reminderSettings` on the vehicle.

**Due logic:** due when the date arrives **or** the odometer (latest reading from fuel fills and services) reaches the km, whichever comes first; "due soon" within 30 days or 500 km (two-wheeler) / 1,000 km (four-wheeler). The dashboard shows **one alert per vehicle** (the service-centre recommendation wins over the generic suggestion, so the same visit is never announced twice); the vehicle page and service history list both, labelled by source. Reminders are shown in the app; there are no phone notifications.

## Traffic challans

On each vehicle page: **Challans** (unpaid and paid totals, latest records) and **Check for new challans online**, which copies the registration number and opens the official portal (Telangana e-Challan for TS/TG numbers, Parivahan for others). The portals require the owner to fill in a captcha, so GaadiKhata never fetches challans automatically.

Add a challan by scanning a photo of the notice or an SMS/portal screenshot (Worker route `/extract-invoice` with `docType: "challan"`; names, phone numbers and licence numbers are never returned) or by typing it. Unpaid challans appear as a dashboard alert. Stored in `users/{uid}/vehicles/{vid}/challans/{id}`.

## Smart fuel entry: how photo reading works

1. **Scan** (centre button) opens the camera straight away: snap the bill or pump screen (or Upload / Type it). Reading starts in the background while you pay. Then one sheet: vehicle (most-used pre-selected) and odometer (type, photo, or skip) → Continue → review. Live camera needs camera permission; without it, the phone's camera app or Upload is used.
   Alternatively: Add fuel → **Smart fuel entry** → pick the vehicle → add the **fuel bill or pump reading** photo, the odometer photo, or both → **Read details**. Example photos are shown in the empty slots (`assets/samples/`, WebP so they pass the publish filter).
   **CNG vehicles** use kg, ₹/kg and km/kg throughout; CNG dispenser photos (TOTAL ₹, QTY kg, RATE ₹/kg) are read the same way, and the empty slot shows a CNG example for CNG vehicles.
   A **pump display** photo works too: the reader takes Amount, Volume and the Rate that matches them (dispensers often show two rates), and fills in today's date because the display shows none.
2. The Worker reads the photos with Claude and returns: date, litres, price per litre, total, fuel type, fuel company, station, odometer (ODO only) and dashboard range.
3. The review screen shows everything editable; you simply change anything that is wrong (no confirmation prompts). Checks flag litres × rate ≠ total, a fuel type that doesn't match the vehicle, an odometer lower than before or equal to the range, and possible duplicates.
4. "Full tank?" must be chosen by hand, because a receipt cannot show it. Nothing is saved until you tap **Confirm and save**.

Reader instructions handle known traps: Atot/Vtot running totals, "Printed on" times, day/month/year dates, phone camera watermarks, and ODO versus range versus clock on the dashboard. Time, receipt number and location are read but not shown or saved (by choice).

**Invoice model:** `claude-haiku-5-5` by default. If dense invoices are misread, add the Worker setting `MODEL_INVOICE` = `claude-sonnet-5-5` (more accurate, costs more per invoice); no code change needed.

**Cost:** pay-as-you-go from prepaid Claude credit (US$5 added). Estimated at under ₹0.10 per scan; check the real figure in the Claude Console → API keys → Cost column. The daily limit (30 scans per user) and the Console spend limit cap the spend.

**Reader errors and what they mean:**

| Message or log | Meaning | Fix |
|---|---|---|
| "Could not reach the photo reader" / log `OPTIONS … 403` | Worker does not allow the website | Check `ALLOWED_ORIGINS` = `https://vinusmiles.github.io`, then **Deploy** the Worker (variable changes only apply after deploy) |
| "provider 401" | Claude key wrong or deleted | Paste the current key into the `ANTHROPIC_API_KEY` secret, Deploy |
| "provider 403, permission_error" | Key not allowed (for example, the Worker still holds a deleted key) | Same as above; make sure the key in Cloudflare is the one listed in the Console |
| "today's 30 photo scans" | Daily limit reached | Wait until tomorrow (UTC), or raise `DAILY_LIMIT` |
| "The photo reader is not set up yet" | Secret, project id or `SCANS` binding missing | Re-check the Worker settings |

Opening the Worker address in a browser should show `{"error":"origin-not-allowed",…,"allowedCount":1,"version":"0.7.0"}`: that confirms the version and that the allowed-website setting is loaded.

## Phase 2 setup: Firebase (done; kept for reference)

Do these once in the Firebase console (https://console.firebase.google.com) with your Google account.

1. **Create a project.** Add project → any name (for example `mileagemate`). Google Analytics is not needed.
2. **Register the website.** Project overview → the `</>` (Web) icon → nickname `GaadiKhata` → Register (skip Firebase Hosting; GitHub Pages hosts the site). Copy `apiKey`, `authDomain`, `projectId` and `appId` from the config shown into `js/firebase-config.js`.
3. **Turn on Google sign-in.** Build → Authentication → Get started → Sign-in method → Google → Enable → choose your support email → Save.
4. **Allow your website address.** Authentication → Settings → Authorized domains → Add domain → `vinusmiles.github.io` (only the domain, no `https://` and no `/mileagetracker/`).
5. **Create the database.** Build → Firestore Database → Create database → **production mode** → location `asia-south1 (Mumbai)`. The location cannot be changed later.
6. **Publish the security rules.** Firestore Database → Rules → replace everything with the contents of `firestore.rules` → Publish.
7. **Deploy and test.** Commit and push. Open the site, sign in with Google. If this browser has data from before, tap **Copy to my account**.

No Firestore indexes are needed: the app only reads each user's own vehicles and each vehicle's entries.

### Check that users are isolated

Firestore Database → Rules → **Rules Playground**: choose *get*, path `users/someone-else/vehicles/x`, turn on *Authenticated* with a different UID → Run. It must say **denied**. Repeat with the same UID in the path and the auth UID: it must be allowed.

### Optional: mobile number + SMS OTP

Phone sign-in only works on the **Blaze (pay-as-you-go) plan with a billing account**, and every SMS is charged at a rate that depends on the country.

1. Upgrade the project to Blaze and **set a budget alert** (for example ₹200 a month) in Google Cloud Billing.
2. Authentication → Sign-in method → Phone → Enable.
3. While testing, add **test phone numbers** with fixed codes on the same screen; they never send a real SMS.
4. Authentication → Settings → **SMS region policy** → allow only India, so bots cannot run up charges on foreign numbers.
5. Set `phone: true` in `js/firebase-config.js`, commit and push.

Abuse protection already in the app: Firebase's invisible reCAPTCHA on every SMS request, Firebase's own rate limits ("too many attempts"), a 30-second wait before resending, and a check that the number is a 10-digit Indian mobile number.

### Sign-in options compared

- **Google:** free, no SMS cost, works everywhere. Recommended default.
- **Phone + SMS OTP:** familiar in India, but needs Blaze billing and costs per SMS.
- **Email:** Firebase has no email OTP code. It offers *email link* sign-in (you click a link in your inbox), which is free but clumsier on phones. Not built; can be added later.

### What is stored, and where

Each user's data lives only under `users/{uid}`. No passwords or OTP codes are stored by GaadiKhata. A copy of your data is kept in the browser (IndexedDB) so the app opens quickly and works with a weak signal; signing out clears it. Photos from Smart fuel entry are never uploaded or saved.

## How mileage is calculated

Mileage is measured from one full-tank fill to the next:

- distance = odometer at the later full tank − odometer at the earlier full tank
- fuel = every fill after the earlier full tank, up to and including the later one
- mileage = distance ÷ fuel

The fuel bought at the earlier full tank is not counted, because it replaced fuel used before that point. Average mileage is total distance ÷ total fuel across all valid stretches (not an average of averages). Stretches with an odometer reading that goes backwards are skipped and flagged.

## Data model

Stored in Firestore at `users/{uid}/vehicles/{vehicleId}/fuelEntries/{entryId}` (or in the browser in "this device only" mode, same shape):

- **vehicle:** nickname, type (`two` / `four`), make, model, registration, fuelType (`petrol`, `diesel`; `cng`, `electric` reserved), initialOdometer, createdAt, updatedAt
- **fuel entry:** vehicleId, date (`YYYY-MM-DD`), quantity, unit (`L`, later `kg` / `kWh`), pricePerUnit, totalAmount, station, odometer, fullTank, notes, calculated (which of quantity / price / total was worked out), createdAt, updatedAt

Optional fields saved by Smart fuel entry: time, fuelCompany, location, receiptNumber (text, can contain letters), dashboardRangeKm (reference only, never used as the odometer), source (`manual`, `smart`, `smart-demo`). Smart fuel entry currently saves fuelCompany, dashboardRangeKm and source; time, location and receiptNumber are kept for older entries only.
- **service record:** vehicleId, serviceDate (invoice date), jobCardDate, invoiceNumber, jobCardNumber, serviceCentre, serviceCentreLocation, serviceType (`free`, `paid`, `general`, `periodic`, `repair`, `breakdown`, `accident`, `other`), odometerKm, paymentMethod, warranty, vinLast4 (only the last 4 characters of the chassis), notes, items[] ({description, kind: part/labour/other, section: maintenance/optional, code, qty, unit, rate, discount, taxable, cgst, sgst, total}), financialSummary ({partsTaxable, partsTotal, labourTaxable, labourTotal, discounts, additionalCharges, taxableAmount, cgst, sgst, otherTax, grossAmount, adjustments, grandTotal}), pageCount, source, extractionMetadata, createdAt, updatedAt

Photos are never saved. They are resized in the browser, kept in memory while you review, and released when you save or cancel.

## Next steps

1. **Phase 3 checklist:** Rules Playground check, second-device sign-in test, Firebase public-facing name ("GaadiKhata" instead of `mileagemate-1311.firebaseapp.com` on the Google sign-in screen).
2. **Stage 4:** test Smart fuel entry on more receipts (Indian Oil, HP, Shell, faded or crumpled), daytime dashboards with glare, receipt-only and odometer-only scans; tune the reader's instructions where it misreads.
3. **Later ideas:** fuel-left estimate and refuel alert (from mileage and tank size), CSV export, CNG and electric vehicles, optional phone OTP sign-in (needs Blaze billing and an SMS region policy).

## Licence

© 2026 Vinod. All rights reserved. See `LICENSE`. The code is visible because websites send their code to browsers; that does not grant permission to reuse it.
