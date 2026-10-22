# MileageMate

A simple website to track fuel fills, mileage (km/L) and fuel spend for two-wheelers and four-wheelers. Plain HTML, CSS and JavaScript, hosted on GitHub Pages. No build step.

**Current status: Phase 1.** Everything works on one device and is saved in the browser (localStorage). Sign-in and cloud storage (Firebase) come in Phase 2.

## Folder structure

```
mileagemate/
├── index.html            App shell: top bar, navigation, dialog
├── css/styles.css        All styles (mobile first, light and dark)
├── assets/icon.svg       App icon
├── js/
│   ├── app.js            Starts the app; hash router (#/history, #/fuel/new …)
│   ├── store.js          Data layer (localStorage now, Firestore in Phase 2)
│   ├── demo-data.js      Clearly marked sample vehicles and fills
│   ├── format.js         ₹, km, litres, DD-MM-YYYY formatting
│   ├── ui.js             Shared UI helpers (dialog, toasts, odometer digits, form errors)
│   ├── charts.js         Small SVG bar chart, no library
│   ├── core/             Pure logic, no browser code, fully tested
│   │   ├── calc.js       Mileage, intervals, monthly totals, price/total maths
│   │   ├── validate.js   Vehicle and fuel entry checks
│   │   ├── dates.js      Local-date helpers
│   │   └── model.js      Vehicle types, fuel types and units
│   └── views/            One file per screen
│       ├── dashboard.js  Overview and per-vehicle dashboard
│       ├── vehicles.js   List, add, edit, delete vehicles
│       ├── fuel-form.js  Add and edit fuel entries
│       ├── history.js    Filters, totals, monthly chart, all fills
│       ├── settings.js   Sample data, delete all data
│       └── shared.js     Pieces used by several screens
├── tests/
│   ├── calc.test.js      Test cases for the calculations and validation
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

## Put it on GitHub Pages (short version)

1. In GitHub Desktop: *File → New repository*, name it `mileagemate`, choose this folder's parent, create. Or copy these files into a new repository folder.
2. Commit all files and click *Publish repository* (untick *Keep this code private* if you are on a free plan and want Pages).
3. On github.com open the repository → *Settings → Pages* → *Source: Deploy from a branch* → branch `main`, folder `/ (root)` → *Save*.
4. After a minute the site is at `https://<username>.github.io/mileagemate/`.

All links are relative and routing uses `#/…`, so the app works under that sub-path with no extra setup. Full deployment and Firebase steps come in Phase 2 and 3.

## How mileage is calculated

Mileage is measured from one full-tank fill to the next:

- distance = odometer at the later full tank − odometer at the earlier full tank
- fuel = every fill after the earlier full tank, up to and including the later one
- mileage = distance ÷ fuel

The fuel bought at the earlier full tank is not counted, because it replaced fuel used before that point. Average mileage is total distance ÷ total fuel across all valid stretches (not an average of averages). Stretches with an odometer reading that goes backwards are skipped and flagged.

## Data model

Stored locally now in the same shape planned for Firestore (`users/{uid}/vehicles/{vehicleId}/fuelEntries/{entryId}`):

- **vehicle:** nickname, type (`two` / `four`), make, model, registration, fuelType (`petrol`, `diesel`; `cng`, `electric` reserved), initialOdometer, createdAt, updatedAt
- **fuel entry:** vehicleId, date (`YYYY-MM-DD`), quantity, unit (`L`, later `kg` / `kWh`), pricePerUnit, totalAmount, station, odometer, fullTank, notes, calculated (which of quantity / price / total was worked out), createdAt, updatedAt
