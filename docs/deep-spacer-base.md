# Spacer bases — getting them live

> What this is: the record of adding the spacer bases to the range, and of
> everything a module has to exist in. Deep came first (2026-09-20) and its
> record below is the full map; the other five followed (2026-10-15) and the
> next section is what was different about doing them as a family.
> When to read it: when adding a module, or when something about one of these
> looks wrong.

## The other five, 2026-10-15

Slim, Standard, Wide, Compact and Broad. **Corner has none**: it has no spacer,
so there is no U for its base to borrow.

**One rule, every family.** Drop the boards, keep the spine bars, and at each
level keep only the *rearmost* cross rail, moved back so its back face lands on
the back post centreline (257 on the standard-depth families, 427 on the deep
ones). It moves 118.5mm in every family. Slim, Standard and Wide carry one rail
per level, so their spacer base is exactly the trimmed base with the boards off
and the rail moved: the same steel, not less. Compact and Broad lose their
front rail, as Deep did. Run on deep, the rule reproduces `deep_spacer_base`
member for member.

| module | price | Zoho item | Airtable product | Materials Cost (Blue) |
|---|---|---|---|---|
| Slim Spacer Base | 4,500 | 4099765000004718001 | recuLKG161bdTvyEJ | 1,137 |
| Standard Spacer Base | 5,000 | 4099765000004720001 | recQOYTNXX8HL8pM6 | 1,246 |
| Wide Spacer Base | 5,500 | 4099765000004721001 | recCxBjbTLgF8VKQy | 1,427 |
| Compact Spacer Base | 6,500 | 4099765000004720010 | recLn6Cw9LF0aon06 | 1,392 |
| Broad Spacer Base | 8,000 | 4099765000004722001 | reckFcAdkq9n50t4m | 1,500 |

Prices are Ben's (proposed from three anchors: his deep ratio, the price drop
per shilling of material removed, and keeping Slim < Standard < Wide and
Compact < Broad < Deep). Each Zoho item copies Deep Spacer Base's settings
field for field and reads `pushed` for eTIMS. Each Airtable product has the
same 17 bill-of-materials rows as Deep Spacer Base, every one tagged
`spacer bases 2026-10-15` in its Note so the batch can be found and reversed.
`Baked Scaled Unit Value` is baked on all five.

**Descriptions give the real footprint**, as Deep Spacer Base's does: "Starts a
run of standard units at desk height. 430mm tall, 720mm wide, 280mm deep. No
shelf surface." The older spacers quote the run's width instead (Standard
Spacer says 780). Compact's carries its siblings' line about bookends and
display bars.

**Slim Spacer and Broad Spacer are now sold on /builder.** Both were active in
Zoho and Airtable and each had sold once, but the site had no price for them,
so /builder showed "on request". They are in `data/module-prices.json` now and
offered in Flexible and Advanced. Broad Spacer was 7,000, more than the Deep
Spacer it is 440mm narrower than; Ben set it to **5,500** in all three places.
Slim Spacer stays 4,000.

**What was different this time:**

- **Both scripts are general.** `source/pending-modules/add-spacer-bases.py`
  and `add-spacer-bases-to-dae.py` (renamed from the deep-only pair) take any
  family and skip one already present.
- **Advanced-only is a rule, not a list.** `advancedOnly()` in
  `js/builder/app.js` matches the `_spacer_base` suffix.
- **The repos find each other through the Makefile.** `make SITE=<path>` now
  exports `FRAMEWORK_SITE` and `FRAMEWORK_RENDERER`, and render parity, the
  names check, the price builder and `test-builder.mjs` read them. Before, a
  worktree pair built one side and checked the other against the main checkout.
- **`make assets` overwrote the 16 untrimmed GLBs again** (the landmine at the
  foot of this doc). Restored from git; still not fixed at the asset plan.
