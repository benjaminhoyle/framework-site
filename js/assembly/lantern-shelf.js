/**
 * The Lantern Shelf — geometry for the assembly story. GENERATED, do not edit.
 *
 *   node scripts/bake-assembly-story.mjs data/assembly/lantern.design.json
 *
 * Every coordinate here came out of js/builder/engine.js placing this design,
 * so it is the same shelf /builder draws and the workshop builds. `step` is the
 * order it can actually be assembled in, read off the support graph.
 *
 * Source: https://framework.co.ke/builder/3WU3UN2
 */
window.FrameworkAssemblyShelf = {
    code: "3WU3UN2",
    title: "The Lantern Shelf",
    finish: "coral",
    finishName: "Coral",
    palette: {"steel":"#C04E39","surface":"#F5C6B2"},
    modules: ["lamp","slim_extension","wide_adapter","wide_base"],
    boundsMm: [-138,-112,0,1282,336,1486],
    sizeMm: [1420,448,1486],
    totalKsh: 24500,
    pieces: [
        {"id":"item_001","step":0,"moduleId":"wide_base","label":"Wide Base","family":"wide","role":"base","t":[0,-10,0],"rot":0,"pivot":[571.5,138.5],"bounds":[-138,-10,0,1282,267,422],"on":[],"joints":[],"priceKsh":8000},
        {"id":"item_002","step":1,"moduleId":"wide_adapter","label":"Wide Adapter","family":"wide","role":"adapter","t":[-138.5,13.5,692],"rot":180,"pivot":[710,115],"bounds":[-138,-10,422,1282,267,724],"on":["item_001"],"joints":[[1143,257,422],[1143,0,422],[0,257,422],[0,0,422]],"priceKsh":7000},
        {"id":"item_003","step":2,"moduleId":"slim_extension","label":"Slim Extension","family":"slim","role":"extension","t":[578.5,-151.18,1006],"rot":0,"pivot":[-358.5,279.68],"bounds":[-138,-10,724,579,267,1026],"on":["item_002"],"joints":[[0,0,724],[0,257,724],[440,0,724],[440,257,724]],"priceKsh":5000},
        {"id":"item_004","step":3,"moduleId":"lamp","label":"Lamp","family":null,"role":"lamp","t":[1143,257,691],"rot":225,"pivot":[0,0],"bounds":[774,-112,691,1222,336,1486],"on":["item_002"],"joints":[[1143,257,724]],"priceKsh":4500}
    ],
    bookends: [
        {"id":"bookend_1","moduleId":"bookend","label":"Bookend","on":["item_001"],"end":"left","anchor":[-103,128.5,390],"t":[-117.75,78.5,220],"rot":180,"pivot":[14.75,50],"bounds":[-118,79,220,-88,179,390],"priceKsh":1000},
        {"id":"bookend_2","moduleId":"bookend","label":"Bookend","on":["item_001"],"end":"right","anchor":[1246,128.5,390],"t":[1231.25,78.5,220],"rot":0,"pivot":[14.75,50],"bounds":[1231,79,220,1261,179,390],"priceKsh":1000},
        {"id":"bookend_3","moduleId":"bookend","label":"Bookend","on":["item_002"],"end":"right","anchor":[-103,128.5,692],"t":[-117.75,78.5,522],"rot":180,"pivot":[14.75,50],"bounds":[-118,79,522,-88,179,692],"priceKsh":1000},
        {"id":"bookend_4","moduleId":"bookend","label":"Bookend","on":["item_002"],"end":"left","anchor":[1246,128.5,692],"t":[1231.25,78.5,522],"rot":0,"pivot":[14.75,50],"bounds":[1231,79,522,1261,179,692],"priceKsh":1000}
    ],
    ends: [
        {"id":"end_item_001_left","moduleId":"bookend","label":"Bookend","on":["item_001"],"end":"left","anchor":[-103,128.5,390],"t":[-117.75,78.5,220],"rot":180,"pivot":[14.75,50],"bounds":[-118,79,220,-88,179,390],"priceKsh":1000},
        {"id":"end_item_001_right","moduleId":"bookend","label":"Bookend","on":["item_001"],"end":"right","anchor":[1246,128.5,390],"t":[1231.25,78.5,220],"rot":0,"pivot":[14.75,50],"bounds":[1231,79,220,1261,179,390],"priceKsh":1000},
        {"id":"end_item_002_left","moduleId":"bookend","label":"Bookend","on":["item_002"],"end":"right","anchor":[-103,128.5,692],"t":[-117.75,78.5,522],"rot":180,"pivot":[14.75,50],"bounds":[-118,79,522,-88,179,692],"priceKsh":1000},
        {"id":"end_item_002_right","moduleId":"bookend","label":"Bookend","on":["item_002"],"end":"left","anchor":[1246,128.5,692],"t":[1231.25,78.5,522],"rot":0,"pivot":[14.75,50],"bounds":[1231,79,522,1261,179,692],"priceKsh":1000},
        {"id":"end_item_003_left","moduleId":"bookend","label":"Bookend","on":["item_003"],"end":"left","anchor":[-103,128.5,994],"t":[-117.75,78.5,824],"rot":180,"pivot":[14.75,50],"bounds":[-118,79,824,-88,179,994],"priceKsh":1000},
        {"id":"end_item_003_right","moduleId":"bookend","label":"Bookend","on":["item_003"],"end":"right","anchor":[543,128.5,994],"t":[528.25,78.5,824],"rot":0,"pivot":[14.75,50],"bounds":[528,79,824,558,179,994],"priceKsh":1000}
    ]
};
