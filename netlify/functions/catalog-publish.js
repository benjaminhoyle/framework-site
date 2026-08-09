// POST /api/catalog-publish?key=<secret> — apply the staged catalog draft to the
// repo, in one commit, from the website. Netlify deploys on the push.
//
// This is what `framework-ops/catalog.command` does, minus the laptop. The work
// itself is scripts/lib/catalog-build.mjs, imported rather than reimplemented:
// the site a laptop publishes and the site this publishes have to be the same
// site, and two implementations would eventually disagree about what is in the
// catalogue.
//
// It writes data, not markup: catalog.json (editorial), data/catalog.json (what
// shelving.html fetches) and the Meta feed. See docs/catalog-architecture.md.
//
// Everything lands as a SINGLE commit via the git data API (blobs -> tree ->
// commit -> ref). One commit is one deploy; writing the files one at a time
// through the contents API would be one deploy per file, and the site would be
// briefly live with a catalogue that disagrees with its own feed.
//
// Requires, beyond the usual SITE_EXPORT_KEY:
//   GITHUB_TOKEN   fine-grained, Contents: read+write, this repo only
//   GITHUB_REPO    "owner/name"
//   GITHUB_BRANCH  optional, defaults to main
//
// Without those it answers 501 and says so, and catalog.command still works —
// that is the intended fallback, not a failure.

import { getStore } from '@netlify/blobs';
import { CONFIG_IMAGE_DIR, THUMB_DIR, buildPublish } from '../../scripts/lib/catalog-build.mjs';

// The manager uploads a 180px thumbnail beside each image, named like this
// because the staging store's keys cannot contain a slash.
const THUMB_PREFIX = 'thumb__';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