- **Zoho item creation goes through the Books MCP connector**, then the four
  eTIMS fields go on with a REST PUT, as before. The refresh token in
  `../framework-ops/.env` can update items but not create them (no
  `settings.CREATE` scope), so a REST POST answers 401.

---

# Deep Spacer Base, 2026-09-20

**The module.** A deep base carrying no shelves: four legs to the floor with
feet, and at each level the two spine bars plus one cross rail on the back post
centreline — the bracing a deep spacer has. 1163 × 447 × 435mm. In plan it is
the deep spacer's U; in elevation it is the deep base without its boards and
without the rails that project past the posts.

**Price: KSh 9,000**, VAT-inclusive, like every other line. Decided 2026-09-20.

**Name: "Deep Spacer Base".** Not cosmetic — `zohoItemName()` in
`netlify/functions/_push.mjs` derives the invoice line from the module id, so
the Rhino block name *is* what the customer reads, and it is what the Zoho item
and the Airtable product are matched on. Changing one means changing all three.

**No trimmed variant.** Every other unit has one, because trimming removes the
rail projections and the board overhang. This module has neither, so the two
cuts would be identical.

---

## Done

- [x] **Geometry** — from `deep_base_trimmed`: both 12mm MDF boards removed, the
      front cross rail of each level removed, the rear rail moved back 118.5mm
      so its back face lands on y 427. Every member is existing stock on its
      existing layer; nothing new is cut.
- [x] **The Rhino block, built without Rhino.** `rhino3dm` reads and writes
      .3dm, so the block was assembled by
      `../framework-renderer/source/pending-modules/add-deep-spacer-base.py`,
      which sits beside the bookend for the same reason: a module that came
      from somewhere other than the library itself. It writes
      `deep_spacer_base.3dm` (the block alone, to import by hand) and a full
      library with the block placed in a clear row beside the deep family.
      A read/write round-trip of the master was checked first: objects, their
      ids and attributes, block definitions, layers, materials, views and
      dimension styles all survive. The file shrinks 47M → 28M, which is Rhino's
      cached render meshes being dropped and rebuilt on open.

      **Written in Rhino 7 format**, matching the library's archive version.
      rhino3dm writes Rhino 8 unless told otherwise and Rhino 7 refuses those
      outright. The script now reads the source's version and writes the same.
