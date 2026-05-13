# Beginner guide: hosting PMTiles on Cloudflare R2

This guide explains how to put a **PMTiles** file on **Cloudflare R2** so your map can load tiles from the internet. It assumes **local PMTiles already works** in your project and you want a **public test URL** first, without buying a domain yet.

**Architecture reminder (important):**

- The **database** remains the **source of truth** for real data and business rules.
- **Tiles** (including PMTiles) are **for rendering only**. They are not a substitute for the database.

---

## 1. What Cloudflare R2 is

**R2** is Cloudflare’s **object storage** service. Think of it like a folder in the cloud where you store files (here: `.pmtiles` archives). Your map app can **download** those files over HTTPS using normal web requests (including **byte range** requests, which PMTiles needs).

R2 is **S3-compatible**, so many tools that know how to talk to Amazon S3 can also talk to R2 with different endpoint URLs and credentials.

---

## 2. What is free and what can cost money

Exact pricing changes over time; always check [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/) for current numbers.

**Typical patterns:**

| Kind of thing | Often |
|---------------|--------|
| **Signing up** for Cloudflare | Usually free to create an account |
| **Storing** data in R2 | Billed by how much you store (not “unlimited free storage” at scale) |
| **Reading** data (downloads / egress to the internet) | R2 often has **no egress fee** to the internet when compared to some other object stores, but **operations** (API calls) and **storage** still matter |
| **Custom domain** on Cloudflare | May involve **domain registration** cost (when you buy a domain later) and normal DNS setup |

**Practical takeaway for a small test:** a single PMTiles file and light testing is usually inexpensive, but **monitor usage** in the Cloudflare dashboard as you grow traffic or add many large files.

---

## 3. Why you do not need a domain for the first test

For the **first test**, you only need a **public HTTPS URL** that browsers can reach.

Cloudflare can expose a bucket using a **Cloudflare-provided hostname** (commonly shown in the R2 UI when you enable public access, often related to **`.r2.dev`**). That is enough for:

- Verifying **upload**
- Verifying **HEAD** and **Range** behavior
- Pointing a **temporary** `VITE_…` / env URL at R2 while you iterate

Later, when you buy a domain, you can switch to something like `tiles.yourdomain.com` for a stable production hostname (see the end of this guide).

---

## 4. Manual steps in the Cloudflare dashboard

### 4.1 Create a Cloudflare account

