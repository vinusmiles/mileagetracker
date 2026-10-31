# MileageMate photo reader (Cloudflare Worker)

`worker.js` is the secure backend for Smart fuel entry. It checks the user's Firebase sign-in, applies a daily scan limit, sends the photos to Claude (Anthropic API) with a secret key, and returns only the extracted fields. Photos are never stored or logged.

Console labels change from time to time; if a name below differs slightly, look for the closest match.

## 1. Claude API key

1. Go to https://platform.claude.com (Claude Console) and sign up or sign in.
2. **Billing:** add a small prepaid credit, and set a monthly **spend limit** so costs can never surprise you.
3. **API keys → Create key**, name it `mileagemate-reader`, and copy it. It is shown only once.
   Do not paste it into chat, GitHub or any website file.

## 2. Cloudflare Worker

1. Go to https://dash.cloudflare.com, then **Workers & Pages → Create → Worker** (start from "Hello World").
2. Name it `mileagemate-reader`, then **Deploy**.
3. **Edit code:** delete everything, paste all of `worker.js`, then **Deploy**.

## 3. Daily-limit storage (KV)

1. **Storage & Databases → KV → Create namespace**, named `mileagemate-scans`.
2. Open the Worker: **Settings → Bindings → Add → KV namespace**. Set the variable name to `SCANS` and the namespace to `mileagemate-scans`, then save.

## 4. Settings

In the Worker, go to **Settings → Variables and Secrets** and add these:

| Name | Type | Value |
|---|---|---|
| `ANTHROPIC_API_KEY` | **Secret** | the key from step 1 |
| `FIREBASE_PROJECT_ID` | Text | `mileagemate-1311` |
| `ALLOWED_ORIGINS` | Text | `https://vinusmiles.github.io` |
| `DAILY_LIMIT` | Text | `30` (scans per user per day) |

Optionally, add `MODEL` (fuel receipts) and `MODEL_INVOICE` (service invoices), both defaulting to `claude-haiku-5-5`. Use `claude-sonnet-5-5` for `MODEL_INVOICE` if dense invoices are misread.

## 5. Connect the website

Copy the Worker's address, for example `https://mileagemate-reader.<your-subdomain>.workers.dev`. Then on GitHub:

1. Edit `js/smart/config.js` and set `readerUrl: 'https://mileagemate-reader.<your-subdomain>.workers.dev'`.
2. Commit.

Smart fuel entry now reads photos for signed-in users. While `readerUrl` is empty, the labelled demo reader is used.

## Test

Open the Worker address in a browser. It should say `{"error":"origin-not-allowed"}`, which means it is protected.

Then, on the website, run Smart fuel entry with your receipt and dashboard photos. Expected values:
- **Receipt:** 18-10-2026, 20.00 L, ₹116.64/L, ₹2,332.80, Petrol.
- **Dashboard:** odometer 18,885 km, range 413 km.