- [x] **The COLLADA export, also without Rhino.** `splice-dae.py` (this
      session's scratchpad) adds the block to
      `source/framework-shelving-library.dae` by building its node out of
      `deep_base_trimmed`'s own nodes: the kept members reference the very same
      `<geometry>` elements with the very same material bindings, and only the
      two moved rails get geometry of their own — a copy of the rail with every
      position Y shifted, because `analyze-dae-module-map.py` reads a child's
      bounds from its geometry and ignores a matrix on the node. No new mesh,
      no guessed material, no coordinate that was not already in the file.
      It produces the same 18 members as a real Rhino export of the block.
- [x] **Interfaces declaration** — `configs/module-interfaces.json` gains a
      `deep_spacer_base` entry identical to `deep_base`'s. The pipeline stops
      with "measured geometry has no declaration" without it; the declaration
      is meant to be reviewed by hand rather than bootstrapped.
- [x] **Pipeline run** — manifest, extract, assets, refine, validate, contract,
      site. 32/32 golden configs, render parity OK across 31 configs, socket
      baseline refreshed (80 lines added, none removed), geometry within budget.
- [x] **Golden config** — `deep-spacer-base-extension` in
      `scripts/validate/test-module-configurations.py`, so the module has the
      same regression net as everything else. It rides into this repo through
      the contract as a test fixture.
- [x] **Price through the chain.** `data/module-prices.json` is a new, plain
      record of module type → price, read by `scripts/build-canonical-prices.mjs`
      alongside the old designer entries, with the same first-writer-wins and
      fail-on-disagreement rule. It exists because the 2D designer was the only
      place a price had ever been recorded, and each of its entries needs two
      isometric SVGs for a page now being retired — a new module should not have
      to be drawn into a dead tool to be priced.
- [x] **Vocabulary naming bug fixed.** `displayName` was built from family and
      role, which assumes one module per pair — so the new module came out
      called "Deep Base", the same as the actual deep base. Names now fall back
      to the block id **only** where they would otherwise collide, which leaves
      the deliberate exceptions alone (`booster_adapter` is "Standard Adapter"
      on purpose). Verified: no existing name changed.
- [x] **/builder.** `ADVANCED_ONLY` in `js/builder/app.js`. Not only the
      Advanced-only decision: `computeSiteVariants()` picks one module per
      family and role as the one the site sells, and a second untrimmed
      `deep:base` was in the running to become that one — decided by catalogue
      order, with the losing case selling every Simple deep shelf with no
      shelves in it. `simpleVariant()` got the same guard; it happened to pick
      right by alphabet, which is not a reason.
      Verified in the browser: Advanced offers "Deep Spacer Base — 9 spots —
      KSh 9,000", placing one takes the total from 12,000 to 21,000 and the
      breakdown reads "Deep Spacer Base ×1 KSh 9,000"; Simple on Deep units
      still builds Deep Base + Deep Extension.
- [x] **Zoho Books item** — `item_id 4099765000004135002` in the Framework
      Designs Ltd. org. Name `Deep Spacer Base`, active, rate 9000 (the
      org is tax-inclusive), account Sales `4099765000000076169`, `item_type
      sales`, `product_type goods`, `is_taxable true`, sales tax rule
      `4099765000001069048` (General Rate 16%, KRA).
- [x] **Airtable product** — `recBBJkYhBvuq5oet` in Products: Name `Deep Spacer
      Base`, Status Active, `Zoho Item ID 4099765000004135002`, Price 9000, the
      same Notes as the Zoho description. `MDF Surface Area` is left blank:
      the value is genuinely zero, and blank is what every other module
      without MDF carries. The reconciler's check that an active
      product is named what Zoho calls the item it points at passes by
      construction — that is the check that caught 92 orders' worth of
      mislabelled Wide Bases in August.
- [x] **eTIMS registration.** Unit `pcs`, Item Classification Code
      `5610153200` (UNSPSC 56101532, bookcases), Packaging Unit `NT`, Origin
      `KE` — the same four values every other shelving item carries. Zoho
      answered "The Item has been pushed to eTIMS" and the item's eInvoice
      status now reads `pushed`, matching `Deep Base` field for field.

      Written through the **Books REST API directly**, with the refresh token
      in `../framework-ops/.env`, because the MCP connector's `create_item`
      and `update_item` expose the Mexican SAT fields and no Kenyan ones. The
      REST API takes `item_classification_code`, `package_unit_code`, `unit`
      and `origin_country_code` on a PUT and pushes to eTIMS on save.
- [x] Builder assets at v118; `npm test` green. The bench page that worked the
      geometry out, `spacer-base-lab.html`, has been removed.

## Left to do

- [x] **`Materials Cost (Blue)`: 1,269.** The field is a rollup, not a value —
      it sums `Cost (VAT Incl)` over linked rows in `Inventory - Product Usage`,
      so it was blank because the module had no bill of materials, not because
      a number was missing. Ten rows now exist, mirroring
      `Deep Base (Trimmed)`'s, which is the module this one is derived from.

      The steel is exact, not estimated. Steel is bought in 6m lengths, and the
      existing quantities are pure geometry: `deep_base_trimmed` is 4 spine bars
      at 427 plus 4 cross rails at 1123 = 6.200m = **1.0333** of a length, and
      4 legs at 422 = 1.688m = **0.2813** — which is exactly what Airtable
      holds, to four decimals. So this module is 4 spine bars plus **two** rails
      = 3.954m = **0.6590**, and the same 0.2813 of round tube.

      | row | qty | certainty |
      |---|---|---|
      | 20x20x1.5mm | 0.6590 | Exact |
      | 20x1.5mm round tube | 0.2813 | Exact |
      | M8 Black Nut | 4 | Exact |
      | 1" M8 Allen Cap + nut | 4 | Exact |
      | Paint - NC Primer | 0.2614 | Rough |
      | Paint - Thinner | 1.0456 | Rough |
      | Color Paint - NC Dark ×4 | 0.1802 | Rough |

      Paint is inferred and marked `Rough`, as every paint row in the table
      already is. Primer fits `0.04633·tube_m + 0.44717·mdf_m²` at R² 0.99 over
      50 modules, and thinner is exactly 4× primer in every one. Only the dark
      colours are here: the light colours are the MDF's and this module has no
      MDF, which is also why `MDF Sheets - 12mm` (987) is absent.

      Consumables were then added — see below — taking it to **1,682**, which
      is the figure that compares with `Deep Spacer`'s 1,042. `MDF Surface
      Area` is left blank: the value is genuinely zero, and blank is what every
      other module without MDF carries.

- [x] **Consumables backfilled across the range.** Only 26 of 57 products
      carried cutting discs, electrodes, flap discs, body filler, epoxy or the
      catalogue/instructions/sticker pack-out, which made `Materials Cost
      (Blue)` incomparable between siblings — `Deep Base` had them and
      `Deep Base (Trimmed)` did not. 224 rows added across the 31 that were
      missing them, +8,389 KSh in total, 82 to 413 each.

      The quantities are not invented. The 26 products that had them follow an
      exceptionless grid of **role × depth**, and nothing finer — cut-per-metre
      of steel ranges 0.12 to 0.21 across them, so it is not a per-metre rule:

      | | deep base | std base | deep other | std other |
      |---|---|---|---|---|
      | Cutting Disc | 1.5 | 1.0 | 0.75 | 0.5 |
      | Flap Disc | 0.75 | 0.5 | 0.4 | 0.4 |
      | Grinding Disc | – | – | 0.2 | 0.2 |
      | Electrodes | 3 | 2 | 3 | 2 |
      | Body Filler | 0.075 | 0.05 | 0.075 | 0.05 |
      | epoxy | – | – | 0.2 | 0.2 |

      Deep depth is the Broad, Compact and Deep families; standard is Slim,
      Standard, Wide and Corner. Bases also take a Brand Sticker; everything
      sold as a unit takes a Catalog and Instructions.

      Hangers, top bars and boosters have **no** in-family reference, so those
      are the same row scaled by their steel against the same-depth extension
      (0.26x for a deep booster, 0.82x for a deep hanger) and marked
      `Placeholder` rather than `Rough`, which is the table's own word for it.

      Every created row carries `consumables backfill 2026-09-20` in its Note,
      and the record ids are in this session's scratchpad as
      `created-usage-rows.json`, so the whole batch can be reversed.
- [x] **Re-baked the downstream margin figure.** `Live Scaled Unit Value` is a
      formula — `IF(materials<100, 0, ((price − materials)/1.16)/3463.79)` — so
      it moved on its own. `Baked Scaled Unit Value` beside it is a static
      percent that mirrors it to four decimal places, and that mirror broke on
      all 31 products when their costs rose. Re-baked: drift was −0.02 to −0.10,
      and `Baked = round(Live, 4)` now holds on every product in the table.

      Worth knowing: the rows the formula zeroes (`Medium Base`,
      `Medium Extension`, `Medium Spacer`, the steel decorations,
      `Custom Deep Spacer`) keep old baked values because their materials cost
      is under the formula's 100 floor. They were left alone.

- [ ] **Review.** Both repos are committed but nothing is pushed or merged:
      `framework-renderer` on a new branch `deep-spacer-base`,
      `framework-site` on `marketing-build`. The pipeline's
      `source/framework-shelving-library.3dm` and `.dae` are rewritten; the
      originals are backed up in this session's scratchpad under `backup/`.
      `metrics.html` was already modified before this work and is untouched.
- [ ] **Catalogue and Meta feed** — only if a finished configuration featuring
      it goes on `/shelving`. See `AGENTS.md`; use
      `scripts/import-shelving-product.mjs`, do not hand-edit.

## `Profit Margin`: retired, and it was hiding a 922,000 KSh understatement

A static percent on Base - Products, set on **12 of 68** products. It looked
vestigial. It was not — across all 464 fields in the base there was exactly one
reference, and it led somewhere live:

    Products.Profit Margin
      -> Orders - Line Items.Margin                    (lookup)
        -> Orders - Line Items.Revenue less Materials  (= Subtotal x Margin)

It never touched the scaled-unit chain, which was the thing worth checking:
`Live Scaled Unit Value` is `IF(materials<100, 0, ((price − materials)/1.16)/3463.79)`
— price and materials cost and nothing else — and `Scaled Total` reads
`Baked Scaled Unit Value`. Independent, which is what made the re-bake above
sufficient on its own.

**The fault was silent and large.** For the 56 products with no margin set,
`Subtotal x blank` evaluated to **zero**, not blank — so every line of a Deep,
Broad or Compact product recorded no gross profit at all. `Revenue less
Materials` is now computed from costs that are live and correct for all 68:

    Revenue less Materials =
      IF(materials is blank or "# Missing Prices",
         BLANK(),
         Subtotal − VALUE(materials) x Quantity)

via a new `Materials Cost (from Item)` lookup. Over 750 line items the total
moves **2,926,328 -> 3,848,827 KSh, +922,499** — the old figure was 76% of the
truth. Spot-checked by hand: 3 x Deep Base in Sage = 43,500 subtotal less
15,471 of materials = 28,029, which is what the field now shows, against 0
before. Twenty-eight lines went blank rather than zero: products with no costed
bill of materials, which is the point of the guard — it fails visibly instead
of overstating.

`Profit Margin` and the `Margin` lookup are now orphaned, confirmed by
re-reading the schema: zero references to either. The Airtable API has no
delete-field route (404 on a real field id), so both are renamed
`zzz - … (unused, safe to delete)` with the reason in their descriptions,
following the base's own convention. Deleting them is two clicks in the UI.

## Two landmines found on the way

**The Zoho item editor does not render a stored Item Classification Code.**
Open any shelving item in Books → Items → Edit and the eTIMS "Item
Classification Code" select reads "Select Item Classification Code", as though
a required field were empty. It is not: `Deep Extension (Trimmed)`,
`Deep Base`, `Deep Spacer`, `Deep Base (Trimmed)` and `Compact Base` all
return `5610153200` from the API, and all are pushed. The select simply cannot
resolve the code to a label.

**So do not fix it from that screen.** Saving a form whose required select is
showing empty is how a correct code gets blanked on an item that was already
fiscalised. Read and write these fields over the API, where the values are
plainly visible.

## A landmine found on the way

**`make assets` silently replaces 16 modules' geometry with their trimmed cut.**
`generated/manifests/three-asset-plan.json` maps each untrimmed module to its
*trimmed* block — `deep_base` ← `deep_base_trimmed`, and the same for every
other family — so the DAE export path writes trimmed geometry into the
untrimmed module's GLB. The tracked GLBs, made by the in-Rhino exporter
(`scripts/assets/rhino-export-module-glbs.py`, which inserts the real block),
carry the correct untrimmed geometry.

It surfaced here as `slim_extension: geometry overruns the catalog bbox` in the
site's own tests after a full run, and the diagnosis was clean: the DAE path
reproduced 20 of the 36 GLBs byte-for-byte and diverged on exactly the 16 with
a trimmed twin. Those 16 were restored from git and only the new module's GLB
was kept.

**Anyone running `make all` today would ship trimmed bases as full ones**, and
the only thing that catches it is a bbox assertion in the *other* repo. Worth
fixing at the asset-plan level before the next geometry change.