1. Go to [https://dash.cloudflare.com/](https://dash.cloudflare.com/) and sign up or log in.

### 4.2 Create an R2 bucket

1. In the sidebar, open **R2 Object Storage**.
2. Click **Create bucket**.
3. Name the bucket exactly:

   **`coremap-tiles-prod`**

4. Choose a region / defaults you are comfortable with (defaults are fine for many teams starting out).
5. Create the bucket.

### 4.3 Enable public access (for testing)

You want the map (or `curl`) to read objects **without** private signed URLs for the first test.

1. Open the bucket **`coremap-tiles-prod`**.
2. Find **Settings** related to **public access** / **R2.dev subdomain** / **public bucket** (wording in the UI may change slightly over time).
3. Follow Cloudflare’s prompts to **allow public reads** for the bucket (read-only public access is what you want for static tiles).

**Security note:** public buckets are **world-readable** for objects you expose under that hostname. For production, many teams still use **custom domains**, **WAF rules**, and **separate buckets** for public vs private data.

### 4.4 Find the public URL

After public access is enabled, the dashboard usually shows a **public bucket URL** or **R2.dev** hostname.

Copy that base URL. Your object will be reachable at:

```text
<public-base-url>/basemaps/yangon/v2/basemap.pmtiles
```

Keep this URL somewhere safe; you will use it in env vars for the web app when you are ready (this doc does not change application code).

---

## 5. Terminal steps (Wrangler + upload + tests)

These steps run on your machine in a terminal.

### 5.1 Install Wrangler

Wrangler is Cloudflare’s CLI for R2 and Workers.

Using **npm** (global install is optional; `npx` also works):

```bash
npm install -g wrangler
```

Or run commands without a global install:

```bash
npx wrangler --version
```

### 5.2 Log in to Cloudflare

```bash
wrangler login
```

This opens a browser flow to authorize Wrangler for your Cloudflare account.

### 5.3 Upload your PMTiles file

Use the **versioned** object key (do not skip the `v2` folder in the path):

**Bucket:** `coremap-tiles-prod`  
**Object path:** `basemaps/yangon/v2/basemap.pmtiles`

Example (adjust the local file path to your built `.pmtiles` file):

```bash
wrangler r2 object put coremap-tiles-prod/basemaps/yangon/v2/basemap.pmtiles \
  --file ./path/to/your/basemap.pmtiles
```

After upload, you can confirm in the R2 UI under **Objects** for the bucket.

### 5.4 `curl` HEAD test

Replace `<PUBLIC_BASE_URL>` with the **exact** public base URL from the dashboard (no trailing slash required, but be consistent):

```bash
curl -I "<PUBLIC_BASE_URL>/basemaps/yangon/v2/basemap.pmtiles"
```

You want a successful response (for example **HTTP `200`** on GET-style checks; on **`HEAD`** you still want a **2xx** and useful headers like **`content-length`**). If you see **403** or **404**, public access or the object path is wrong.

### 5.5 `curl` Range test (important for PMTiles)

PMTiles relies on **HTTP Range** requests. Test that ranges work:

```bash
curl -I -H "Range: bytes=0-15" \
  "<PUBLIC_BASE_URL>/basemaps/yangon/v2/basemap.pmtiles"
```

You typically want to see **`206 Partial Content`** and headers related to ranges (for example **`content-range`**), not a server that ignores Range entirely.

---

## 6. PMTiles must be versioned (required)

**Version your tiles in the object path**, not only in your head.

Example pattern:

```text
basemaps/yangon/v2/basemap.pmtiles
basemaps/yangon/v3/basemap.pmtiles
```

When you publish a new basemap:

1. Upload to a **new** path (`v3`, `v4`, …).
2. Point your app’s tile URL / env var to the **new** path when you are ready to cut over.
3. Keep old versions for rollback and debugging until you explicitly delete them under your retention policy.

---

## 7. Warning: do not overwrite old PMTiles versions directly

**Do not “replace in place”** `basemaps/yangon/v2/basemap.pmtiles` while users might still be reading **`v2`**.

Overwriting a live object can cause:

- Mixed **old and new** bytes for clients mid-download
- Broken **caches** (CDNs, browsers) that still think they have the old object
- Hard-to-debug **map glitches** that only happen for some users

Instead, publish **`v3`** (or another new key), switch traffic, then retire **`v2`** later.

---

## 8. Later production: domain + `tiles.yourdomain.com` + env vars

When you are ready for production polish:

1. **Buy a domain** from a registrar you like (or buy through Cloudflare Registrar if you want everything in one place).
2. In Cloudflare, attach the domain to your account (nameservers / DNS as instructed).
3. Configure **`tiles.yourdomain.com`** as an **R2 custom domain** (or behind a Worker if your architecture later requires it—start simple if you can).
4. **Update environment variables** in your hosting provider (for example Vercel) so the web app loads PMTiles from:

   ```text
   https://tiles.yourdomain.com/basemaps/yangon/v2/basemap.pmtiles
   ```

   (Use the real version path you intend to serve.)

5. Re-check **CORS** for your real production web origins (see `infrastructure/cloud/r2/README.md` in this repo).

Until then, your **R2 public test URL** is enough to prove end-to-end hosting.

---

## Quick checklist

- [ ] Bucket created: **`coremap-tiles-prod`**
- [ ] Object uploaded to: **`basemaps/yangon/v2/basemap.pmtiles`**
- [ ] Public access enabled and **public URL** copied
- [ ] `curl -I` works
- [ ] `curl` with **`Range`** works (**`206`**)
- [ ] CORS configured for your dev / preview origins (see R2 README in repo)
- [ ] Next version uses **`v3/…`**, not an overwrite of **`v2/…`**
