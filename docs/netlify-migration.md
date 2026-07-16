# Phase 0 — Netlify Migration Runbook

Step-by-step for the GitHub Pages → Netlify move. Claude prepared the repo config
(`netlify.toml`, `404.html`); the rest is dashboard work only you can do (I can't
touch Netlify/Cloudflare).

## Principles
- **Zero downtime.** The live site stays on GitHub Pages until Netlify is verified;
  we only cut DNS at the end.
- **Keep GitHub Pages as a fallback** for 24–48h after cutover. Don't decommission early.
- **Rollback is instant:** if anything breaks during DNS cutover, revert the Cloudflare
  DNS records to their old GitHub Pages values. GH Pages is still live.

## What's already in the repo (committed, ready to push)
- `netlify.toml` — publish from root, no build; preserves clean URLs (`/designer`,
  `/shelving`, `/simplified-designer`); blocks `/docs/*` and `/scripts/*` from public.
- `404.html` — branded not-found page (also becomes GH Pages' 404 — harmless upgrade).

---

## Steps

### 1. Push the migration config to `main`
These two files are inert on the current live site (Netlify ignores nothing; GitHub
Pages ignores `netlify.toml` and just gains a nicer 404). Safe to push now.
> Claude can push on your go, or you push. Nothing changes for visitors yet.

### 2. Create the Netlify site
Netlify → **Add new site → Import an existing project → GitHub** →
`benjaminhoyle/framework-site`.
- Branch to deploy: **main**
- Build command: **(leave empty)**
- Publish directory: **`.`** (root) — should auto-fill from `netlify.toml`
- Deploy.

### 3. Test on the `*.netlify.app` URL (live domain still untouched)
Open the temporary `https://<yoursite>.netlify.app` and check:
- [ ] `/shelving.html` loads; catalog + lightbox work; product images load
- [ ] Clean URLs work: `/designer`, `/shelving`, `/simplified-designer`
- [ ] WhatsApp buttons open a **pre-filled** message (FAB + lightbox order/customize)
- [ ] Designer (`/designer`) renders (in-browser Babel compiles)
- [ ] A made-up path (e.g. `/nope`) shows the 404 page
- [ ] `/docs/strategy.md` returns **404** (internal docs blocked)
- [ ] `/scripts/test-whatsapp-links.js` returns **404**

If all good, proceed. If not, fix in repo and redeploy — still no visitor impact.

### 4. Add the custom domains in Netlify  (site = `framework-nairobi`)
Netlify → site **framework-nairobi** → **Domain management → Domains → Add a domain**.
- Add **`www.framework.co.ke`**. When asked about DNS, choose **external DNS** — do NOT
  switch nameservers to Netlify (DNS stays at Cloudflare).
- Add **`framework.co.ke`** (apex) as well.
- On `www.framework.co.ke` → **⋯ → Set as primary domain**. Netlify then auto-redirects
  the apex → www (matching today's canonical).
- DNS target Netlify wants: **`framework-nairobi.netlify.app`**.

### 5. DNS cutover at Cloudflare — the careful part (this fixes the TLS mess)
The old cert got stuck because Cloudflare's proxy (orange cloud) blocked Let's Encrypt
validation. So we point at Netlify with the proxy **off (grey cloud)**, provision the
cert, then optionally turn the proxy back on.

Cloudflare → your domain → **DNS → Records**. Today both records are **proxied A records**
(apex: `104.21.31.123`, `172.67.176.130` + AAAA; `www`: same). Replace them:

**apex (`framework.co.ke`):**
- Delete the apex **A** records (`104.21.31.123`, `172.67.176.130`) and any **AAAA**.
- Add: **CNAME**, Name `@`, Target `framework-nairobi.netlify.app`,
  **Proxy status: DNS only (grey cloud)**. (Cloudflare flattens the apex CNAME.)

**www:**
- Delete the `www` **A/AAAA** records.
- Add: **CNAME**, Name `www`, Target `framework-nairobi.netlify.app`,
  **Proxy status: DNS only (grey cloud)**.

(Grey cloud = click the orange cloud icon so it turns grey. Cloudflare DNS is
near-instant, so this propagates — and rolls back — fast.)

Then Netlify → Domain management → **HTTPS → Verify DNS configuration → Provision
certificate**. Grey cloud lets validation succeed; the cert (covering apex + www)
issues in a few minutes. Then enable **Force HTTPS**.
- [ ] `https://www.framework.co.ke` serves the Netlify site with a valid cert
- [ ] `https://framework.co.ke` redirects to www

**Rollback (any time):** re-add the old proxied A records above (or just re-point at the
GitHub Pages setup). GH Pages is untouched, so DNS revert restores instantly.

### 6. (Optional) Re-enable Cloudflare proxy
Only **after** the cert is issued. If you re-enable the orange cloud, set Cloudflare
**SSL/TLS → Overview → Full (strict)** (both ends now have valid certs, so no loop).
- **Recommendation:** leave it **grey** unless you specifically need Cloudflare's proxy
  features (WAF, caching, proxy-based Web Analytics). Netlify has its own CDN, and grey
  avoids future cert headaches. Note: grey cloud disables Cloudflare page/redirect rules,
  but Netlify already handles the apex→www redirect, so that's fine.

### 7. Full verification on the live domain
- [ ] All key pages load over HTTPS; HTTPS enforced (http → https)
- [ ] Clean URLs, WhatsApp pre-fill, designer all work
- [ ] Pixel/GA/Clarity still fire (check Meta Events Manager "Test events" + Clarity live)

### 8. Decommission GitHub Pages (after 24–48h clean on Netlify)
GitHub repo → **Settings → Pages → Source: None**. Leave the `CNAME` file (harmless) or
remove later. Don't rush — this is the fallback.

### 9. Confirm auto-deploy
Netlify auto-deploys on push to `main` by default. Make a trivial commit and confirm it
deploys. From here, `git push` = live.

---

## Decisions for you (flag in this doc when made)
- **Cloudflare proxy after migration: on or off?** Off/grey = simpler, no cert
  headaches, Netlify CDN serves. On/orange = keep CF features but requires Full (strict)
  and re-provisioning care. *Leaning: off, unless you rely on CF proxy features.*
- **Cloudflare Web Analytics:** the PDF export you shared is CF Web Analytics. If you go
  grey-cloud, the proxy-based version stops; the JS-beacon version still works (and you
  have GA4 + Clarity regardless). Decide if you care.

## Known non-issue
- `kiosk.html` calls a local `/api/images` endpoint — it's an internal dev tool, not
  public, and will 404 on Netlify. Ignore (or delete later).
