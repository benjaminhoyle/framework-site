// Prompt ingredients for the Framework image generator.
//
// Two kinds of thing live here, and the file is laid out so the difference is
// visible:
//
//   INVARIANTS  what is true of every scene: the product is the reference, the
//               camera stays where the reference put it, the room is a real
//               Nairobi room, the photograph is competent, and the negative
//               prompt. Nothing draws from these; they are appended whole.
//
//   VARIABLES   the option groups a scene is assembled from. Each option has a
//               stable id (saved sessions depend on it), a label for the app,
//               and the prompt text it adds. Options that are drawn at random
//               also carry a weight, and traces and details carry the rooms
//               they belong in, so an office never draws a cot.
//
//   POOLS       the distributions the random draw uses: which persona fits
//               which room, how full a shelf tends to be, how likely each
//               light. js/studio/brief.js reads these; the app never shows
//               them.
//
// The archetypes at the end keep their narrative paragraph and their fixed
// place (walls, floor, rug, furniture, window). What they no longer fix is
// the light, the human traces and the grounding details: those are drawn per
// image from weighted pools, because a fixed list is how every picture of the
// Karen house came out at golden hour with a tote bag by the wall.

(() => {
  // ───────────────────────────────────────────────────────────── INVARIANTS ──

  // The books rule has two forms. Strict is the default; relaxed is used when
  // the brief makes books the point of the picture (see scene-prompt.js).
  const BOOKS_STRICT = `  - Do NOT show open books. Any book lying on a shelf, sofa, table, or floor must be closed.`;
  const BOOKS_RELAXED = `  - Books may be open only if resting on a surface: a table, the floor, a bed, a lap. Never open on a shelf, never propped, never floating.`;
  const NEGATIVE_BOOKS_STRICT = "open books";
  const NEGATIVE_BOOKS_RELAXED = "open books on a shelf";

  const INVARIANTS = {
    referenceRolePrompt: `PRODUCT REFERENCE ROLE:
  - The attached shelf photo is product truth, not loose inspiration.
  - Priority order is: shelf geometry, material, colour, joints, tier count, and scale first; scene, styling, objects, and mood second.
  - If any room, styling, or object instruction conflicts with product fidelity, ignore that conflicting instruction and preserve the shelf.`,

    preservationPrompt: `CRITICAL CONSTRAINTS. DO NOT VIOLATE:
  - The shelf's geometry must match the reference photo EXACTLY: same number of tiers, same proportions, same spacing
  - The shelf must be up against the wall (within 2cm) unless specified otherwise
  - Steel frame colour and powder-coat finish must match the reference precisely
  - Do NOT add features not in the reference: no LED strips, no lighting, no brackets, no glass panels, no wooden shelves, no drawers, no doors
  - Do NOT attach or integrate lighting into the shelf. If a lamp appears in the surrounding room, it must be a separate ordinary room lamp, never part of the shelf.
${BOOKS_STRICT}
  - Books must obey simple physics: vertical books need support from a shelf side, a post, bookends, a heavy object, or a horizontal stack; no unsupported freestanding books.
  - Books sit spine-out: standing books show their spines to the room, and horizontal stacks show spines along the front edge rather than page edges. One fore-edge-out book is the most that should ever appear.
  - Pendant lights should have a simple shade over the bulb. Do not show bare-bulb pendant lights unless the user explicitly asks for one.
  - Maintain modular steel tube construction: powder-coated steel tubes and flat steel shelves with visible bolt connections
  - Realistic scale relative to surrounding furniture and doorways
  - Preserve exact metalwork joint style: simple bolt-through connections
  - The uprights are stacked segments: a slim collar in the frame colour sits at each join, recurring up the leg whether or not a shelf meets it there. Keep them exactly as small and flush as the reference shows: easy to miss, never dropped.
  - Keep the shelf readable: front vertical tubes, legs, shelf edges, bolt points, and tier gaps must remain visible
  - Shelf boards are sawn square: seen from above their ends and corners are sharp right angles, never rounded, radiused, or softened`,
    booksStrictPrompt: BOOKS_STRICT,
    booksRelaxedPrompt: BOOKS_RELAXED,

    // A photograph of a shelf is a projection of it from one place. Everything
    // in preservationPrompt above (tier count, proportions, spacing, colour)
    // is true from any vantage, so none of it stops the model re-shooting the
    // shelf from somewhere else. Silhouette is the word that does: an outline
    // can only be traced from the place it was traced from. That is why the
    // catalogue studio holds its perspective without ever mentioning a camera,
    // and these are its lines.
    viewpointPrompt: `VIEWPOINT LOCK - the reference photo's vantage is product truth:
  - Treat the shelf in the reference like a traced blueprint. Its silhouette must match the reference before any styling is added.
  - Reproduce the vantage the reference was taken from: the same camera height relative to the shelf, the same horizontal angle around it, the same foreshortening along the shelf boards, the same convergence of the vertical tubes, and the same shelf tops or undersides in view.
  - Only the vantage is locked. The room, its walls, floor, furniture and light are yours to build, and the shelf may sit anywhere in the frame at any size.
  - INTERNAL VIEWPOINT AUDIT BEFORE RETURNING IMAGE: compare the generated shelf - the shelf, not the whole picture - to the reference. If the camera has moved around it, risen above it, or dropped below it, or if the silhouette no longer matches, correct it before finalizing.`,

    negativePrompt: `DO NOT include: strip lights, LED lighting, clamp-on lamps attached to the shelf, changed shelf count, altered shelf spacing, thickened tubes, curved or decorative frame, glass shelves, wooden shelves, drawers, doors, cabinets, decorative brackets, branding, logos, price tags, floating shelves, wall-mounted panels, perfect magazine-style staging, ${NEGATIVE_BOOKS_STRICT}, unsupported freestanding books, bare-bulb pendant lights unless explicitly requested by the user`,
    negativeBooksStrict: NEGATIVE_BOOKS_STRICT,
    negativeBooksRelaxed: NEGATIVE_BOOKS_RELAXED,

    // The photographic floor: authenticity may come from the place and its
    // contents, never from bad photography. Always appended to scene prompts.
    craftFloorPrompt: `PHOTOGRAPHIC FLOOR, non-negotiable regardless of how casual or lived-in the scene is:
  - The shelf is the clear subject: fully visible, well lit, in focus, not blocked by furniture or clutter.
  - Composition balanced, and the frame not rolled or dutched for effect. How level the horizon sits and how far the verticals converge follow the VIEWPOINT LOCK instead of this floor, because those describe where the camera stands.
  - Exposure correct, colours harmonious with the room's palette.
  - Realism must come from the place, its objects, its light, and its imperfect life, never from blur, underexposure, tilted framing, or the product being obscured.`,

    // The light is a room's light, recorded, not a look applied to it.
    honestLightPrompt: `HONEST LIGHT: the light is what a camera would record in that room at that hour, nothing added. No haze, no glow, no visible sun rays, no cinematic grade, no colour cast laid over the whole frame. A well-lit real room, not a styled one.`,

    // Left to itself the model fills a shelf with beige and grey, then
    // over-corrects into a rainbow when told not to. Both are wrong: real
    // shelves take their colour from what is actually on them.
    contentsColourPrompt: `Colour: at most half the shelf contents may be beige, grey, white, or natural fibre. The rest carry the ordinary colour real books and objects have: varied and unevenly distributed, never sorted into a rainbow or a gradient.`,

    // Grounding line for every in-use scene.
    nairobiTruthPrompt: `AUTHENTIC NAIROBI: This is a real, occupied space in Nairobi, Kenya, not a showroom, not a render. Nairobi sits at 1,800m on the equator: daylight is strong, clean and high-angle, shadows crisp, mornings cool. Rooms are daylight-lit in the day. Include the small honest signs of a real space, consistent with the condition requested: a real home can be well kept and still be real.`,
  };

  // ────────────────────────────────────────────────────────────── VARIABLES ──

  // Scene ids, grouped so traces and details can say where they belong
  // without listing every room by hand.
  const HOME = ["living-room", "study-nook", "library-wall", "wall-niche", "bedroom-corner", "bedroom-wardrobe", "kids-room", "nursery", "kitchen-dining", "entryway", "covered-terrace"];
  const WORK = ["study-nook", "office-commercial", "creative-studio"];
  const PUBLIC = ["cafe-display", "retail-boutique"];
  const KIDS = ["kids-room", "nursery"];
  const SLEEP = ["bedroom-corner", "bedroom-wardrobe"];
  const LIVING = ["living-room", "library-wall", "wall-niche"];
  const ANY = [...HOME, ...WORK, ...PUBLIC];
  const grown = (...groups) => [...new Set(groups.flat())];

  const VARIABLES = {
    shotTypes: [
      { id: "clean", label: "Clean product shot", prompt: "A clean product photograph where the shelf is isolated and easy to inspect." },
      { id: "use", label: "Shelf in use", prompt: "A real environment where the shelf is being used naturally." },
    ],
    productBackgrounds: [
      { id: "warm-wall-floor", label: "Warm wall + floor", prompt: "A simple warm off-white plaster wall and neutral floor plane, soft grounding shadow, no room clutter." },
      { id: "white-studio", label: "White studio", prompt: "A seamless matte white studio background with soft natural shadows, catalogue-ready but still realistic." },
      { id: "grey-studio", label: "Grey studio", prompt: "A plain light grey studio background with a soft floor contact shadow and no props." },
      { id: "cutout-white", label: "White cutout", prompt: "Isolated on pure white, e-commerce style, minimal shadow, no visible room context." },
    ],
    settingTypes: [
      { id: "residential", label: "Home" },
      { id: "commercial", label: "Commercial" },
    ],
    scenes: [
      { id: "living-room", name: "Living Room", prompt: "A living room with a low sofa with cushions, a large multi-pane window, a simple shaded pendant light overhead, a side table" },
      { id: "study-nook", name: "Study / Home Office", prompt: "A home study corner with a simple desk, a laptop on it, a desk chair, a window with a sheer curtain" },
      { id: "library-wall", name: "Home Library Wall", prompt: "A reading area with a comfortable armchair, a throw blanket draped over its arm, and a separate floor lamp set away from the shelf" },
      { id: "wall-niche", name: "Wall Niche / Alcove", prompt: "A recessed wall niche or alcove, the shelf fitted into the rectangular recess, appearing integrated" },
      { id: "bedroom-corner", name: "Bedroom Corner", prompt: "A bedroom corner with the edge of a bed with linen visible, a separate bedside lamp away from the shelf, a window with a sheer curtain" },
      { id: "bedroom-wardrobe", name: "Bedroom, Open Wardrobe", prompt: "A bedroom where the shelf is used as an open wardrobe, a full-length mirror leaning against the adjacent wall" },
      { id: "kids-room", name: "Children's Bedroom", prompt: "A children's bedroom with a small bed with colorful bedding, a few toys on the floor, natural daylight" },
      { id: "nursery", name: "Baby Nursery", prompt: "A nursery corner with a crib or cot partially visible, soft natural light from a window, a small woven hamper" },
      { id: "kitchen-dining", name: "Kitchen / Dining", prompt: "An open-plan kitchen-dining area with a dining table and chairs, a kitchen countertop visible in background" },
      { id: "entryway", name: "Entryway / Hallway", prompt: "An apartment entryway near a front door, a mirror or coat hooks on the adjacent wall" },
      { id: "covered-terrace", name: "Covered Terrace", prompt: "A covered outdoor terrace under a roof overhang, outdoor chairs nearby, garden visible" },
      { id: "office-commercial", name: "Commercial Office", prompt: "A small office or co-working space with desks and chairs, large windows, a whiteboard on a wall" },
      { id: "cafe-display", name: "Café / Restaurant", prompt: "A café interior with wooden tables and chairs, a menu board or counter visible, simple shaded pendant lights" },
      { id: "retail-boutique", name: "Boutique Retail", prompt: "A boutique shop, good overhead lighting, a clothes rack or display table nearby, a glass shop front" },
      { id: "creative-studio", name: "Creative Studio", prompt: "An artist studio with large windows, a large work table, canvases leaning against walls, exposed ceiling" },
    ],
    walls: [
      { id: "auto", label: "Auto" },
      { id: "soft-white", label: "Smooth white", prompt: "Smooth white plastered walls with a clean, even paint finish" },
      { id: "warm-cream", label: "Warm cream", prompt: "Warm cream or off-white plastered walls with faint trowel texture" },
      { id: "sky-blue", label: "Soft blue-white", prompt: "Walls painted a soft sky blue-white" },
      { id: "sage-green", label: "Pale sage", prompt: "Walls painted a muted sage green" },
      { id: "dusty-pink", label: "Dusty pink", prompt: "Walls painted a soft dusty rose pink" },
      { id: "terracotta-acc", label: "Terracotta accent", prompt: "One wall warm terracotta or burnt clay, remaining walls neutral white" },
      { id: "teal-acc", label: "Teal accent", prompt: "One wall deep teal or petrol blue, remaining walls neutral white" },
      { id: "mustard-acc", label: "Mustard accent", prompt: "One wall warm mustard yellow, remaining walls neutral white" },
      { id: "olive-acc", label: "Olive accent", prompt: "One wall deep olive green, remaining walls neutral white or cream" },
      { id: "raw-concrete", label: "Raw concrete", prompt: "Exposed raw concrete walls with formwork marks, industrial texture" },
      { id: "exposed-brick", label: "Exposed brick", prompt: "Exposed red or clay brick wall, possibly limewashed, with visible mortar joints" },
      { id: "stone-blocks", label: "Stone blocks", prompt: "One wall of rough-hewn grey stone blocks, other walls smooth plaster" },
      { id: "textured-plaster", label: "Textured plaster", prompt: "Hand-applied plaster with visible trowel marks, paint slightly uneven" },
    ],
    floors: [
      { id: "auto", label: "Auto" },
      { id: "red-oxide", label: "Red oxide", prompt: "Polished red-oxide cement floor, deep rust red, smooth with decades of sheen, classic Kenyan" },
      { id: "herringbone", label: "Herringbone parquet", prompt: "Dark-stained wood parquet in herringbone pattern, slightly worn" },
      { id: "wide-plank", label: "Wide-plank wood", prompt: "Wide-plank natural wood floorboards, medium tone, visible grain" },
      { id: "polished-concrete", label: "Polished concrete", prompt: "Polished concrete floor, smooth grey finish with subtle reflections" },
      { id: "large-tile", label: "Large neutral tile", prompt: "Large-format neutral porcelain floor tiles with thin grout lines" },
      { id: "terrazzo", label: "Terrazzo", prompt: "Terrazzo floor with coloured aggregate chips in a pale cement base" },
      { id: "patterned-cement", label: "Patterned cement tile", prompt: "Patterned cement tiles in geometric design, East African or Mediterranean style" },
      { id: "laminate", label: "Laminate", prompt: "Medium-tone laminate or engineered hardwood with visible plank seams" },
      { id: "dark-tile", label: "Dark charcoal tile", prompt: "Large dark charcoal or slate-toned floor tiles" },
    ],
    rugs: [
      { id: "auto", label: "None / Auto" },
      { id: "sisal-jute", label: "Sisal / jute", prompt: "A woven natural sisal or jute rug near the shelf" },
      { id: "kilim", label: "Patterned kilim", prompt: "A flat-woven kilim rug with geometric patterns in earthy colors" },
      { id: "solid-wool", label: "Solid wool", prompt: "A simple solid-color wool or cotton rug in a muted tone" },
      { id: "cowhide", label: "Cowhide", prompt: "A natural cowhide rug, irregular shape, organic brown-and-white pattern" },
      { id: "moroccan", label: "Moroccan / Berber", prompt: "A plush Moroccan or Berber-style shag rug with diamond patterns" },
    ],
    furniture: [
      { id: "auto", label: "Auto" },
      { id: "mid-century", label: "Mid-century", prompt: "Nearby furniture in mid-century modern style: tapered wooden legs, clean lines, organic curves" },
      { id: "industrial", label: "Industrial", prompt: "Nearby furniture in industrial style: raw metal frames, reclaimed wood, exposed hardware" },
      { id: "scandinavian", label: "Scandinavian", prompt: "Nearby furniture in Scandinavian style: light wood, minimal forms, functional simplicity" },
      { id: "eclectic", label: "Eclectic", prompt: "Eclectic mix of furniture: vintage alongside modern, mismatched but curated" },
      { id: "african-contemporary", label: "African contemporary", prompt: "Contemporary African design: woven elements, carved wood, rich textiles" },
      { id: "bohemian", label: "Bohemian", prompt: "Bohemian: layered textiles, floor cushions, macramé, natural materials" },
      { id: "minimal-modern", label: "Minimal modern", prompt: "Minimal modern: clean geometric shapes, monochrome palette, no ornament" },
    ],
    windowView: [
      { id: "auto", label: "Auto" },
      { id: "green-garden", label: "Green garden", prompt: "Through windows: lush green garden with tropical plants and mature trees" },
      { id: "apartments-trees", label: "Apartments & trees", prompt: "Through windows: neighboring apartment buildings with trees, typical Nairobi residential" },
      { id: "open-sky", label: "Open sky", prompt: "Through windows: wide open sky with scattered clouds" },
      { id: "dense-tropical", label: "Dense tropical", prompt: "Through windows: dense tropical vegetation, banana leaves, palms, creepers" },
      { id: "rooftop-city", label: "Rooftop / city", prompt: "Through windows: Nairobi rooftops and city skyline" },
    ],
    colourMood: [
      { id: "auto", label: "Auto" },
      { id: "high-contrast", label: "High contrast", prompt: "COLOUR MOOD: High contrast. Deep blacks and bright highlights, dramatic tonal range" },
      { id: "cool-pops", label: "Cool + pops", prompt: "COLOUR MOOD: Cool palette. Whites, greys, soft blues, punctuated by warm accent colours" },
      { id: "warm-wood", label: "Warm wood", prompt: "COLOUR MOOD: Warm natural wood dominates. Amber, honey, walnut. Cozy golden undertones" },
      { id: "green-natural", label: "Green & natural", prompt: "COLOUR MOOD: Natural greens. Indoor plants, botanical elements, organic and fresh" },
      { id: "stone-pops", label: "Stone + pops", prompt: "COLOUR MOOD: Cool stone and concrete base palette with carefully placed colour pops" },
      { id: "bright-airy", label: "Bright & airy", prompt: "COLOUR MOOD: Predominantly white and pale tones, maximum natural light, spacious" },
      { id: "moody-dark", label: "Moody & dark", prompt: "COLOUR MOOD: Deep dark tones, pools of warm light against rich shadows, intimate" },
      { id: "earthy-muted", label: "Earthy & muted", prompt: "COLOUR MOOD: Ochres, terracotta, olive, burnt sienna. Desert-palette warmth" },
    ],
    camera: [
      { id: "auto", label: "Auto" },
      { id: "phone-snap", label: "Phone snapshot", weight: 4, prompt: "CAMERA: Cheap phone. Auto-exposure blows highlights. No depth of field. Visible noise. NOT professional." },
      { id: "decent-phone", label: "Decent phone", weight: 24, prompt: "CAMERA: Recent smartphone. Computational portrait-mode bokeh. Over-sharpened. Minor HDR look." },
      { id: "entry-camera", label: "Entry camera", weight: 36, prompt: "CAMERA: Consumer DSLR with kit zoom. Clean, low noise. Decent depth of field. Competent." },
      { id: "pro", label: "Professional", weight: 36, prompt: "CAMERA: Full-frame with prime lens at f/2.8-f/4. Beautiful natural bokeh. Rich shadows." },
    ],
    framing: [
      { id: "auto", label: "Auto" },
      // These say how well the frame is composed, and nothing about where the
      // photographer stands. "Standing eye-height", "level horizon" and
      // "optimal angle" used to live here, and they are camera positions: they
      // fought viewpointPrompt for control of the vantage and sometimes won.
      { id: "snapshot", label: "Snapshot", weight: 4, prompt: "FRAMING: No composition. Shelf off-center in the frame. Too much empty space." },
      { id: "casual", label: "Casual", weight: 30, prompt: "FRAMING: Roughly centered but imperfect." },
      { id: "considered", label: "Considered", weight: 44, prompt: "FRAMING: Approximate rule of thirds. Some leading lines." },
      { id: "professional", label: "Professional", weight: 22, prompt: "FRAMING: Expert rule-of-thirds. Deliberate leading lines." },
    ],
    // Weights sum to 100. Golden, evening and night together are twelve in a
    // hundred: they exist, and they are the exception.
    light: [
      { id: "auto", label: "Auto" },
      { id: "flat-overcast", label: "Flat overcast", weight: 14, daylight: true, prompt: "LIGHT: Flat even light from overcast sky. No directional shadows. Slightly cool." },
      { id: "soft-cloudy", label: "Soft cloudy", weight: 28, daylight: true, prompt: "LIGHT: Diffused daylight, slightly warm. Soft shadows with gradual edges." },
      { id: "bright-soft", label: "Bright, soft shadows", weight: 30, daylight: true, prompt: "LIGHT: Strong daylight diffused through sheers. Bright and well-lit, shadows soft-edged." },
      { id: "bright-hard", label: "Bright, hard shadows", weight: 16, daylight: true, prompt: "LIGHT: Direct equatorial sun. Distinct light patches. High contrast. Crisp shadow edges." },
      { id: "golden", label: "Golden hour", weight: 6, daylight: false, prompt: "LIGHT: Warm golden light at low angle. Rich amber tones. Long, soft shadows." },
      { id: "evening-lamps", label: "Evening lamps", weight: 5, daylight: false, prompt: "LIGHT: Warm artificial light from fixtures and lamps. Mixed with dim dusk. Cozy." },
      { id: "night", label: "Night", weight: 1, daylight: false, prompt: "LIGHT: Room lighting only. Warm pools of light, dark corners. No natural light." },
    ],
    persona: [
      { id: "auto", label: "None / Auto", contents: "" },
      { id: "reader", label: "The Reader", books: true, contents: "books stacked horizontally and vertically, a small framed print, perhaps a separate reading lamp nearby but not mounted on the shelf" },
      { id: "collector", label: "The Collector", contents: "travel souvenirs, ceramics, a small sculpture, a vintage clock, decorative objects" },
      { id: "minimalist", label: "The Minimalist", contents: "three deliberately placed objects: one vase, one succulent, one stack of books. Generous space." },
      { id: "parent", label: "The Parent", books: true, contents: "children's picture books, a stuffed toy, a framed print, colourful storage boxes" },
      { id: "creative", label: "The Creative", contents: "art supplies, sketchbooks, ink bottles, reference books, a camera" },
      { id: "plant-parent", label: "Plant Parent", contents: "multiple small potted plants, propagation jars, one trailing plant with hanging vines" },
    ],
    // Weighted toward moderate and full: a shelf nobody has put anything on
    // is the other way a picture reads as a render.
    fullness: [
      { id: "empty", label: "Empty", weight: 0, prompt: "completely empty" },
      { id: "sparse", label: "Sparse", weight: 6, prompt: "very sparse, 1-2 items" },
      { id: "light", label: "Light", weight: 16, prompt: "lightly filled with breathing room" },
      { id: "moderate", label: "Moderate", weight: 34, prompt: "moderately filled, curated, most tiers carrying something" },
      { id: "full", label: "Full", weight: 34, prompt: "well-filled and intentional, every tier carrying something, while keeping shelf edges, front tubes, legs, and tier spacing visible" },
      { id: "packed", label: "Packed", weight: 10, prompt: "densely stocked, near capacity, every tier in use, but with the shelf structure still clearly visible and not hidden behind objects" },
    ],
    // "well-kept" is the register that was missing: a real home whose owners
    // look after it. Most Nairobi homes a shelf is sold into are this.
    livedIn: [
      { id: "showroom", label: "Showroom", weight: 0, prompt: "showroom condition: pristine, deliberately staged" },
      { id: "tidy", label: "Tidy", weight: 18, prompt: "fresh and tidy: clean but with minor signs of life" },
      { id: "well-kept", label: "Well kept", weight: 34, prompt: "well kept, a real home: clean and cared for, surfaces wiped, things put away, personal and plainly lived in, nothing tired or worn" },
      { id: "lived-in", label: "Lived-in", weight: 30, prompt: "lived-in: comfortable, personal, surfaces showing use" },
      { id: "settled", label: "Settled", weight: 14, prompt: "settled: well-used home, minor clutter, authentic" },
      { id: "messy", label: "Messy", weight: 4, prompt: "slightly messy: papers on surfaces, cushions pushed aside" },
    ],
    // Grounding details. `weight` is how often one is drawn; `dingy` marks the
    // ones that read as tired when they pile up, and those carry low weights.
    // `rooms` restricts a detail to the scenes it belongs in; `settings` to
    // home or commercial.
    details: [
      { id: "british-socket", label: "British socket", weight: 5, prompt: "A white British-standard 13-amp double socket with red-tipped rocker switches." },
      { id: "conduit", label: "Painted conduit", weight: 1, dingy: true, prompt: "Plastic conduit connecting wall sockets, painted wall-colour but slightly crooked." },
      { id: "light-switch", label: "Light switch", weight: 4, prompt: "A white British wide-rocker light switch by the door." },
      { id: "steel-window", label: "Steel window", weight: 3, prompt: "Steel casement window with slim dark frames, brass handle, old cracked putty." },
      { id: "aluminium-window", label: "Aluminium window", weight: 3, prompt: "Aluminium casement window with silver frames and uneven dried sealant." },
      { id: "wall-scuffs", label: "Wall base scuffs", weight: 1, dingy: true, prompt: "Scuffs around the wall base from furniture and shoes over years." },
      { id: "extension-cable", label: "Extension cable", weight: 1, dingy: true, prompt: "An extension cable running from a wall socket along the baseboard." },
      { id: "pendant", label: "Basic pendant", weight: 3, prompt: "Simple ceiling pendant with a plain shade over the bulb, cord not quite straight." },
      { id: "floor-wear", label: "Floor wear", weight: 1, dingy: true, prompt: "Floor finish slightly worn in front of the shelf: minor scuffs, marks of regular use." },
      { id: "shelf-plants", label: "Plants on shelf", weight: 3, prompt: "Small houseplants in ceramic pots on the shelf, healthy, one leaning toward the window." },
      { id: "floor-plant", label: "Plant on floor", weight: 4, prompt: "Potted plant near shelf base in a terracotta or woven pot, healthy." },
      { id: "sheer-curtains", label: "Sheer + heavy curtains", weight: 4, settings: ["residential"], prompt: "Inner white sheer curtains with heavier outer curtains on a simple rod, gathered slightly unevenly." },
      { id: "ceiling-board", label: "Softboard ceiling", weight: 1, dingy: true, prompt: "White softboard ceiling panels with a visible batten grid, one faint water stain in a corner." },
      { id: "window-grille", label: "Window grille", weight: 4, prompt: "Steel burglar-proofing grille on the window, a simple pattern painted white or the frame colour, in good order." },
      { id: "ceiling-fan", label: "Ceiling fan", weight: 2, prompt: "A white ceiling fan, clean, switched off." },
      { id: "skirting", label: "Painted skirting", weight: 3, prompt: "Painted timber skirting board, clean, the paint slightly built up at the corners." },
      { id: "hardwood-door", label: "Hardwood door", weight: 3, prompt: "A varnished hardwood door and frame, ordinary Nairobi joinery, brass handle." },
      { id: "framed-photos", label: "Framed photos", weight: 3, settings: ["residential"], prompt: "A couple of framed family photographs on the wall or a side table." },
      { id: "wall-calendar", label: "Wall calendar", weight: 2, prompt: "A printed wall calendar from a bank or a supermarket, this year's, hung on a nail." },
      { id: "mosquito-net", label: "Mosquito net", weight: 3, rooms: grown(SLEEP, KIDS), prompt: "A mosquito net tied up in a knot above the bed." },
      { id: "water-dispenser", label: "Water dispenser", weight: 1, rooms: ["kitchen-dining", "office-commercial", "cafe-display", "creative-studio"], prompt: "A water dispenser with a blue bottle in the corner." },
      { id: "tv-corner", label: "TV in the corner", weight: 2, rooms: ["living-room"], prompt: "A flat television on a stand in the corner of the room, switched off." },
      { id: "wall-clock", label: "Wall clock", weight: 2, prompt: "A plain round wall clock." },
      { id: "doormat", label: "Doormat", weight: 3, rooms: ["entryway"], prompt: "A coir doormat inside the door." },
      { id: "notice-board", label: "Notice board", weight: 2, rooms: grown(WORK, ["kitchen-dining", "cafe-display"]), prompt: "A cork notice board with a few pinned papers and a card." },
      { id: "fresh-paint", label: "Fresh paint", weight: 4, prompt: "Walls painted within the year, clean and even, a faint roller texture in raking light." },
      { id: "polished-floor", label: "Polished floor", weight: 3, prompt: "The floor freshly cleaned and polished, faintly reflective near the window." },
    ],
    // Traces of people. Drawn zero to two per image, never the same one twice
    // in a batch. `rooms` is where a trace can plausibly be; `weight` how
    // often. The first seven are the original list and keep their ids.
    humanTraces: [
      { id: "laptop", label: "Laptop open", weight: 2, rooms: grown(WORK, ["living-room", "kitchen-dining", "cafe-display"]), prompt: "A laptop open on a nearby surface, as if someone just stepped away" },
      { id: "glasses", label: "Reading glasses", weight: 2, rooms: grown(LIVING, SLEEP, ["study-nook", "cafe-display", "covered-terrace"]), prompt: "Reading glasses resting on a shelf or nearby table" },
      { id: "phone-cable", label: "Phone charging", weight: 1, rooms: grown(HOME, WORK), prompt: "A phone with a charging cable plugged in, cable slightly messy" },
      { id: "jacket", label: "Jacket on chair", weight: 2, rooms: grown(LIVING, WORK, ["entryway", "cafe-display", "kitchen-dining"]), prompt: "A jacket draped over the arm of a nearby chair" },
      { id: "tote-bag", label: "Tote bag", weight: 1, rooms: grown(LIVING, PUBLIC, ["entryway", "office-commercial"]), prompt: "A canvas tote bag leaning against the wall near the shelf" },
      { id: "book-facedown", label: "Closed book", weight: 2, rooms: grown(LIVING, SLEEP, ["study-nook", "covered-terrace", "cafe-display"]), prompt: "A closed book lying flat on a surface, slightly askew as if recently set down" },
      { id: "headphones", label: "Headphones", weight: 2, rooms: grown(WORK, ["living-room", "bedroom-corner"]), prompt: "Over-ear headphones resting on the shelf or draped over a chair" },
      { id: "mug", label: "Used mug", weight: 3, rooms: grown(HOME, WORK, PUBLIC), prompt: "A used mug on a nearby surface, a faint ring beside it" },
      { id: "thermos", label: "Thermos of tea", weight: 2, rooms: ["living-room", "kitchen-dining", "office-commercial", "creative-studio", "covered-terrace"], prompt: "A steel thermos flask of tea and one cup on a table" },
      { id: "water-bottle", label: "Water bottle", weight: 2, rooms: grown(WORK, ["living-room", "kids-room", "kitchen-dining"]), prompt: "A reusable water bottle on the floor beside a chair" },
      { id: "keys-bowl", label: "Keys in a bowl", weight: 2, rooms: ["entryway", "living-room", "kitchen-dining"], prompt: "House keys dropped in a small bowl or on a surface near the door" },
      { id: "sandals", label: "Sandals by the door", weight: 3, rooms: HOME, prompt: "A pair of sandals or slippers left by the doorway or under a chair" },
      { id: "school-shoes", label: "School shoes", weight: 2, rooms: ["kids-room", "entryway", "living-room"], prompt: "A pair of children's school shoes side by side on the floor" },
      { id: "school-bag", label: "School bag", weight: 2, rooms: ["kids-room", "entryway", "living-room", "kitchen-dining"], prompt: "A child's school bag on the floor against the wall" },
      { id: "crayons", label: "Crayons and a drawing", weight: 3, rooms: ["kids-room", "living-room", "kitchen-dining"], prompt: "A few crayons and a half-finished drawing on a low surface" },
      { id: "bricks-scatter", label: "Building bricks", weight: 3, rooms: ["kids-room", "living-room"], prompt: "A few building bricks on the floor or a low shelf, a game paused rather than tidied" },
      { id: "toy-car", label: "Toy car", weight: 2, rooms: grown(KIDS, ["living-room"]), prompt: "A small toy car parked on the floor or on a low shelf" },
      { id: "soft-toy-down", label: "Soft toy put down", weight: 2, rooms: KIDS, prompt: "A soft toy sitting on the floor or in a chair as if put down mid-play" },
      { id: "child-drawing", label: "Child's drawing on the wall", weight: 2, rooms: ["kids-room", "kitchen-dining", "living-room"], prompt: "A child's drawing taped to the wall at a child's height" },
      { id: "jumper-chair", label: "Jumper on a chair", weight: 2, rooms: grown(HOME, WORK), prompt: "A jumper or cardigan hung on the back of a chair" },
      { id: "kanga-throw", label: "Kanga on a chair", weight: 2, rooms: grown(LIVING, SLEEP, ["kids-room", "covered-terrace"]), prompt: "A folded kanga or kikoy left on the arm of a chair or the end of a bed" },
      { id: "laundry-basket", label: "Laundry basket", weight: 1, rooms: grown(SLEEP, KIDS), prompt: "A laundry basket with folded clothes waiting to be put away" },
      { id: "newspaper", label: "Newspaper", weight: 2, rooms: ["living-room", "kitchen-dining", "cafe-display", "office-commercial", "covered-terrace"], prompt: "A folded newspaper on a table or the arm of a sofa" },
      { id: "remote", label: "TV remote", weight: 2, rooms: ["living-room"], prompt: "A TV remote on a cushion or side table" },
      { id: "notebook-pen", label: "Notebook and pen", weight: 2, rooms: grown(WORK, ["living-room", "kitchen-dining", "cafe-display"]), prompt: "An open notebook with a pen laid across it on a desk or table" },
      { id: "teapot", label: "Teapot and cup", weight: 2, rooms: ["kitchen-dining", "living-room", "cafe-display", "covered-terrace"], prompt: "A teapot or cafetiere and one cup on a table" },
      { id: "fruit-bowl", label: "Fruit bowl", weight: 2, rooms: ["kitchen-dining", "living-room"], prompt: "A bowl of fruit on the table" },
      { id: "shopping-basket", label: "Shopping set down", weight: 2, rooms: ["entryway", "kitchen-dining"], prompt: "A woven shopping basket set down by the door, not yet unpacked" },
      { id: "umbrella", label: "Umbrella by the door", weight: 1, rooms: ["entryway", "office-commercial", "cafe-display"], prompt: "An umbrella leaning by the door" },
      { id: "helmet", label: "Cycling helmet", weight: 1, rooms: ["entryway", "office-commercial", "creative-studio"], prompt: "A cycling helmet on a hook or a surface" },
      { id: "glass-water", label: "Glass of water", weight: 3, rooms: grown(HOME, WORK), prompt: "A half-finished glass of water on a side table" },
      { id: "cushion-dent", label: "Dented cushion", weight: 2, rooms: LIVING, prompt: "A cushion dented where someone was just sitting" },
      { id: "bed-loose", label: "Bed made loosely", weight: 2, rooms: grown(SLEEP, ["kids-room"]), prompt: "A bed made loosely, the cover pulled up but not smoothed" },
      { id: "sketch-taped", label: "Sketch on the wall", weight: 2, rooms: WORK, prompt: "A sketch or print-out taped to the wall beside the desk" },
      { id: "tools-out", label: "Tools left out", weight: 2, rooms: ["creative-studio", "office-commercial"], prompt: "A tape measure or a pair of scissors left out on the worktable" },
      { id: "note-pinned", label: "Note under a magnet", weight: 1, rooms: ["kitchen-dining", "office-commercial", "cafe-display", "retail-boutique"], prompt: "A receipt or a note pinned under a magnet or tucked into a frame" },
      { id: "watering-can", label: "Watering can", weight: 1, rooms: grown(HOME, ["cafe-display"]), prompt: "A small watering can or spray bottle beside the plants" },
      { id: "bag-on-hook", label: "Bag on a hook", weight: 2, rooms: ["entryway", "office-commercial", "bedroom-corner", "creative-studio"], prompt: "A handbag or backpack hanging from a hook or a chair" },
      { id: "hat", label: "Hat on a hook", weight: 1, rooms: ["entryway", "living-room", "covered-terrace"], prompt: "A cap or sun hat on a hook or a surface" },
      { id: "board-game", label: "Board game out", weight: 1, rooms: ["living-room", "kids-room"], prompt: "A board game or a pack of cards left out on the table" },
      { id: "baby-bottle", label: "Baby bottle", weight: 3, rooms: ["nursery"], prompt: "A baby bottle and a muslin cloth on a surface" },
      { id: "changing-bag", label: "Changing bag", weight: 1, rooms: ["nursery", "entryway"], prompt: "A changing bag by the door" },
      { id: "homework", label: "Homework out", weight: 2, rooms: ["kids-room", "kitchen-dining", "living-room"], prompt: "Homework books and a pencil case left on the table" },
      { id: "football", label: "Football", weight: 2, rooms: ["kids-room", "entryway", "covered-terrace"], prompt: "A football on the floor" },
      { id: "takeaway-cup", label: "Takeaway cup", weight: 2, rooms: ["office-commercial", "creative-studio", "cafe-display"], prompt: "A takeaway coffee cup on a desk" },
      { id: "price-card", label: "Handwritten price card", weight: 2, rooms: PUBLIC, prompt: "A small handwritten price card beside the goods" },
      { id: "phone-facedown", label: "Phone face down", weight: 2, rooms: grown(HOME, WORK), prompt: "A phone face down on a table, not charging" },
    ],
  };

  // ────────────────────────────────────────────────────────────────── POOLS ──
  //
  // The sequential draw: a room is chosen, then what is in it. These say what
  // fits which room. brief.js does the drawing.
  const POOLS = {
    // Persona weights per scene. A room not listed here draws from `default`.
    personaByScene: {
      default: { reader: 3, collector: 2, minimalist: 2, "plant-parent": 2, creative: 1, auto: 1 },
      "living-room": { reader: 3, collector: 3, minimalist: 2, "plant-parent": 2, parent: 1, auto: 1 },
      "study-nook": { creative: 3, reader: 3, minimalist: 2, auto: 1 },
      "library-wall": { reader: 6, collector: 2 },
      "wall-niche": { reader: 3, collector: 3, minimalist: 2, "plant-parent": 1 },
      "bedroom-corner": { reader: 3, minimalist: 3, "plant-parent": 1, auto: 1 },
      "bedroom-wardrobe": { auto: 4, minimalist: 2 },
      "kids-room": { parent: 6, creative: 1, minimalist: 1 },
      nursery: { parent: 6, minimalist: 2 },
      "kitchen-dining": { auto: 3, collector: 2, "plant-parent": 2, reader: 1 },
      entryway: { auto: 3, minimalist: 2, "plant-parent": 1, collector: 1 },
      "covered-terrace": { "plant-parent": 4, auto: 2, reader: 1 },
      "office-commercial": { auto: 3, creative: 2, reader: 2, minimalist: 1 },
      "cafe-display": { auto: 3, collector: 3, "plant-parent": 1 },
      "retail-boutique": { collector: 4, auto: 2, minimalist: 1 },
      "creative-studio": { creative: 6, collector: 1, auto: 1 },
    },
    // How many traces and details a scene gets. Zero traces is a real outcome:
    // a well kept room often has none on show.
    traceCount: { 0: 25, 1: 45, 2: 30 },
    detailCount: { 1: 55, 2: 45 },
    // Chance that a dingy detail is allowed into the draw at all, on top of
    // its own low weight. Two independent throttles, because one was not
    // enough to stop a scuff appearing in most pictures.
    dingyChance: 0.35,
  };

  // The flat table everything reads. CONFIG.light, CONFIG.negativePrompt and
  // so on keep working exactly as before; INVARIANTS and VARIABLES are the
  // same objects, reachable by kind as well.
  const CONFIG = Object.assign({}, VARIABLES, INVARIANTS);

  // ───────────────────────────────────────────────────────────── ARCHETYPES ──
  //
  // Coherent, Nairobi-true starting points. Each is a written place (the
  // paragraph is what makes a scene coherent, much stronger than fragments)
  // plus the fixed params that describe it. `rooms` are the scenes the place
  // can host, with weights. `pools` adjusts the draw for this place: a light
  // distribution of its own, and traces or details it favours (drawn at
  // double weight) or never shows.
  //
  // What an archetype deliberately does NOT fix any more: light, human
  // traces, grounding details. See the header.
  const ARCHETYPES = [
    {
      id: "kilimani-bright",
      name: "Kilimani new-build",
      blurb: "Bright young-professional apartment",
      weight: 3,
      place: `A bright living room in a newer Kilimani apartment block. Smooth white-painted walls; large-format light grey porcelain floor tiles with thin grout lines. Floor-to-ceiling aluminium sliding windows with white sheer curtains half drawn; through the glass, the balconies of a neighbouring block and the crown of a jacaranda tree. Furniture is minimal and newish, a low fabric sofa, a light-wood side table, warmed by one woven sisal basket and a potted plant. A young professional's rental: clean, slightly sparse, genuinely bright.`,
      params: { scene:"living-room", settingType:"residential", wall:"soft-white", floor:"large-tile", rug:"sisal-jute", furniture:"minimal-modern", windowView:"apartments-trees", colourMood:"bright-airy", camera:"pro", framing:"considered", persona:"minimalist", fullness:"light", livedIn:"tidy" },
      rooms: { "living-room": 4, "study-nook": 2, "bedroom-corner": 2, "bedroom-wardrobe": 1, entryway: 1, "kids-room": 2, nursery: 1, "kitchen-dining": 2, "wall-niche": 1 },
      pools: { livedIn: { tidy: 30, "well-kept": 45, "lived-in": 20, settled: 5 }, details: ["aluminium-window", "sheer-curtains", "fresh-paint", "polished-floor"], exclude: ["conduit", "ceiling-board", "steel-window"] },
    },
    {
      id: "westlands-parquet",
      name: "Older Westlands flat",
      blurb: "1970s block, parquet + steel windows",
      weight: 3,
      place: `The sitting room of a 1970s Westlands flat that has been loved for decades. Herringbone wood parquet floor worn to a soft sheen along the walking lines. Warm cream plastered walls with faint trowel texture. Steel casement windows with slim dark frames and brass handles, old putty at the glass; outside, mature trees and a slice of a neighbour's roof. The furniture is an honest mix, an inherited hardwood sideboard, a newer sofa, a flat-woven kilim, collected over years rather than decorated.`,
      params: { scene:"living-room", settingType:"residential", wall:"warm-cream", floor:"herringbone", rug:"kilim", furniture:"eclectic", windowView:"apartments-trees", colourMood:"warm-wood", camera:"entry-camera", framing:"casual", persona:"reader", fullness:"moderate", livedIn:"lived-in" },
      rooms: { "living-room": 4, "library-wall": 3, "kitchen-dining": 2, "wall-niche": 2, "study-nook": 2, "bedroom-corner": 2 },
      pools: { light: { "flat-overcast": 12, "soft-cloudy": 28, "bright-soft": 26, "bright-hard": 22, golden: 6, "evening-lamps": 5, night: 1 }, details: ["steel-window", "framed-photos", "wall-clock"], humanTraces: ["glasses", "book-facedown", "newspaper"], exclude: ["aluminium-window"] },
    },
    {
      id: "karen-garden",
      name: "Karen garden house",
      blurb: "Bungalow facing deep green garden",
      weight: 2,
      place: `A garden-facing room in a Karen bungalow. Wide-plank wooden floor; walls a muted warm cream. Large windows and a glazed door open toward a deep green garden: bougainvillea, mature trees, proper Nairobi-suburb green. Comfortable substantial furniture, a cowhide rug, handmade ceramics and plants; a room owned by people who spend their weekends at home.`,
      params: { scene:"living-room", settingType:"residential", wall:"warm-cream", floor:"wide-plank", rug:"cowhide", furniture:"african-contemporary", windowView:"green-garden", colourMood:"warm-wood", camera:"pro", framing:"considered", persona:"plant-parent", fullness:"moderate", livedIn:"lived-in" },
      rooms: { "living-room": 4, "library-wall": 2, "covered-terrace": 3, "kitchen-dining": 2, "bedroom-corner": 2, "kids-room": 2, nursery: 1 },
      pools: { light: { "flat-overcast": 10, "soft-cloudy": 26, "bright-soft": 30, "bright-hard": 18, golden: 10, "evening-lamps": 5, night: 1 }, details: ["floor-plant", "shelf-plants", "steel-window", "hardwood-door"], humanTraces: ["kanga-throw", "watering-can", "sandals"], exclude: ["conduit", "extension-cable"] },
    },
    {
      id: "south-b-family",
      name: "South B family home",
      blurb: "Lived-in maisonette, cement tile",
      weight: 3,
      place: `A family sitting room in a South B maisonette. Patterned cement tile floor in a slightly faded geometric design. Pale walls repainted a few years ago. Heavy outer curtains flank sheer inner ones; framed prints on the wall, a doily under a vase, a TV in the corner of the room's life. Comfortable, busy, unmistakably a real Nairobi family home.`,
      params: { scene:"living-room", settingType:"residential", wall:"warm-cream", floor:"patterned-cement", rug:"solid-wool", furniture:"eclectic", windowView:"apartments-trees", colourMood:"earthy-muted", camera:"decent-phone", framing:"casual", persona:"parent", fullness:"full", livedIn:"settled" },
      rooms: { "living-room": 4, "kids-room": 3, nursery: 2, "kitchen-dining": 3, entryway: 2, "bedroom-corner": 2 },
      pools: { light: { "flat-overcast": 14, "soft-cloudy": 28, "bright-soft": 28, "bright-hard": 14, golden: 5, "evening-lamps": 9, night: 2 }, livedIn: { tidy: 10, "well-kept": 35, "lived-in": 30, settled: 20, messy: 5 }, details: ["sheer-curtains", "framed-photos", "wall-calendar", "tv-corner", "window-grille"], humanTraces: ["school-shoes", "school-bag", "crayons", "thermos", "sandals"] },
    },
    {
      id: "makers-studio",
      name: "Makers' studio",
      blurb: "Light-industrial workspace",
      weight: 1,
      place: `A working creative studio in a converted light-industrial space off Mombasa Road. Smooth grey cement screed floor marked by years of use; painted masonry walls, white but not precious, with pin holes and patched spots. Big steel-framed windows with slightly dusty glass; a large worktable; tools, sketchbooks, rolls of paper and prototypes occupy surfaces; the ceiling is open with visible trusses. Honest and functional: everything in the room earns its place.`,
      params: { scene:"creative-studio", settingType:"commercial", wall:"soft-white", floor:"polished-concrete", rug:"auto", furniture:"industrial", windowView:"rooftop-city", colourMood:"stone-pops", camera:"entry-camera", framing:"considered", persona:"creative", fullness:"moderate", livedIn:"lived-in" },
      rooms: { "creative-studio": 4, "study-nook": 1, "office-commercial": 2 },
      pools: { light: { "flat-overcast": 16, "soft-cloudy": 24, "bright-soft": 20, "bright-hard": 32, golden: 4, "evening-lamps": 3, night: 1 }, livedIn: { tidy: 10, "well-kept": 20, "lived-in": 40, settled: 25, messy: 5 }, details: ["steel-window", "notice-board", "floor-wear"], humanTraces: ["tools-out", "sketch-taped", "takeaway-cup", "headphones"], exclude: ["sheer-curtains", "framed-photos", "mosquito-net"] },
    },
    {
      id: "staged-bright",
      name: "Staged & bright",
      blurb: "Commercial-clean new-build, the ad-ready end",
      weight: 1,
      place: `A bright, carefully staged room in a brand-new Nairobi apartment, prepared for photography. Crisp white walls, light large-format floor tiles, sheer curtains diffusing generous daylight into an even, flattering glow. Styling is minimal and deliberate: one or two plants, a neutral rug, a few well-chosen objects. Clean and composed, the commercial end of the spectrum, yet still reading as a real Nairobi apartment with real light, never a sterile 3D render.`,
      params: { scene:"living-room", settingType:"residential", wall:"soft-white", floor:"large-tile", rug:"solid-wool", furniture:"minimal-modern", windowView:"open-sky", colourMood:"bright-airy", camera:"pro", framing:"professional", persona:"minimalist", fullness:"light", livedIn:"tidy" },
      rooms: { "living-room": 4, "wall-niche": 2, "bedroom-corner": 2, "office-commercial": 1, "kids-room": 1 },
      pools: { light: { "flat-overcast": 10, "soft-cloudy": 40, "bright-soft": 45, "bright-hard": 5 }, livedIn: { tidy: 60, "well-kept": 40 }, traceCount: { 0: 60, 1: 40 }, details: ["sheer-curtains", "fresh-paint", "polished-floor"], exclude: ["conduit", "wall-scuffs", "extension-cable", "floor-wear", "ceiling-board", "wall-calendar"] },
    },
    {
      id: "cafe-corner",
      name: "Café corner",
      blurb: "Independent Nairobi café",
      weight: 1,
      place: `A corner of an independent Nairobi café. Smooth cement floor; timber tables with mismatched chairs; somewhere behind, a counter with a hand-chalked menu board. Simple shaded pendant lights hang from a high ceiling. Big windows bring in the street: a tree, a parked motorbike, passers-by implied rather than shown. Potted plants soften the corners. The shelf works for the space: crockery, retail products, plants, cookbooks.`,
      params: { scene:"cafe-display", settingType:"commercial", wall:"warm-cream", floor:"polished-concrete", rug:"auto", furniture:"eclectic", windowView:"apartments-trees", colourMood:"warm-wood", camera:"entry-camera", framing:"considered", persona:"collector", fullness:"full", livedIn:"tidy" },
      rooms: { "cafe-display": 4, "retail-boutique": 2, "office-commercial": 1 },
      pools: { light: { "flat-overcast": 14, "soft-cloudy": 30, "bright-soft": 32, "bright-hard": 14, golden: 4, "evening-lamps": 5, night: 1 }, details: ["pendant", "notice-board", "floor-plant"], humanTraces: ["price-card", "takeaway-cup", "newspaper", "mug"], exclude: ["sheer-curtains", "framed-photos", "mosquito-net"] },
    },
  ];
  CONFIG.archetypes = ARCHETYPES;

  // Controls decide which option groups appear in the UI.
  // type: "select" means one choice; type: "multi" means several chips can be on.
  // cfgKey points to one of the option groups above.
  // group controls where it appears in the Recipe editor.
  const PARAMS = [
    {id:"shotType",  label:"Shot type",  group:"shot", type:"select", cfgKey:"shotTypes"},
    {id:"productBackground", label:"Background", group:"shot", type:"select", cfgKey:"productBackgrounds"},
    {id:"settingType",label:"Setting",   group:"shot", type:"select", cfgKey:"settingTypes"},
    {id:"scene",     label:"Room / space", group:"shot", type:"select", cfgKey:"scenes", nameKey:"name"},
    {id:"wall",      label:"Walls",      group:"place", type:"select", cfgKey:"walls"},
    {id:"floor",     label:"Floor",      group:"place", type:"select", cfgKey:"floors"},
    {id:"rug",       label:"Rug",        group:"place", type:"select", cfgKey:"rugs"},
    {id:"furniture", label:"Furniture",  group:"style", type:"select", cfgKey:"furniture"},
    {id:"windowView",label:"Window",     group:"style", type:"select", cfgKey:"windowView"},
    {id:"colourMood",label:"Colour Mood",group:"style", type:"select", cfgKey:"colourMood"},
    {id:"persona",   label:"Shelf objects", group:"feel", type:"select", cfgKey:"persona", nameKey:"label"},
    {id:"fullness",  label:"Fullness",   group:"feel", type:"select", cfgKey:"fullness"},
    {id:"livedIn",   label:"Lived-in",   group:"feel", type:"select", cfgKey:"livedIn"},
    {id:"camera",    label:"Camera",     group:"photo", type:"select", cfgKey:"camera"},
    {id:"framing",   label:"Composition",group:"photo", type:"select", cfgKey:"framing"},
    {id:"light",     label:"Light",      group:"photo", type:"select", cfgKey:"light"},
    {id:"details",   label:"Details",    group:"details", type:"multi", cfgKey:"details"},
    {id:"humanTraces",label:"Human Traces",group:"traces", type:"multi", cfgKey:"humanTraces"},
  ];
  const ROOM_GROUPS = {
    residential: ["living-room","study-nook","library-wall","wall-niche","bedroom-corner","bedroom-wardrobe","kids-room","nursery","kitchen-dining","entryway","covered-terrace"],
    commercial: ["office-commercial","cafe-display","retail-boutique","creative-studio"],
  };

  // Defaults are what a fresh session starts with before you press a preset,
  // Suggest details or manual controls.
  const DEFAULTS = Object.fromEntries(PARAMS.map(p=>
    [p.id, p.type==="multi"?[]:(p.cfgKey==="scenes"?"living-room":p.id==="shotType"?"use":p.id==="productBackground"?"warm-wall-floor":p.id==="settingType"?"residential":"auto")]
  ));
  DEFAULTS.customNotes = "";
  DEFAULTS.archetype = null;
  DEFAULTS.aspect = "match";
  DEFAULTS.fullness = "moderate";
  DEFAULTS.livedIn = "lived-in";
  DEFAULTS.details = ["british-socket"];

  // Refinement sliders are intentionally separate from the full generation
  // prompt. They tell the model how to edit an existing image.
  const REFINE_CATS = [{id:"camera",label:"Camera"},{id:"lighting",label:"Lighting"},{id:"composition",label:"Composition"},{id:"details",label:"Details"},{id:"contents",label:"Shelf Contents"},{id:"foldstack",label:"Folded/Stacked"},{id:"overall",label:"Overall"}];
  const REFINE_LVLS = [{v:-2,l:"--"},{v:-1,l:"-"},{v:0,l:"="},{v:1,l:"+"},{v:2,l:"++"}];
  const REFINE_QUAL = {
    camera:{n:"more amateur, noisy, auto-mode",p:"cleaner, better lens, professional"},
    lighting:{n:"flatter, duller, less dramatic",p:"more pleasing, intentional, well-balanced"},
    composition:{n:"more casual, off-center",p:"better framed, rule-of-thirds"},
    details:{n:"messier, more imperfect",p:"cleaner, tidier, more pristine"},
    contents:{
      n1:"shelf contents and objects on surfaces should look more casually placed: slight gaps between items, a book pulled partway out, objects not perfectly centred on shelves, one or two items at slight angles. Less curated, more like someone actually uses this space",
      n2:"shelf contents and objects on surfaces should look naturally scattered: uneven spacing, items pushed aside, a few things at odd angles, some items partially obscured by others. Like someone lives here and doesn't style their shelves",
      p:"shelf and surface contents more deliberately arranged: better visual balance, intentional groupings, objects aligned and evenly spaced"
    },
    foldstack:{
      n1:"any folded items (towels, blankets, clothes) should look like a normal person folded them: slightly uneven edges, not perfect rectangles, soft fabric drape visible, a corner slightly lifted or tucked unevenly. Stacked items (books, boxes) should not have perfectly aligned edges: a few offset by 1-2cm, one or two leaning against the side of a stack rather than on top. Still tidy, just not machine-perfect",
      n2:"folded items should look more draped or loosely piled than folded: a blanket tossed over an arm, a towel casually hung not squared off, clothes in a soft heap rather than crisp rectangles. Stacked items can be loosely piled: uneven, some tilting, a couple slid partway out. Not messy, just unstaged",
      p:"folded and stacked items neater and more precise: clean edges, aligned stacks, crisp folds"
    },
    overall:{n:"rawer, grittier, unedited",p:"more commercially usable and finished, without changing product geometry or material"},
  };
  const DEFAULT_REFINE = Object.fromEntries(REFINE_CATS.map(c=>[c.id,0]));
  // "match" is not a ratio: it resolves at generation time to whichever of the
  // fixed ratios the source image is closest to. Asking for the source's own
  // shape makes the job an edit rather than a re-shoot, which is half of what
  // keeps the reference's perspective. See viewpointPrompt for the other half.
  const ASPECTS = [{id:"match",l:"Match source"},{id:"4:3",l:"4:3"},{id:"4:5",l:"4:5"},{id:"1:1",l:"1:1"},{id:"9:16",l:"9:16"},{id:"16:9",l:"16:9"}];
  const RECIPE_GROUPS = [
    {id:"shot",label:"Shot",kind:"single",keys:["shotType","productBackground","settingType","scene"]},
    {id:"place",label:"Place",kind:"single",keys:["wall","floor","rug"]},
    {id:"style",label:"Style",kind:"single",keys:["furniture","windowView","colourMood"]},
    {id:"feel",label:"Objects + feel",kind:"single",keys:["persona","fullness","livedIn"]},
    {id:"photo",label:"Photo",kind:"single",keys:["camera","framing","light"]},
    {id:"details",label:"Details",kind:"multi",keys:["details"]},
    {id:"traces",label:"Human Traces",kind:"multi",keys:["humanTraces"]},
  ];

  const REFINE_PRESETS = [
    {id:"less-staged",label:"Less staged",feedback:"Make this feel less staged and more like a real Nairobi home. Keep the shelf geometry, color, material, and proportions exact.",adj:{details:-1,contents:-1,foldstack:-1,overall:-1}},
    {id:"more-life",label:"More life",feedback:"Add subtle signs of use and human presence around the scene without cluttering or changing the shelf.",adj:{details:-1,contents:-1,overall:-1}},
    {id:"cleaner",label:"Cleaner",feedback:"Make the image cleaner and more commercially useful while keeping the room believable and the shelf exact.",adj:{details:1,lighting:1,composition:1,overall:1}},
    {id:"product",label:"Product exact",feedback:"Correct any drift in shelf geometry, frame color, shelf material, scale, or joint details. The product must match the reference.",adj:{composition:1,details:1,overall:1}}
  ];

  window.PROMPT_CONFIG = {
    CONFIG,
    INVARIANTS,
    VARIABLES,
    POOLS,
    ARCHETYPES,
    PARAMS,
    ROOM_GROUPS,
    DEFAULTS,
    REFINE_CATS,
    REFINE_LVLS,
    REFINE_QUAL,
    DEFAULT_REFINE,
    ASPECTS,
    RECIPE_GROUPS,
    REFINE_PRESETS,
  };
})();
