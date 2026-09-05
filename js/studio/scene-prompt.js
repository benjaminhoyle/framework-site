/**
 * The scene prompt: turning a set of chosen parameters into the words the image
 * model is given.
 *
 * Lifted out of scene-studio.html so that the studio flow can generate a scene
 * without a second, slowly diverging copy of it. It was a closure over two
 * pieces of React state — the measured scale and the resolved aspect — and both
 * are now arguments; nothing else about it has changed.
 *
 * The parameter tables it reads live in js/studio/prompt-config.js, which both
 * pages already shared. This is the assembly.
 */
window.FrameworkScenePrompt = (function () {
  "use strict";

  /**
   * @param CONFIG   the tables from window.PROMPT_CONFIG
   * @param p        the chosen parameters
   * @param context  { scale, aspect } — the measured shelf scale (see
   *                 js/studio/scale.js) and the already-resolved aspect ratio
   */
  function build(CONFIG, p, context) {
    const settings = context || {};
    // Named explicitly rather than leaning on the global the page happens to
    // have loaded: this file is read by two pages and a test harness now.
    const FrameworkScale = window.FrameworkScale;
    const scale = settings.scale || (FrameworkScale ? FrameworkScale.UNSET : null);
    const aspect = settings.aspect || "4:3";

    const gp=(k,id)=>id==="auto"?"":CONFIG[k]?.find(o=>o.id===id)?.prompt||"";
    const camP=gp("camera",p.camera),frmP=gp("framing",p.framing),litP=gp("light",p.light);
    let photo="";if(camP)photo+=camP+"\n";if(frmP)photo+=frmP+"\n";if(litP)photo+=litP+"\n";
    let scaleLine="";
    if(FrameworkScale.isSet(scale)){const h=scale.shelfH;let rel=h<80?"desk height":h<120?"chest height":h<160?"shoulder height":"taller than most adults";
      scaleLine=`\nSCALE: Shelf is EXACTLY ${h}cm tall (${rel}).${FrameworkScale.figureNote(scale)}`;}
    let notes="";if(p.customNotes?.trim())notes=`\nADDITIONAL NOTES: ${p.customNotes.trim()}`;
    const productTruth=`${CONFIG.referenceRolePrompt}\n\n${CONFIG.preservationPrompt}\n\n${CONFIG.viewpointPrompt}`;
    // The camera and composition options describe a photographer choosing where
    // to stand. The viewpoint lock says they may not. Say which wins, once,
    // wherever those options are used -- otherwise it is left to luck.
    const viewpointPrecedence="- The VIEWPOINT LOCK wins over this section. Camera and composition choices here set the crop, the tilt, where the shelf sits in the frame, the lens character and the light -- never where the camera stands in relation to the shelf.";

    if(p.shotType==="clean"){
      const bg=CONFIG.productBackgrounds.find(o=>o.id===p.productBackground)?.prompt||CONFIG.productBackgrounds[0]?.prompt||"A simple neutral background.";
      return `You are a professional product photographer creating product imagery for Framework Designs, a modular steel shelving company in Nairobi, Kenya.\n\nTASK: Using the attached reference photo, generate a CLEAN PRODUCT SHOT of this EXACT shelf.\n\n${productTruth}\n\nBACKGROUND: ${bg}\n\nSHELF CONTENTS: Keep the shelf empty unless objects are already present in the reference photo. Do not add lifestyle props.\n\n${CONFIG.negativePrompt}\n${photo?`\n${photo}${viewpointPrecedence}\n`:""}\nAspect ratio: ${aspect}.${scaleLine}${notes}`;
    }

    // ── In-use scene: narrative structure. THE PLACE (one coherent paragraph,
    // from an archetype when set) → THE SHELF IN THE PLACE → THE PHOTOGRAPH
    // (explicitly overrides mood implied by the place) → AUTHENTICITY →
    // PHOTOGRAPHIC FLOOR → constraints. A described *place* beats a checklist.
    const scn=CONFIG.scenes.find(s=>s.id===p.scene)?.prompt||"";
    const wallP=gp("walls",p.wall),floorP=gp("floors",p.floor),rugP=gp("rugs",p.rug);
    const furnP=gp("furniture",p.furniture),winP=gp("windowView",p.windowView),moodP=gp("colourMood",p.colourMood);
    const per=CONFIG.persona.find(x=>x.id===p.persona);
    const contents=per&&per.contents?per.contents:"items appropriate for the room type";
    const full=CONFIG.fullness.find(x=>x.id===p.fullness)?.prompt||"moderate";
    const lived=CONFIG.livedIn.find(x=>x.id===p.livedIn)?.prompt||"lived-in";
    const dets=(p.details||[]).map(id=>CONFIG.details.find(d=>d.id===id)?.prompt).filter(Boolean).map(s=>"- "+s).join("\n");
    const traces=(p.humanTraces||[]).map(id=>CONFIG.humanTraces.find(d=>d.id===id)?.prompt).filter(Boolean).map(s=>"- "+s).join("\n");
    const shelfVisibility=["full","packed"].includes(p.fullness)||p.persona!=="auto"
      ?"\nSHELF VISIBILITY: Objects can sit on the shelf, but must not cover, replace, thicken, or redraw the structural tubes, shelf edges, legs, bolt points, or tier gaps."
      :"";

    const arch=(CONFIG.archetypes||[]).find(a=>a.id===p.archetype);
    let placeBlock="";
    if(arch){
      // The archetype narrative is the place; user changes become explicit adjustments.
      const adj=[];
      const adjKeys=[["wall","walls","WALLS"],["floor","floors","FLOOR"],["rug","rugs","RUG"],["furniture","furniture","FURNITURE"],["windowView","windowView","WINDOW VIEW"],["colourMood","colourMood","COLOUR MOOD"]];
      for(const[key,cfgKey,label]of adjKeys){
        if(p[key]!==arch.params[key]&&p[key]!=="auto"){const t=gp(cfgKey,p[key]);if(t)adj.push(`- ${label}: ${t}`);}
      }
      if(p.scene!==arch.params.scene&&scn)adj.push(`- ROOM: ${scn}`);
      placeBlock=`THE PLACE:\n${arch.place}`+(adj.length?`\n\nADJUST THE PLACE AS FOLLOWS (these override the paragraph above):\n${adj.join("\n")}`:"");
    }else{
      let sur="";if(wallP)sur+=`- Walls: ${wallP}\n`;if(floorP)sur+=`- Floor: ${floorP}\n`;if(rugP)sur+=`- Rug: ${rugP}\n`;if(furnP)sur+=`- Furniture: ${furnP}\n`;if(winP)sur+=`- Window view: ${winP}\n`;
      placeBlock=`THE PLACE:\n${scn}.\n${sur}${moodP?moodP+"\n":""}`.trim();
    }
    const shelfBlock=`THE SHELF IN THIS PLACE:\n- The shelf stands against a wall of this room, naturally placed as real furniture.${scaleLine?`\n- ${scaleLine.trim()}`:""}\n- Contents: ${contents}. Fill level: ${full}.${CONFIG.contentsColourPrompt?`\n- ${CONFIG.contentsColourPrompt}`:""}\n- Condition of the room: ${lived}.${shelfVisibility}`;

    const photoBlock=`THE PHOTOGRAPH:\n${photo?photo.trim():"Natural, competent photography appropriate to the place."}\n- If the light or mood described here conflicts with the place description above, THIS section wins.\n${viewpointPrecedence}`;

    const authBlock=`${CONFIG.nairobiTruthPrompt||""}${dets?`\nGROUNDING DETAILS (include naturally, not as a checklist):\n${dets}`:""}${traces?`\nTRACES OF PEOPLE (subtle, at most as described):\n${traces}`:""}`;

    return `You are a location photographer shooting real interiors for Framework Designs, a modular steel shelving company in Nairobi, Kenya. Your photographs must feel like actual Nairobi spaces that happen to be beautifully shot — never like showroom renders.\n\nTASK: Using the attached reference photo, generate a NEW photorealistic image placing this EXACT shelf in the space described below.\n\n${productTruth}\n\n${placeBlock}\n\n${shelfBlock}\n\n${photoBlock}\n\n${authBlock}\n\n${CONFIG.craftFloorPrompt||""}\n\n${CONFIG.negativePrompt}\n\nAspect ratio: ${aspect}.${notes}`;
    }

  return { build };
})();