function github(env) {
  const token = env.GITHUB_TOKEN;
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || 'main';
  if (!token || !repo) return null;

  const call = async (path, init = {}) => {
    const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'framework-catalog-publish',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
    });
    if (!res.ok) throw new Error(`GitHub ${init.method || 'GET'} ${path} → ${res.status} ${(await res.text()).slice(0, 300)}`);
    return res.json();
  };

  return {
    repo,
    branch,
    /** A file's text at the branch tip. */
    async read(path) {
      const body = await call(`/contents/${encodeURI(path)}?ref=${encodeURIComponent(branch)}`);
      return Buffer.from(body.content, 'base64').toString('utf8');
    },
    /** Every path in the tree, so we can tell what an active product is missing. */
    async paths() {
      const head = await call(`/git/ref/heads/${encodeURIComponent(branch)}`);
      const commit = await call(`/git/commits/${head.object.sha}`);
      const tree = await call(`/git/trees/${commit.tree.sha}?recursive=1`);
      return { headSha: head.object.sha, treeSha: commit.tree.sha, files: new Set(tree.tree.map((t) => t.path)) };
    },
    /** One commit carrying every file. `files` is {path: {content, encoding}}. */
    async commit({ headSha, treeSha, files, message }) {
      const tree = [];
      for (const [path, file] of Object.entries(files)) {
        const blob = await call('/git/blobs', {
          method: 'POST',
          body: JSON.stringify({ content: file.content, encoding: file.encoding || 'utf-8' }),
        });
        tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
      }
      const next = await call('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: treeSha, tree }) });
      const made = await call('/git/commits', { method: 'POST', body: JSON.stringify({ message, tree: next.sha, parents: [headSha] }) });
      await call(`/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: JSON.stringify({ sha: made.sha }) });
      return made.sha;
    },
  };
}

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const key = new URL(req.url).searchParams.get('key');
  if (!process.env.SITE_EXPORT_KEY || key !== process.env.SITE_EXPORT_KEY) {
    return new Response('unauthorized', { status: 401 });
  }

  const gh = github(process.env);
  if (!gh) {
    return json({
      ok: false, error: 'not_configured',
      detail: 'Publishing from the website needs GITHUB_TOKEN and GITHUB_REPO in this site\'s environment. Until they are set, publish with catalog.command as before.',
    }, 501);
  }

  const url = new URL(req.url);
  const dry = url.searchParams.get('dry') === '1';
  // Who is publishing, for the commit message. git then keeps the audit trail
  // forever, which is the cheapest useful answer to "who changed this price".
  const publisher = String(url.searchParams.get('by') || '').trim().slice(0, 60)
    .replace(/[^\w .'-]/g, '');
  const catalogStore = getStore('catalog');
  const uploadStore = getStore('catalog-uploads');

  try {
    const draft = await catalogStore.get('draft', { type: 'json' });
    if (!draft || !Array.isArray(draft.products)) {
      return json({ ok: false, error: 'no_draft', detail: 'Nothing is staged — there is nothing to publish.' }, 409);
    }

    // What the repo holds now. shelving.html is no longer read or written --
    // the page fetches data/catalog.json, so publishing writes data, not markup.
    const [catalogText, tree] = await Promise.all([gh.read('catalog.json'), gh.paths()]);

    // The staged images, keyed by the repo path each one belongs at.
    const staged = {};
    for (const product of draft.products) {
      const { blobs } = await uploadStore.list({ prefix: `${product.id}/` });
      for (const blob of blobs) {
        const name = blob.key.slice(product.id.length + 1);
        const bytes = await uploadStore.get(blob.key, { type: 'arrayBuffer' });
        if (!bytes) continue;
        const path = name.startsWith(THUMB_PREFIX)
          ? `${THUMB_DIR}/${name.slice(THUMB_PREFIX.length)}`
          : `${CONFIG_IMAGE_DIR}/${name}`;
        staged[path] = { content: Buffer.from(bytes).toString('base64'), encoding: 'base64' };
      }
    }

    const built = buildPublish({ catalogText, products: draft.products });

    // An active product whose image is neither in the repo nor in this batch
    // would ship a broken card. The laptop version checks a disk; this checks
    // the tree plus what is about to be added to it.
    const missing = built.requiredAssets.filter((p) => !tree.files.has(p) && !staged[p]);
    if (missing.length) {
      return json({
        ok: false, error: 'missing_assets', missing,
        detail: 'These images are referenced by an active product but are not in the repo and were not uploaded. Re-upload the package, or turn the product off.',
      }, 422);
    }

    const files = { ...staged };
    for (const [path, text] of Object.entries(built.files)) files[path] = { content: text, encoding: 'utf-8' };

    const summary = {
      products: draft.products.length,
      active: built.active.length,
      inactive: built.inactive.length,
      images: Object.keys(staged).length,
      files: Object.keys(files).length,
    };
    if (dry) return json({ ok: true, dryRun: true, ...summary });

    const sha = await gh.commit({
      headSha: tree.headSha,
      treeSha: tree.treeSha,
      files,
      message: `Catalog publish: ${built.active.length} active, ${built.inactive.length} off`
        + (summary.images ? `, ${summary.images} image(s)` : '')
        + (publisher ? `\n\nPublished by ${publisher} from the catalogue manager.` : ''),
    });

    // Only once the commit is in: a cleared draft with no commit behind it
    // loses the staged work, which is far worse than publishing twice.
    await catalogStore.delete('draft').catch(() => {});
    for (const product of draft.products) {
      const { blobs } = await uploadStore.list({ prefix: `${product.id}/` });
      await Promise.all(blobs.map((b) => uploadStore.delete(b.key).catch(() => {})));
    }

    return json({ ok: true, commit: sha.slice(0, 7), branch: gh.branch, ...summary });
  } catch (error) {
    const message = String(error && error.message);
    // Someone else published between the dry run and the write. Never force:
    // their change is as real as this one. The draft is untouched.
    if (/\b(409|422)\b/.test(message) && /refs\/heads|fast forward|not a fast/i.test(message)) {
      return json({
        ok: false, error: 'conflict',
        detail: 'Someone else published while you were reviewing. Reload the page to pick up their changes, then publish again. Nothing of yours was lost.',
      }, 409);
    }
    return json({ ok: false, error: 'publish_failed', detail: message.slice(0, 600) }, 500);
  }
};

export const config = { path: '/api/catalog-publish' };
