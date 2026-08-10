// Prompt ingredients for the Framework image generator.
//
// Edit this file when you want to change:
// - button names and prompt text
// - which controls appear in the app
// - default selections
// - recipe controls and refinement sliders
//
// Each option usually has:
// - id: stable internal name used in saved sessions
// - label/name: button text shown in the app
// - prompt/contents: text added to the AI prompt when selected

(() => {
  // Option groups are the source menu items. Add/edit entries here when you
  // want a new wall type, room type, camera style, reality detail, etc.
  //
  // For most entries:
  // - id is the saved-session value. Keep existing ids stable.
  // - label or name is the button text.
  // - prompt is the text added to the AI prompt when selected.
  // - contents is used by shelf-content personas.
  const CONFIG = {
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
      { id: "study-nook", name: "Study / Home Office", prompt: "A home study corner with a simple desk, a laptop and mug on it, a desk chair, a window with a sheer curtain" },
      { id: "library-wall", name: "Home Library Wall", prompt: "A reading area with a comfortable armchair, a throw blanket draped over its arm, and a separate floor lamp set away from the shelf" },
      { id: "wall-niche", name: "Wall Niche / Alcove", prompt: "A recessed wall niche or alcove, the shelf fitted into the rectangular recess, appearing integrated" },
      { id: "bedroom-corner", name: "Bedroom Corner", prompt: "A bedroom corner with the edge of a bed with linen visible, a separate bedside lamp away from the shelf, a window with a sheer curtain" },
      { id: "bedroom-wardrobe", name: "Bedroom — Open Wardrobe", prompt: "A bedroom where the shelf is used as an open wardrobe, a full-length mirror leaning against the adjacent wall" },
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
      { id: "red-oxide", label: "Red oxide", prompt: "Polished red-oxide cement floor, deep rust red, smooth with decades of sheen — classic Kenyan" },
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
      { id: "dense-tropical", label: "Dense tropical", prompt: "Through windows: dense tropical vegetation — banana leaves, palms, creepers" },
      { id: "rooftop-city", label: "Rooftop / city", prompt: "Through windows: Nairobi rooftops and city skyline" },
    ],
    colourMood: [
      { id: "auto", label: "Auto" },
      { id: "high-contrast", label: "High contrast", prompt: "COLOUR MOOD: High contrast — deep blacks and bright highlights, dramatic tonal range" },
      { id: "cool-pops", label: "Cool + pops", prompt: "COLOUR MOOD: Cool palette — whites, greys, soft blues, punctuated by warm accent colours" },
      { id: "warm-wood", label: "Warm wood", prompt: "COLOUR MOOD: Warm natural wood dominates — amber, honey, walnut. Cozy golden undertones" },
      { id: "green-natural", label: "Green & natural", prompt: "COLOUR MOOD: Natural greens — indoor plants, botanical elements, organic and fresh" },
      { id: "stone-pops", label: "Stone + pops", prompt: "COLOUR MOOD: Cool stone and concrete base palette with carefully placed colour pops" },
      { id: "bright-airy", label: "Bright & airy", prompt: "COLOUR MOOD: Predominantly white and pale tones, maximum natural light, spacious" },
      { id: "moody-dark", label: "Moody & dark", prompt: "COLOUR MOOD: Deep dark tones, pools of warm light against rich shadows, intimate" },
      { id: "earthy-muted", label: "Earthy & muted", prompt: "COLOUR MOOD: Ochres, terracotta, olive, burnt sienna — desert-palette warmth" },
    ],
    camera: [
      { id: "auto", label: "Auto" },
      { id: "phone-snap", label: "Phone snapshot", prompt: "CAMERA: Cheap phone. Auto-exposure blows highlights. No depth of field. Visible noise. NOT professional." },
      { id: "decent-phone", label: "Decent phone", prompt: "CAMERA: Recent smartphone. Computational portrait-mode bokeh. Over-sharpened. Minor HDR look." },
      { id: "entry-camera", label: "Entry camera", prompt: "CAMERA: Consumer DSLR with kit zoom. Clean, low noise. Decent depth of field. Competent." },
      { id: "pro", label: "Professional", prompt: "CAMERA: Full-frame with prime lens at f/2.8-f/4. Beautiful natural bokeh. Rich shadows." },
    ],
    framing: [
      { id: "auto", label: "Auto" },
      { id: "snapshot", label: "Snapshot", prompt: "FRAMING: No composition. Standing eye-height. Shelf off-center and tilted. Too much empty space." },
      { id: "casual", label: "Casual", prompt: "FRAMING: Roughly centered but imperfect. Standing height, mostly level." },
      { id: "considered", label: "Considered", prompt: "FRAMING: Approximate rule of thirds. Level horizon. Some leading lines." },
      { id: "professional", label: "Professional", prompt: "FRAMING: Expert rule-of-thirds. Deliberate leading lines. Optimal angle." },
    ],
    light: [
      { id: "auto", label: "Auto" },
      { id: "flat-overcast", label: "Flat overcast", prompt: "LIGHT: Flat even light from overcast sky. No directional shadows. Slightly cool." },
      { id: "soft-cloudy", label: "Soft cloudy", prompt: "LIGHT: Diffused daylight, slightly warm. Soft shadows with gradual edges." },
      { id: "bright-soft", label: "Bright, soft shadows", prompt: "LIGHT: Strong daylight diffused through sheers. Bright and well-lit, shadows soft-edged." },
      { id: "bright-hard", label: "Bright, hard shadows", prompt: "LIGHT: Direct equatorial sun. Distinct light patches. High contrast. Crisp shadow edges." },
      { id: "golden", label: "Golden hour", prompt: "LIGHT: Warm golden light at low angle. Rich amber tones. Long, soft shadows." },
      { id: "evening-lamps", label: "Evening lamps", prompt: "LIGHT: Warm artificial light from fixtures and lamps. Mixed with dim dusk. Cozy." },
      { id: "night", label: "Night", prompt: "LIGHT: Room lighting only. Warm pools of light, dark corners. No natural light." },
    ],
    persona: [
      { id: "auto", label: "None / Auto", contents: "" },
      { id: "reader", label: "The Reader", contents: "books stacked horizontally and vertically, a small framed photo, perhaps a separate reading lamp nearby but not mounted on the shelf" },
      { id: "collector", label: "The Collector", contents: "travel souvenirs, ceramics, a small sculpture, a vintage clock, decorative objects" },
      { id: "minimalist", label: "The Minimalist", contents: "three deliberately placed objects — one vase, one succulent, one stack of books. Generous space." },
      { id: "parent", label: "The Parent", contents: "children's picture books, a stuffed toy, a family photo, colourful storage boxes" },
      { id: "creative", label: "The Creative", contents: "art supplies, sketchbooks, ink bottles, reference books, a camera" },
      { id: "plant-parent", label: "Plant Parent", contents: "multiple small potted plants, propagation jars, one trailing plant with hanging vines" },
    ],
    fullness: [
      { id: "empty", label: "Empty", prompt: "completely empty" },
      { id: "sparse", label: "Sparse", prompt: "very sparse — 1-2 items" },
      { id: "light", label: "Light", prompt: "lightly filled with breathing room" },
      { id: "moderate", label: "Moderate", prompt: "moderately filled, curated" },
      { id: "full", label: "Full", prompt: "well-filled and intentional while keeping shelf edges, front tubes, legs, and tier spacing visible" },
      { id: "packed", label: "Packed", prompt: "densely stocked, near capacity, but with the shelf structure still clearly visible and not hidden behind objects" },
    ],
    livedIn: [
      { id: "showroom", label: "Showroom", prompt: "showroom condition — pristine, deliberately staged" },
      { id: "tidy", label: "Tidy", prompt: "fresh and tidy — clean but with minor signs of life" },
      { id: "lived-in", label: "Lived-in", prompt: "lived-in — comfortable, personal, surfaces showing use" },
      { id: "settled", label: "Settled", prompt: "settled — well-used home, minor clutter, authentic" },
      { id: "messy", label: "Messy", prompt: "slightly messy — papers on surfaces, cushions pushed aside" },
    ],
    details: [
      { id: "british-socket", label: "British socket", prompt: "A white British-standard 13-amp double socket with red-tipped rocker switches." },
      { id: "conduit", label: "Painted conduit", prompt: "Plastic conduit connecting wall sockets, painted wall-colour but slightly crooked." },
      { id: "light-switch", label: "Light switch", prompt: "A white British wide-rocker light switch with a faint dust outline." },
      { id: "steel-window", label: "Steel window", prompt: "Steel casement window with slim dark frames, brass handle, old cracked putty." },
      { id: "aluminium-window", label: "Aluminium window", prompt: "Aluminium casement window with silver frames and uneven dried sealant." },
      { id: "wall-scuffs", label: "Wall base scuffs", prompt: "Scuffs around the wall base from furniture and shoes over years." },
      { id: "extension-cable", label: "Extension cable", prompt: "An extension cable running from a wall socket along the baseboard." },
      { id: "pendant", label: "Basic pendant", prompt: "Simple ceiling pendant with a plain shade over the bulb, cord not quite straight." },
      { id: "floor-wear", label: "Floor wear", prompt: "Floor finish slightly worn in front of the shelf — minor scuffs, marks of regular use." },
      { id: "shelf-plants", label: "Plants on shelf", prompt: "Small houseplants in ceramic pots on the shelf, a couple yellowing lower leaves." },
      { id: "floor-plant", label: "Plant on floor", prompt: "Potted plant near shelf base in terracotta pot, mostly healthy but a few yellowing leaves." },
      { id: "sheer-curtains", label: "Sheer + heavy curtains", prompt: "Inner white sheer curtains with heavier outer curtains on a simple rod, gathered slightly unevenly." },
      { id: "ceiling-board", label: "Softboard ceiling", prompt: "White softboard ceiling panels with a visible batten grid, one faint water stain in a corner." },
    ],
    humanTraces: [
      { id: "laptop", label: "Laptop open", prompt: "A laptop open on a nearby surface, as if someone just stepped away" },
      { id: "glasses", label: "Reading glasses", prompt: "Reading glasses resting on a shelf or nearby table" },
      { id: "mug", label: "Mug of tea", prompt: "A ceramic mug of tea or coffee on a surface" },
      { id: "phone-cable", label: "Phone charging", prompt: "A phone with a charging cable plugged in, cable slightly messy" },
      { id: "jacket", label: "Jacket on chair", prompt: "A jacket draped over the arm of a nearby chair" },
      { id: "tote-bag", label: "Tote bag", prompt: "A canvas tote bag leaning against the wall near the shelf" },
      { id: "book-facedown", label: "Closed book", prompt: "A closed book lying flat on a surface, slightly askew as if recently set down" },
      { id: "headphones", label: "Headphones", prompt: "Over-ear headphones resting on the shelf or draped over a chair" },
    ],
    referenceRolePrompt: `PRODUCT REFERENCE ROLE:
  - The attached shelf photo is product truth, not loose inspiration.
  - Priority order is: shelf geometry, material, colour, joints, tier count, and scale first; scene, styling, objects, and mood second.
  - If any room, styling, or object instruction conflicts with product fidelity, ignore that conflicting instruction and preserve the shelf.`,
    preservationPrompt: `CRITICAL CONSTRAINTS — DO NOT VIOLATE:
  - The shelf's geometry must match the reference photo EXACTLY: same number of tiers, same proportions, same spacing
  - The shelf must be up against the wall (within 2cm) unless specified otherwise
  - Steel frame colour and powder-coat finish must match the reference precisely
  - Do NOT add features not in the reference: no LED strips, no lighting, no brackets, no glass panels, no wooden shelves, no drawers, no doors
  - Do NOT attach or integrate lighting into the shelf. If a lamp appears in the surrounding room, it must be a separate ordinary room lamp, never part of the shelf.
  - Do NOT show open books. Any book lying on a shelf, sofa, table, or floor must be closed.
  - Books must obey simple physics: vertical books need support from a shelf side, a post, bookends, a heavy object, or a horizontal stack; no unsupported freestanding books.
  - Pendant lights should have a simple shade over the bulb. Do not show bare-bulb pendant lights unless the user explicitly asks for one.
  - Maintain modular steel tube construction — powder-coated steel tubes and flat steel shelves with visible bolt connections
  - Realistic scale relative to surrounding furniture and doorways
  - Preserve exact metalwork joint style — simple bolt-through connections
  - Keep the shelf readable: front vertical tubes, legs, shelf edges, bolt points, and tier gaps must remain visible`,
    negativePrompt: `DO NOT include: strip lights, LED lighting, clamp-on lamps attached to the shelf, changed shelf count, altered shelf spacing, thickened tubes, curved or decorative frame, glass shelves, wooden shelves, drawers, doors, cabinets, decorative brackets, branding, logos, price tags, floating shelves, wall-mounted panels, perfect magazine-style staging, open books, unsupported freestanding books, bare-bulb pendant lights unless explicitly requested by the user`,

    // The photographic floor: authenticity may come from the place and its
    // contents, never from bad photography. Always appended to scene prompts.
    craftFloorPrompt: `PHOTOGRAPHIC FLOOR — non-negotiable regardless of how casual or lived-in the scene is:
  - The shelf is the clear subject: fully visible, well lit, in focus, not blocked by furniture or clutter.
  - Verticals straight or near-straight; horizon level or nearly level; composition balanced.
  - Exposure correct, colours harmonious with the room's palette.
  - Realism must come from the place, its objects, its light, and its imperfect life — never from blur, underexposure, tilted framing, or the product being obscured.`,

    // Grounding line for every in-use scene.
    nairobiTruthPrompt: `AUTHENTIC NAIROBI: This is a real, occupied space in Nairobi, Kenya — not a showroom, not a render. Nairobi sits at 1,800m on the equator: daylight is strong, clean and high-angle, shadows crisp, mornings cool. Rooms are daylight-lit in the day. Include the small honest imperfections of a real space, consistent with the lived-in level requested.`,
  };

  // Place archetypes: coherent, Nairobi-true starting points. Each sets a
  // consistent bundle of recipe params AND supplies a narrative "place"
  // paragraph used directly in the prompt (much stronger than assembling
  // fragments). Users can still fine-tune any param afterwards; changed params
  // are emitted as explicit adjustments to the place.
  const ARCHETYPES = [
    {
      id: "kilimani-bright",
      name: "Kilimani new-build",
      blurb: "Bright young-professional apartment, morning light",
      place: `A bright living room in a newer Kilimani apartment block. Smooth white-painted walls; large-format light grey porcelain floor tiles with thin grout lines. Floor-to-ceiling aluminium sliding windows with white sheer curtains half drawn; through the glass, the balconies of a neighbouring block and the crown of a jacaranda tree. Strong, clean equatorial morning light diffused by the sheers. Furniture is minimal and newish — a low fabric sofa, a light-wood side table — warmed by one woven sisal basket and a potted plant. A young professional's rental: clean, slightly sparse, genuinely bright.`,
      params: { scene:"living-room", settingType:"residential", wall:"soft-white", floor:"large-tile", rug:"sisal-jute", furniture:"minimal-modern", windowView:"apartments-trees", colourMood:"bright-airy", camera:"pro", framing:"considered", light:"bright-soft", persona:"minimalist", fullness:"light", livedIn:"tidy", details:["british-socket","sheer-curtains"], humanTraces:["mug"] },
    },
    {
      id: "westlands-parquet",
      name: "Older Westlands flat",
      blurb: "1970s block, parquet + steel windows, warm sun patches",
      place: `The sitting room of a 1970s Westlands flat that has been loved for decades. Herringbone wood parquet floor worn to a soft sheen along the walking lines. Warm cream plastered walls with faint trowel texture and gentle scuffs at furniture height. Steel casement windows with slim dark frames and brass handles, old putty at the glass; outside, mature trees and a slice of a neighbour's roof. Mid-morning sun lands in distinct warm patches on the floor. The furniture is an honest mix — an inherited hardwood sideboard, a newer sofa, a flat-woven kilim — collected over years rather than decorated.`,
      params: { scene:"living-room", settingType:"residential", wall:"warm-cream", floor:"herringbone", rug:"kilim", furniture:"eclectic", windowView:"apartments-trees", colourMood:"warm-wood", camera:"entry-camera", framing:"casual", light:"bright-hard", persona:"reader", fullness:"moderate", livedIn:"lived-in", details:["steel-window","wall-scuffs","british-socket"], humanTraces:["glasses","book-facedown"] },
    },
    {
      id: "karen-garden",
      name: "Karen garden house",
      blurb: "Bungalow facing deep green garden, golden hour",
      place: `A garden-facing room in a Karen bungalow in the last hour of good light. Wide-plank wooden floor, a little dusty in the corners; walls a muted warm cream. Large windows and a glazed door open toward a deep green garden — bougainvillea, mature trees, proper Nairobi-suburb green. Golden-hour light rakes across the floor in long warm bands. Comfortable substantial furniture, a cowhide rug, handmade ceramics and plants; a room owned by people who spend their weekends at home.`,
      params: { scene:"living-room", settingType:"residential", wall:"warm-cream", floor:"wide-plank", rug:"cowhide", furniture:"african-contemporary", windowView:"green-garden", colourMood:"warm-wood", camera:"pro", framing:"considered", light:"golden", persona:"plant-parent", fullness:"moderate", livedIn:"lived-in", details:["floor-plant","wall-scuffs"], humanTraces:["tote-bag"] },
    },
    {
      id: "south-b-family",
      name: "South B family home",
      blurb: "Lived-in maisonette, cement tile, evening lamps",
      place: `A family sitting room in a South B maisonette in the early evening. Patterned cement tile floor in a slightly faded geometric design. Pale walls repainted a few years ago, with conduit running neatly along the ceiling line. Heavy outer curtains flank sheer inner ones; framed family photos on the wall, a doily under a vase, a TV in the corner of the room's life. Warm light from a ceiling fixture and one standing lamp mixes with the last blue of dusk in the window. Comfortable, busy, unmistakably a real Nairobi family home.`,
      params: { scene:"living-room", settingType:"residential", wall:"warm-cream", floor:"patterned-cement", rug:"solid-wool", furniture:"eclectic", windowView:"apartments-trees", colourMood:"earthy-muted", camera:"decent-phone", framing:"casual", light:"evening-lamps", persona:"parent", fullness:"full", livedIn:"settled", details:["conduit","extension-cable","british-socket","floor-wear"], humanTraces:["phone-cable","jacket"] },
    },
    {
      id: "makers-studio",
      name: "Makers' studio",
      blurb: "Light-industrial workspace, hard midday light",
      place: `A working creative studio in a converted light-industrial space off Mombasa Road. Smooth grey cement screed floor marked by years of use; painted masonry walls, white but not precious, with pin holes and patched spots. Big steel-framed windows with slightly dusty glass throw broad hard midday light across a large worktable. Tools, sketchbooks, rolls of paper and prototypes occupy surfaces; the ceiling is open with visible trusses. Honest and functional — everything in the room earns its place.`,
      params: { scene:"creative-studio", settingType:"commercial", wall:"soft-white", floor:"polished-concrete", rug:"auto", furniture:"industrial", windowView:"rooftop-city", colourMood:"stone-pops", camera:"entry-camera", framing:"considered", light:"bright-hard", persona:"creative", fullness:"moderate", livedIn:"lived-in", details:["steel-window","floor-wear"], humanTraces:["headphones","mug"] },
    },
    {
      id: "staged-bright",
      name: "Staged & bright",
      blurb: "Commercial-clean new-build — the ad-ready end",
      place: `A bright, carefully staged room in a brand-new Nairobi apartment, prepared for photography. Crisp white walls, light large-format floor tiles, sheer curtains diffusing generous daylight into an even, flattering glow. Styling is minimal and deliberate: one or two plants, a neutral rug, a few well-chosen objects. Clean and composed — the commercial end of the spectrum — yet still reading as a real Nairobi apartment with real light, never a sterile 3D render.`,
      params: { scene:"living-room", settingType:"residential", wall:"soft-white", floor:"large-tile", rug:"solid-wool", furniture:"minimal-modern", windowView:"open-sky", colourMood:"bright-airy", camera:"pro", framing:"professional", light:"bright-soft", persona:"minimalist", fullness:"light", livedIn:"tidy", details:["british-socket"], humanTraces:[] },
    },
    {
      id: "cafe-corner",
      name: "Café corner",
      blurb: "Independent Nairobi café, mid-morning",
      place: `A corner of an independent Nairobi café mid-morning. Smooth cement floor; timber tables with mismatched chairs; somewhere behind, a counter with a hand-chalked menu board. Simple shaded pendant lights hang from a high ceiling. Big windows bring in soft bright light and a hint of the street — a tree, a parked motorbike, passers-by implied rather than shown. Potted plants soften the corners. The shelf works for the space: crockery, retail products, plants, cookbooks.`,
      params: { scene:"cafe-display", settingType:"commercial", wall:"warm-cream", floor:"polished-concrete", rug:"auto", furniture:"eclectic", windowView:"apartments-trees", colourMood:"warm-wood", camera:"entry-camera", framing:"considered", light:"bright-soft", persona:"collector", fullness:"full", livedIn:"tidy", details:["pendant","floor-wear"], humanTraces:["mug"] },
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
  DEFAULTS.aspect = "4:3";
  DEFAULTS.fullness = "moderate";
  DEFAULTS.livedIn = "lived-in";
  DEFAULTS.details = ["british-socket","wall-scuffs"];
  
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
      n1:"shelf contents and objects on surfaces should look more casually placed — slight gaps between items, a book pulled partway out, objects not perfectly centred on shelves, one or two items at slight angles. Less curated, more like someone actually uses this space",
      n2:"shelf contents and objects on surfaces should look naturally scattered — uneven spacing, items pushed aside, a few things at odd angles, some items partially obscured by others. Like someone lives here and doesn't style their shelves",
      p:"shelf and surface contents more deliberately arranged — better visual balance, intentional groupings, objects aligned and evenly spaced"
    },
    foldstack:{
      n1:"any folded items (towels, blankets, clothes) should look like a normal person folded them — slightly uneven edges, not perfect rectangles, soft fabric drape visible, a corner slightly lifted or tucked unevenly. Stacked items (books, boxes) should not have perfectly aligned edges — a few offset by 1-2cm, one or two leaning against the side of a stack rather than on top. Still tidy, just not machine-perfect",
      n2:"folded items should look more draped or loosely piled than folded — a blanket tossed over an arm, a towel casually hung not squared off, clothes in a soft heap rather than crisp rectangles. Stacked items can be loosely piled — uneven, some tilting, a couple slid partway out. Not messy, just unstaged",
      p:"folded and stacked items neater and more precise — clean edges, aligned stacks, crisp folds"
    },
    overall:{n:"rawer, grittier, unedited",p:"more commercially usable and finished, without changing product geometry or material"},
  };
  const DEFAULT_REFINE = Object.fromEntries(REFINE_CATS.map(c=>[c.id,0]));
  const ASPECTS = [{id:"4:3",l:"4:3"},{id:"4:5",l:"4:5"},{id:"1:1",l:"1:1"},{id:"9:16",l:"9:16"},{id:"16:9",l:"16:9"}];
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
