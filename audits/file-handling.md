# Pokefin Security Audit — File Handling / Upload Security

- **Scope:** CSV import of portfolio holdings, Python image fetch + upload to Supabase Storage, Supabase Storage usage, `next.config.ts` image `remotePatterns`.
- **Branch audited:** `claude/security-vulnerability-analysis-LT3JQ` (current `HEAD` = `961e8cd`).
- **Date:** 2026-05-21.
- **Method:** Static review of the actual code at HEAD. Earlier audits in `audits/*.md` read for context only; this report supersedes the file-handling subset of `comprehensive-security-report.md` M-11.

## Trust model (what an attacker controls)

1. **CSV import** — fully attacker-controlled. Any authenticated user uploads or pastes arbitrary text into `ImportHoldingsModal`. Parsing is 100% client-side (`processCollectrImport` runs in the browser), and the resulting rows are written to `portfolio_holdings` via the Supabase anon key with no server-side validation step.
2. **Python image pipeline** — `download_and_upload_image` is fed `image_url` values scraped by Selenium from TCGPlayer product pages (`get_price_and_image_from_url`, `main.py:329-428`). The scraper visits `products.url` rows. Whoever can write a `products` row (depends on RLS on `products`, which is *not* shipped in the repo — see "Unable to verify") controls both the page scraped and therefore the `image_url` string. The Python job runs with elevated Supabase credentials, so its outputs are trusted by the rest of the system.
3. **`next.config.ts` remotePatterns** — governs which hosts `next/image` will proxy/optimize.

---

## Findings

### F-1. Python image upload has no maximum size bound (memory-exhaustion / storage-abuse)

