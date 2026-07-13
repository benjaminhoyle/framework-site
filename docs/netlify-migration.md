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

### 4. Add the custom domain in Netlify
Netlify → Site → **Domain management → Add a domain** → `framework.co.ke`.
- Set **`www.framework.co.ke` as the primary domain** (matches today's canonical —
  the apex currently 301-redirects to www).
- Netlify will auto-redirect the apex → www.
- Netlify shows the DNS target(s) it wants (a `*.netlify.app` CNAME for www, and an
  apex A/ALIAS or Netlify load-balancer IP). Note them for step 5.

### 5. DNS cutover at Cloudflare — the careful part (this is what fixes the TLS mess)
The old cert got stuck because Cloudflare's proxy (orange cloud) blocked Let's Encrypt
validation. So we provision the cert with the proxy **off**, then optionally turn it
back on.

In Cloudflare → DNS, replace the GitHub Pages records with Netlify's:
- `www` → **CNAME** → `<yoursite>.netlify.app` — set to **DNS only (grey cloud)**.
- `framework.co.ke` (apex) → **CNAME** → `<yoursite>.netlify.app` (Cloudflare flattens
  the apex automatically) **or** the apex IP Netlify gave you — **DNS only (grey cloud)**.
- Remove the old GitHub Pages A/AAAA/CNAME records.

Then Netlify → Domain management → **HTTPS → Verify DNS / Provision certificate**.
With grey cloud, validation succeeds and the Let's Encrypt cert issues in minutes.
- [ ] `https://www.framework.co.ke` serves the Netlify site with a valid cert
- [ ] `https://framework.co.ke` redirects to www

### 6. (Optional) Re-enable Cloudflare proxy
Only **after** the cert is issued. If you re-enable the orange cloud, set Cloudflare
**SSL/TLS → Overview → Full (strict)** (both ends now have valid certs, so no loop).
- **Recommendation:** if you don't specifically need Cloudflare's proxy features (WAF,
  caching, proxy-based Web Analytics), **leave it grey** — Netlify has its own CDN, and
  grey cloud avoids future cert headaches. See "Decisions" below.

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
