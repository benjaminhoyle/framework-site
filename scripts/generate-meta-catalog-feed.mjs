#!/usr/bin/env node
/**
 * Generate the public Meta catalog CSV feed.
 *
 *   node scripts/generate-meta-catalog-feed.mjs
 *
 * Options:
 *   --input PATH      Published catalogue. Defaults to data/catalog.json.
 *   --output PATH     CSV output path. Defaults to feeds/meta-shelving-catalog.csv.
 *   --base-url URL    Site base URL. Defaults to https://www.framework.co.ke/.
 *
 * The rows themselves are built by scripts/lib/catalog-build.mjs, which
 * netlify/functions/catalog-publish.js also uses — the feed Meta fetches and
 * the feed a laptop writes have to be the same feed. It reads the published
 * artifact rather than the editorial catalog.json, so what is advertised is
 * exactly what the site is showing.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BASE_URL, FEED, PUBLIC_CATALOG, feedCsv, readPublicCatalog,
} from './lib/catalog-build.mjs';

function parseArgs(argv) {
  const args = { input: PUBLIC_CATALOG, output: FEED, baseUrl: DEFAULT_BASE_URL };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const take = (name) => {
      if (arg === `--${name}`) { args[({ input: 'input', output: 'output', 'base-url': 'baseUrl' })[name]] = argv[i + 1]; i += 1; return true; }
      if (arg.startsWith(`--${name}=`)) { args[({ input: 'input', output: 'output', 'base-url': 'baseUrl' })[name]] = arg.slice(name.length + 3); return true; }
      return false;
    };
    if (arg === '--help' || arg === '-h') {
      console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].split('/**')[1]);
      process.exit(0);
    } else if (!take('input') && !take('output') && !take('base-url')) {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const configurations = readPublicCatalog(fs.readFileSync(args.input, 'utf8'), args.input);
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, feedCsv(configurations, args.baseUrl), 'utf8');
  console.log(JSON.stringify({ output: args.output, products: configurations.length }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