- **Severity:** Medium
- **CWE:** CWE-400 (Uncontrolled Resource Consumption); CWE-789 (Memory Allocation with Excessive Size Value)
- **Evidence:** `main.py:236-326`, function `download_and_upload_image`. `main.py:260` `response = requests.get(image_url, headers=headers, timeout=30)` downloads the **entire** body into memory via `response.content`. The only size guard is a *floor*: `main.py:264` `if len(response.content) < 1000:`. There is no `stream=True`, no `Content-Length` pre-check, no read cap, and no upper bound before the bytes are buffered (`main.py:272` `response.content`) and pushed to Supabase Storage (`main.py:270-278`).
- **Why it matters:** A scraped/poisoned `image_url` that points at a huge or chunked-infinite response forces the worker to buffer the whole payload in RAM (OOM-kill of the scraper job) and then upload it, burning Supabase Storage quota — `generate_skus.py:181` and `compare_prices.py:226` already show the app treats "storage quota exceeded" as a fatal `SystemExit`, so this is a viable denial-of-service on the whole pricing pipeline. This is exactly the unresolved item M-11 from `comprehensive-security-report.md:174-176`; it remains **unfixed** at HEAD.
- **Exploitability + PoC:** Requires control of a scraped image URL. Minimal PoC — host (or get TCGPlayer's CDN to 302 to) an endpoint that streams indefinitely:
  ```python
  # attacker endpoint
  def handler():
      def gen():
          while True:
              yield b"\x00" * 1_000_000   # never ends
      return Response(gen(), content_type="image/jpeg")
  ```
  `requests.get(...).content` will keep allocating until the process is OOM-killed. A 2 GB static file achieves the storage-quota variant.
- **Remediation (minimal drop-in):** Stream with a hard cap and reject before upload.
  ```python
  MAX_IMAGE_BYTES = 8 * 1024 * 1024  # 8 MiB

  response = requests.get(image_url, headers=headers, timeout=30, stream=True)
  response.raise_for_status()

  declared = response.headers.get("Content-Length")
  if declared is not None and int(declared) > MAX_IMAGE_BYTES:
      logger.warning(f"Image too large (declared {declared} bytes); skipping")
      return None

  chunks, total = [], 0
  for chunk in response.iter_content(chunk_size=65536):
      total += len(chunk)
      if total > MAX_IMAGE_BYTES:
          logger.warning("Image exceeded size cap during download; aborting")
          return None
      chunks.append(chunk)
  content = b"".join(chunks)
  if len(content) < 1000:
      logger.warning(f"Image too small, likely not valid: {len(content)} bytes")
      return None
  ```
  Use `content` (not `response.content`) for the rest of the function.
- **Defense in depth:** Run the scraper with a `ulimit`/cgroup memory cap; set a Supabase Storage object-size limit on the `product-images` bucket; alert on storage-quota approach instead of hard-failing.

---

### F-2. Python image upload performs no content/MIME/magic-number validation — content-type spoofing

- **Severity:** Medium
- **CWE:** CWE-434 (Unrestricted Upload of File with Dangerous Type); CWE-345 (Insufficient Verification of Data Authenticity)
- **Evidence:** `main.py:236-326`, `download_and_upload_image`.
  - File extension is derived purely from the **URL string**: `main.py:243` `file_extension = image_url.split('.')[-1].split('?')[0].lower()`. The whitelist at `main.py:244` (`['jpg','jpeg','png','webp']`) only constrains the *string*, not the bytes.
  - The Storage object's `content-type` is set from that same string: `main.py:274` `"content-type": f"image/{file_extension}"`.
  - The downloaded body (`response.content`) is **never inspected** — no magic-number / signature check, no `imghdr`/`Pillow` verification, no `response.headers["Content-Type"]` check. Any bytes with a URL that ends in `.png` are stored and served as `image/png`.
- **Why it matters:** The stored object's `content-type` is fully attacker-influenced and decoupled from the real bytes. An attacker who controls a scraped `image_url` can store, e.g., an HTML/SVG/JS payload under `products/<id>.png` served as `image/png`. The blast radius is limited because (a) `next.config.ts:21` sends `X-Content-Type-Options: nosniff` and (b) Supabase Storage serves from a separate `*.supabase.co` origin, not the app origin — so this is **not** a stored-XSS-on-pokefin.ca path. But it still allows the image bucket to be used as arbitrary attacker-controlled file hosting on a trusted domain, and a mismatched/garbage payload silently corrupts the product catalog's images. No magic-number verification (audit item 8) and no real MIME validation (item 7) are present.
- **Exploitability + PoC:** Requires control of a scraped `image_url`. PoC: serve arbitrary bytes from a URL path ending `.png`:
  ```
  https://attacker.example/payload.png   ->  body: <svg onload=alert(1)>...
  ```
  Result: `products/<product_id>.png` in the `product-images` bucket, served `content-type: image/png`, length > 1000 so the floor check passes.
- **Remediation (minimal drop-in):** Verify the bytes are a real image and derive the type from the bytes, not the URL. Add `Pillow` to `requirements.txt`, then:
  ```python
  import io
  from PIL import Image

  ALLOWED = {"JPEG": "jpeg", "PNG": "png", "WEBP": "webp"}
  try:
      with Image.open(io.BytesIO(content)) as im:
          im.verify()                       # raises on non-image / truncated
      fmt = Image.open(io.BytesIO(content)).format  # re-open after verify()
  except Exception:
      logger.warning("Downloaded bytes are not a valid image; skipping")
      return None
  if fmt not in ALLOWED:
      logger.warning(f"Unsupported image format {fmt}; skipping")
      return None
  file_extension = ALLOWED[fmt]
  ```
  Then build `filename` and `content-type` from this validated `file_extension`.
- **Defense in depth:** Also reject if `response.headers.get("Content-Type", "")` does not start with `image/`. Re-encode the image (`im.save(...)` to a fresh buffer) so only sanitized pixels are stored — strips embedded scripts/EXIF and neutralizes most image-parser exploits.

---

### F-3. Remote image URL is not validated — SSRF via the scraper's `requests.get`

- **Severity:** Medium
- **CWE:** CWE-918 (Server-Side Request Forgery)
- **Evidence:** `main.py:260` `requests.get(image_url, headers=headers, timeout=30)`. `image_url` arrives unvalidated from the Selenium scrape (`main.py:603` `tcg_image_url = scraped_data.get('image_url')`, populated at `main.py:404/408/413`). There is no allowlist on scheme or host before the fetch. Note `main.py:412` accepts *any* non-CDN `<img>` src merely because it contains the substrings `product`/`card`/`item` — so a poisoned product page can supply an arbitrary URL.
- **Why it matters:** The scraper process makes an outbound HTTP request to whatever URL the scraped page yields. If that worker runs in a cloud environment, an attacker who controls a scraped page can point `image_url` at internal addresses — `http://169.254.169.254/latest/meta-data/` (cloud metadata/credentials), `http://localhost:<port>` internal services, or RFC1918 hosts. `requests` follows redirects by default, so even a TCGPlayer-CDN-looking URL can 302 into internal space.
- **Exploitability + PoC:** Requires control of a scraped page (gated by whoever can insert/modify `products.url` — RLS-dependent, see "Unable to verify"). PoC product page `<img>` tag:
  ```html
  <img class="product-image" src="http://169.254.169.254/latest/meta-data/iam/security-credentials/">
  ```
  `download_and_upload_image` then GETs the metadata endpoint. (Body is < 1000 bytes or non-image so it is not stored, but the *request itself* is the SSRF, and timing/error differences leak internal reachability; a larger internal response would be uploaded and become readable via the public bucket URL.)
- **Remediation (minimal drop-in):** Validate scheme + host before fetching, and disable redirects (or re-validate each hop).
  ```python
  from urllib.parse import urlparse

  ALLOWED_IMAGE_HOSTS = (".tcgplayer.com", ".tcgplayer-cdn.com")

  def _is_allowed_image_url(u: str) -> bool:
      try:
          p = urlparse(u)
      except Exception:
          return False
      if p.scheme != "https" or not p.hostname:
          return False
      host = p.hostname.lower()
      return any(host == h.lstrip(".") or host.endswith(h) for h in ALLOWED_IMAGE_HOSTS)

  if not _is_allowed_image_url(image_url):
      logger.warning(f"Refusing to fetch non-allowlisted image URL: {image_url}")
      return None
  response = requests.get(image_url, headers=headers, timeout=30,
                          stream=True, allow_redirects=False)
  ```
- **Defense in depth:** Resolve the hostname and reject if it maps to a private/loopback/link-local range (block `169.254.0.0/16`, `127.0.0.0/8`, RFC1918, IPv6 ULA) before connecting; run the scraper egress through a proxy that denies internal CIDRs; drop the broad `product`/`card`/`item` substring acceptance at `main.py:412`.

---

### F-4. CSV import has no file-size cap, no row cap, and no file-type/content validation (client-side DoS + unbounded write amplification)

- **Severity:** Medium
- **CWE:** CWE-400 (Uncontrolled Resource Consumption); CWE-770 (Allocation of Resources Without Limits or Throttling); CWE-20 (Improper Input Validation)
- **Evidence:**
  - `ImportHoldingsModal.tsx:34-41` `handleFileSelect` — `const content = await file.text();` reads the entire selected file into a string with **no size check**. `file.size` is never inspected.
  - `ImportHoldingsModal.tsx:207-213` — `<input type="file" accept=".csv" ...>`. `accept=".csv"` is a UI hint only; it is not enforced and is trivially bypassed by choosing "All files" or by drag-drop. There is no MIME check (`file.type`) and no magic-number check.
  - `import.ts:115-150` `parseCollectrCSV` — `csvContent.split("\n")` over the whole string with **no upper bound on the number of rows**. Every well-formed row (>= 16 columns) becomes a `CollectrCSVRow`.
  - `import.ts:43-49` `handlePasteContent` path — the textarea (`ImportHoldingsModal.tsx:236-242`) has no `maxLength`, so the same unbounded content reaches the parser.
  - `import.ts:414-459` `importHoldings` iterates every selected match and issues one `addHolding` (one Supabase `INSERT`) per row in a sequential loop.
- **Why it matters:** A 200 MB "CSV" (or pasted blob) is fully buffered as a JS string and split per-line in the browser tab — large inputs freeze/crash the tab (client-side DoS; self-inflicted, but also a footgun if a malicious "Collectr export" is shared). More importantly, there is no row cap: a crafted file with hundreds of thousands of valid rows produces that many `INSERT`s against Supabase under the user's own anon-key quota — write amplification with no throttle. The audit's M-7 (`comprehensive-security-report.md:152`) flagged per-row value bounds; this finding adds that the *count* of rows is also unbounded.
- **Exploitability + PoC:** Any authenticated user. PoC — generate a large valid Collectr CSV:
  ```bash
  ( printf 'portfolio,category,set,product,num,rarity,var,grade,cond,cost,qty,mkt,override,watch,date,notes\n';
    for i in $(seq 1 500000); do
      printf 'Sealed Product,Pokemon,Base Set,Booster Box,,,,,,10,1,10,0,false,2024-01-01,x\n'; done
  ) > big.csv
  ```
  Uploading `big.csv` buffers ~25 MB+ as a string, builds 500k row objects, and (if matched/selected) attempts 500k inserts. A multi-hundred-MB file simply hangs the tab.
- **Remediation (minimal drop-in):** Cap file size before reading, and cap rows in the parser.
  ```ts
  // ImportHoldingsModal.tsx — handleFileSelect
  const MAX_CSV_BYTES = 2 * 1024 * 1024; // 2 MiB
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_CSV_BYTES) {
      setError("File too large. Collectr exports are well under 2 MB.");
      return;
    }
    const name = file.name.toLowerCase();
    if (!name.endsWith(".csv") && file.type && !/^text\/(csv|plain)$/.test(file.type)) {
      setError("Please select a .csv file.");
      return;
    }
    const content = await file.text();
    setCsvContent(content);
    await processCSV(content);
  };
  ```
  ```ts
  // import.ts — parseCollectrCSV
  const MAX_ROWS = 10_000;
  export function parseCollectrCSV(csvContent: string): CollectrCSVRow[] {
    if (csvContent.length > 4_000_000) {
      throw new Error("CSV content too large");
    }
    const lines = csvContent.split("\n").filter((l) => l.trim());
    if (lines.length < 2) return [];
    const dataLines = lines.slice(1, 1 + MAX_ROWS);
    // ...rest unchanged
  }
  ```
  Also add `maxLength={4_000_000}` to the paste textarea.
- **Defense in depth:** Enforce the per-row numeric bounds the DB migration already declares (`migrations/0003_integrity_constraints.sql:11-16`, `quantity BETWEEN 1 AND 100000`, `purchase_price_usd BETWEEN 0 AND 1000000`) on the client too so bad rows fail fast; batch the inserts and cap total imported rows server-side.

---

### F-5. CSV `notes` field is unbounded free text written to the DB with no length limit

- **Severity:** Low
- **CWE:** CWE-20 (Improper Input Validation); CWE-400 (Uncontrolled Resource Consumption)
- **Evidence:** `import.ts:439` `notes: match.csvRow.notes ? \`Imported from Collectr. ${match.csvRow.notes}\` : "Imported from Collectr"`. `csvRow.notes` is column 15 of the CSV (`import.ts:143`), entirely attacker-controlled. The destination column `portfolio_holdings.notes` is `text` (`schema.sql:22`) with **no length constraint** — `migrations/0003_integrity_constraints.sql` adds checks for `quantity`, `purchase_price_usd`, `purchase_date`, `username` but **none for `notes`** (verified: `grep -ic notes 0003... = 0`).
- **Why it matters:** A single CSV row can carry a multi-megabyte `notes` value that is persisted verbatim. Per-row this bloats the DB and any view that renders all holdings; combined with F-4's missing row cap it is a cheap storage-amplification vector. Not an injection risk for stored XSS (React escapes text by default), but unbounded persisted user input is a quota/availability concern.
- **Exploitability + PoC:** Authenticated user; CSV row with a 5 MB string in the `notes` column imports successfully.
- **Remediation (minimal drop-in):** Truncate on import.
  ```ts
  const MAX_NOTES = 500;
  const rawNotes = (match.csvRow.notes || "").slice(0, MAX_NOTES);
  notes: rawNotes ? `Imported from Collectr. ${rawNotes}` : "Imported from Collectr",
  ```
- **Defense in depth:** Add a DB check constraint, e.g. `ALTER TABLE portfolio_holdings ADD CONSTRAINT notes_len CHECK (char_length(notes) <= 1000);`.

---

### F-6. `next.config.ts` image `remotePatterns` use overly broad wildcard hostnames

- **Severity:** Low
- **CWE:** CWE-1327 (Binding to an Unrestricted IP Address) — analogous over-broad allowlist; CWE-942 (Permissive Cross-domain Policy) in spirit.
- **Evidence:** `next.config.ts:37-43`:
  ```ts
  remotePatterns: [
    { protocol: "https", hostname: "**.tcgplayer.com" },
    { protocol: "https", hostname: "tcgplayer.com" },
    { protocol: "https", hostname: "**.supabase.co" },
  ],
  ```
  No `pathname` is specified on any pattern, so the entire URL space of each host group is allowed.
- **Why it matters:** `**.supabase.co` trusts **every** Supabase project on the planet, not just this app's project, as a source the Next.js image optimizer will fetch and proxy. `**.tcgplayer.com` similarly trusts every TCGPlayer subdomain. The image optimizer becomes a same-origin (`pokefin.ca`) proxy for those hosts, which can be abused for cache poisoning of the optimizer or to make `pokefin.ca` appear to host third-party content. The matching CSP `img-src` at `next.config.ts:7` has the same `https://*.supabase.co` breadth, so the two are consistently — but consistently *too* — permissive.
- **Exploitability:** Low impact; primarily a hardening gap. An attacker who can get a `*.supabase.co` or `*.tcgplayer.com` URL into an `image_url` (see F-3 trust model) gets it proxied through `/_next/image` on the app origin.
- **Remediation (minimal drop-in):** Pin to the specific project ref and the actual CDN host, and constrain the path.
  ```ts
  remotePatterns: [
    { protocol: "https", hostname: "<project-ref>.supabase.co",
      pathname: "/storage/v1/object/public/product-images/**" },
    { protocol: "https", hostname: "tcgplayer-cdn.tcgplayer.com" },
  ],
  ```
  Replace `<project-ref>` with the real Supabase project ref. Tighten the CSP `img-src` to the same single host.
- **Defense in depth:** Set `images.minimumCacheTTL` and consider disabling the optimizer for remote images entirely if all product images are mirrored into your own bucket (which `download_and_upload_image` already does for the happy path).

---

### F-7. No anti-virus / malware scanning on any ingested file or downloaded image

- **Severity:** Low (in context)
- **CWE:** CWE-434 (Unrestricted Upload of File with Dangerous Type) — scanning control absent.
- **Evidence:** No AV integration anywhere — no ClamAV, no VirusTotal, no Supabase Storage scanning hook. The CSV path (`import.ts`) never leaves the browser as a file (only parsed text reaches the DB), and the image path (`main.py:270`) uploads raw downloaded bytes straight to Storage.
- **Why it matters:** Low for the CSV path because no file artifact is persisted — only parsed scalar fields. For the image path, malicious bytes *are* persisted as objects in `product-images` and served publicly; without scanning, the bucket can host malware reachable via a `*.supabase.co` URL. The practical risk is bounded by F-2's recommended re-encode (which neutralizes most payloads) but scanning is the named control for audit item 4.
- **Remediation:** If the `product-images` bucket ever serves user-influenced bytes, scan on upload — e.g., a Supabase Edge Function triggered on Storage `INSERT` that pipes the object through ClamAV, or submit the hash to VirusTotal before marking the product image live.
- **Defense in depth:** Implementing F-2 (image re-encode) is the higher-value control and largely substitutes for AV on this surface.

---

## Items that PASS / are not applicable

- **Direct execution prevention (item 6):** Pass. Uploaded objects land in Supabase Storage (`product-images` bucket), which is object storage served statically — there is no code execution path for stored objects. The CSV is never written to disk server-side; it is parsed in-browser. No `eval`/dynamic-require of uploaded content was found.
- **Storage location outside webroot (item 5):** Pass. Supabase Storage is a separate `*.supabase.co` origin, fully outside the Next.js app's webroot/`public/` directory. No uploaded artifact is written under `frontend/public/` or any served app path.
- **ZIP bomb protection (item 10):** Not Applicable. No archive (ZIP/GZIP/TAR) ingestion exists. Note `main.py:254` sends `Accept-Encoding: gzip, deflate, br`; `requests` transparently decompresses HTTP transfer encoding, so a *compressed-response bomb* is theoretically possible — but it collapses into the same uncapped-`response.content` buffer covered by **F-1**, and F-1's streaming cap (applied to decompressed bytes via `iter_content`) closes it. No standalone ZIP-bomb finding.
- **Image manipulation library vulnerabilities (item 9):** Not Applicable today — there is **no** image-processing library in use (`requirements.txt` has only `requests, selenium, webdriver-manager, supabase, beautifulsoup4`; no `Pillow`/`opencv`). The bytes are passed through untouched. If F-2's remediation adds `Pillow`, pin a current, CVE-free version and keep it patched (Pillow has a history of decoder CVEs), and prefer `Image.verify()` + re-encode.

---

## Summary

### Risk score: 4.5 / 10 (Medium)

The file-handling surface is small and structurally sound in the ways that matter most for upload security: nothing is written to the webroot, nothing uploaded is executable, and the CSV never becomes a server-side file artifact. The residual risk is concentrated in (a) the Python image pipeline lacking *every* form of size/content/URL validation, and (b) the CSV importer lacking size and row caps. None of these are Critical or High because the highest-impact escalation (stored XSS on the app origin) is blocked by `nosniff` + separate Storage origin, and the image-pipeline attacks are gated behind control of scraped content (RLS-dependent — see below). The score sits at 4.5 rather than lower because the M-11 finding from the prior comprehensive audit is confirmed **still unfixed**, and three independent Medium issues (F-1/F-2/F-3) all live in one ~90-line function.

### Top prioritized fixes

1. **F-1 — Add an upper size bound to `download_and_upload_image`** (`main.py:260-264`): stream with `iter_content` and abort past 8 MiB. Closes the OOM + storage-quota DoS. (M-11, still open.)
2. **F-2 — Verify downloaded bytes are a real image and derive type from the bytes**, not the URL string (`main.py:243-274`): `Pillow` `verify()` + format whitelist + re-encode. Closes content-type spoofing and most image-parser exploits.
3. **F-3 — Allowlist scheme + host and disable redirects before `requests.get`** (`main.py:260`): blocks SSRF into cloud-metadata / internal services.
4. **F-4 — Cap CSV file size and row count** (`ImportHoldingsModal.tsx:34-41`, `import.ts:115-150`): reject files > 2 MiB and slice to 10k rows; closes browser DoS + unbounded insert amplification.
5. **F-6 — Pin `remotePatterns`/CSP to the specific Supabase project ref and CDN host** (`next.config.ts:37-43`, `:7`): removes the "trust every Supabase/TCGPlayer host" gap.

### Checklist diff (10 items)

| # | Control | Status | Notes |
|---|---|---|---|
| 1 | File type validation (whitelist not blacklist) | **Fail** | CSV: `accept=".csv"` is a non-enforced UI hint, no `file.type`/content check (F-4). Image: whitelist exists at `main.py:244` but only checks the *URL string*, not bytes (F-2). |
| 2 | File size limits | **Fail** | CSV: none — `file.text()` reads any size (F-4). Image: floor only (`< 1000` bytes), no ceiling (F-1). |
| 3 | Filename sanitization | **Pass** | Image filename is server-generated as `products/<int product_id>.<ext>` (`main.py:247`) — `product_id` is a DB integer, `ext` is from a 4-value whitelist; no user-string path component, no traversal. CSV has no server-side filename. |
| 4 | Anti-virus scanning integration | **Fail** | None anywhere (F-7). Low impact for CSV (no artifact); relevant for the public image bucket. |
| 5 | Storage location (outside webroot) | **Pass** | Supabase Storage `product-images` bucket — separate `*.supabase.co` origin, not under `frontend/public/`. |
| 6 | Direct execution prevention | **Pass** | Object storage serves statically; CSV parsed in-browser; no `eval`/dynamic require of ingested content. |
| 7 | MIME type validation | **Fail** | Image `content-type` is set from the URL extension (`main.py:274`), not validated against bytes or `response` headers (F-2). CSV `file.type` never checked (F-4). |
| 8 | Magic number verification | **Fail** | No signature/magic-number check on the downloaded image bytes or the CSV (F-2). |
| 9 | Image manipulation library vulnerabilities | **N/A** | No image library in use today (`requirements.txt`). Becomes applicable if F-2's `Pillow` fix is adopted — pin & patch. |
| 10 | ZIP bomb protection | **N/A** | No archive ingestion. HTTP-level decompression bomb folds into F-1 and is closed by F-1's cap. |

### Unable to verify (static analysis limits)

- **RLS on `products` / `portfolio_holdings`.** F-2/F-3's exploitability depends on who can write a `products.url` (and thus control the scraped page) and who can write `portfolio_holdings`. `migrations/0001_enable_rls_and_policies.sql` exists but the *live* policy content was not inspectable from the repo; `comprehensive-security-report.md:27` already flags this same uncertainty. **What would prove it:** run the `pg_policies` audit query from `audits/HARDENING_FOLLOWUPS.md` §1 against production and confirm `products` is not writable by the `anon`/`authenticated` roles.
- **`product-images` bucket configuration.** No bucket DDL/policy is in the repo (`grep` of `migrations/*.sql` + `schema.sql` for `storage`/`bucket` returned nothing). Whether the bucket enforces an object-size limit, an allowed-MIME list, or upload RLS is **unverifiable from code**. **What would prove it:** inspect the bucket in the Supabase dashboard (Storage → `product-images` → settings) or query `storage.buckets` / `storage.objects` policies.
- **Scraper runtime environment.** F-3's SSRF impact (cloud-metadata reachability) depends on where `main.py` runs. **What would prove it:** confirm the deployment target and its egress network policy / IMDS version.
