/**
 * The Curator's Shelf — geometry for the assembly story. GENERATED, do not edit.
 *
 *   node scripts/bake-assembly-story.mjs data/assembly/curator.design.json
 *
 * Every coordinate here came out of js/builder/engine.js placing this design,
 * so it is the same shelf /builder draws and the workshop builds. `step` is the
 * order it can actually be assembled in, read off the support graph.
 *
 * Source: https://framework.co.ke/builder/0GI7A94
 */
window.FrameworkAssemblyShelf = {
    code: "0GI7A94",
    title: "The Curator's Shelf",
    finish: "coral",
    finishName: "Coral",
    palette: {"steel":"#C04E39","surface":"#F5C6B2"},
    modules: ["slim_extension","standard_booster","standard_extension","wide_adapter","wide_base","wide_extension"],
    boundsMm: [-138,-10,0,1282,267,1630],
    sizeMm: [1420,277,1630],
    totalKsh: 36500,
    pieces: [
        {"id":"item_001","step":0,"moduleId":"wide_base","label":"Wide Base","family":"wide","role":"base","t":[0,-10,0],"rot":0,"pivot":[571.5,138.5],"bounds":[-138,-10,0,1282,267,422],"on":[],"joints":[],"priceKsh":8000},
        {"id":"item_002","step":1,"moduleId":"wide_adapter","label":"Wide Adapter","family":"wide","role":"adapter","t":[-138.5,13.5,692],"rot":180,"pivot":[710,115],"bounds":[-138,-10,422,1282,267,724],"on":["item_001"],"joints":[[1143,257,422],[1143,0,422],[0,257,422],[0,0,422]],"priceKsh":7000},
        {"id":"item_003","step":2,"moduleId":"slim_extension","label":"Slim Extension","family":"slim","role":"extension","t":[578.5,-151.18,1006],"rot":0,"pivot":[-358.5,279.68],"bounds":[-138,-10,724,579,267,1026],"on":["item_002"],"joints":[[0,0,724],[0,257,724],[440,0,724],[440,257,724]],"priceKsh":5000},
        {"id":"item_004","step":3,"moduleId":"standard_booster","label":"Standard Booster","family":"standard","role":"booster","t":[1133,128.5,-872.4],"rot":0,"pivot":[10,0],"bounds":[1133,-10,724,1153,267,1026],"on":["item_002"],"joints":[[1143,0,724],[1143,257,724]],"priceKsh":2000},
        {"id":"item_005","step":4,"moduleId":"standard_extension","label":"Standard Extension","family":"standard","role":"extension","t":[301.5,13.5,996.02],"rot":0,"pivot":[490,115],"bounds":[302,-10,1026,1282,267,1328],"on":["item_003","item_004"],"joints":[[440,0,1026],[440,257,1026],[1143,0,1026],[1143,257,1026]],"priceKsh":5500},
        {"id":"item_006","step":5,"moduleId":"standard_booster","label":"Standard Booster","family":"standard","role":"booster","t":[-10,128.5,-570.4],"rot":0,"pivot":[10,0],"bounds":[-10,-10,1026,10,267,1328],"on":["item_003"],"joints":[[0,0,1026],[0,257,1026]],"priceKsh":2000},
        {"id":"item_007","step":6,"moduleId":"wide_extension","label":"Wide Extension","family":"wide","role":"extension","t":[-138.5,13.5,1328],"rot":0,"pivot":[710,115],"bounds":[-138,-10,1328,1282,267,1630],"on":["item_006","item_005"],"joints":[[0,0,1328],[0,257,1328],[1143,0,1328],[1143,257,1328]],"priceKsh":7000}
    ]
};
