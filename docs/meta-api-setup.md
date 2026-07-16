# Meta Marketing API — read-only token setup

Goal: a **long-lived, read-only** token to pull campaigns / ad sets / ads + **spend**
from your own ad account into Airtable (`Marketing - Ads`). Read-only (`ads_read`) to
your *own* account needs **no app review**. (Write scope for the parked offline-upload
comes later, separately.)

You'll end with two values, both stored **outside the repo**:
- the **token**
- the **ad account ID** (`act_XXXXXXXXXX`)

---

## Steps (all in the browser; ~10–15 min)

### 1. Create a Meta app
1. Go to **developers.facebook.com** → log in → **My Apps → Create App**.
2. Use case / type: **Business** (linked to your Business Manager). Name it e.g.
   `Framework Internal Tools`. Create.
3. In the app dashboard → **Add Product** → add **Marketing API**.
   (Note the **App ID** — you may not even need the App Secret for the system-user flow.)

### 2. Create a System User (this is what makes the token long-lived)
1. Go to **business.facebook.com/settings** (Business Settings).
2. Left sidebar → **Users → System Users → Add**.
3. Name it e.g. `framework-api`, role **Employee** (enough for read). Create.

### 3. Give the system user access to the ad account + app
Still in Business Settings, with the system user selected → **Add Assets**:
- **Ad Accounts** → select your ad account → grant at least **View performance**
  (read). (For the later offline-upload you'd raise this to Manage — not now.)
- **Apps** → select the app from step 1 → grant access.

### 4. Generate the token
1. System user → **Generate new token**.
2. Select your **app**.
3. **Token expiration: Never** (system-user tokens can be non-expiring).
4. Permissions/scopes: check **`ads_read`** only.
5. **Generate** → copy the token (shown once).

### 5. Find the ad account ID
Business Settings → **Accounts → Ad Accounts** → select yours → the ID reads
`act_XXXXXXXXXX` (or just the number — we prefix with `act_`).

### 6. Store both, outside the repo
```bash
echo 'PASTE_TOKEN_HERE'      > ~/.framework-meta-token   && chmod 600 ~/.framework-meta-token
echo 'act_XXXXXXXXXX'        > ~/.framework-meta-account
```
(Or a file under `/Users/ben/code/framework/` like the Airtable one — anywhere the repo
won't commit it.) Tell Claude the paths; the token is never echoed.

---

## Quick test (Claude runs this once you've stored it)
```
GET https://graph.facebook.com/v21.0/<act_ID>/campaigns?fields=name,status,effective_status&access_token=<TOKEN>
GET https://graph.facebook.com/v21.0/<act_ID>/insights?level=ad&fields=ad_id,ad_name,spend,impressions,clicks&date_preset=last_30d
```
If those return your campaigns and per-ad spend, we're done — Ads-sync can build on it.

## Notes
- **Read-only to your own account → no app review / business verification headaches.**
- Use the **latest stable Graph API version** shown in your app (e.g. `v21.0`+).
- If a token ever leaks, revoke it in System Users and regenerate.
- The **fast throwaway alternative** (Graph API Explorer → short-lived user token) works
  for a one-off test but expires in ~1–2 h — not for the recurring sync. Use the system
  user token above for the real thing.
