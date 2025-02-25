// Compatibility mappings
const compatibilityMap = {
  'HSNE': 'FSNE',  //'head-std-NE': 'foot-std-NE',
  'HSNW': 'FSNW',  //'head-std-NE': 'foot-std-NE',
  'FSNE': 'HSNE',
  'FSNW': 'HSNW',
  'HWNE': 'FWNE',  //'head-wide-NE': 'foot-wide-NE',
  'HWNW': 'FWNW',  //'head-wide-NE': 'foot-wide-NE',
  'FWNE': 'HWNE',
  'FWNW': 'HWNW',
  'SW': 'NE',
  'NE': 'SW',
  'NW': 'SE',
  'SE': 'NW'
};


// Define parameter sets and color themes
const originalParameterSets = {
  SET_1: {
    original: { fill: '#BBBBBB', fillOpacity: '1', stroke: 'Black', strokeWidth: '0' },
    description: 'Light gray fill'
  },
  SET_2: {
    original: { fill: '#CCCCCC', fillOpacity: '1', stroke: 'Black', strokeWidth: '0' },
    description: 'Medium light gray fill'
  },
  SET_3: {
    original: { fill: '#EEEEEE', fillOpacity: '1', stroke: 'Black', strokeWidth: '0' },
    description: 'Lightest gray fill'
  },
  SET_4: {
    original: { fill: '#555555', fillOpacity: '1', stroke: 'Black', strokeWidth: '0' },
    description: 'Dark gray fill'
  },
  SET_5: {
    original: { fill: '#777777', fillOpacity: '1', stroke: 'Black', strokeWidth: '0' },
    description: 'Darker gray fill'
  },
  SET_6: {
    original: { fill: 'none', fillOpacity: '1', stroke: '#000000', strokeWidth: '0.24' },
    description: 'Border Lines'
  },
  SET_7: {
    original: { fill: 'none', fillOpacity: '1', stroke: '#111111', strokeWidth: '0.24' },
    description: 'All Lines'
  },
  CONTEXT_BLUE: {
    original: { fill: '#5394BD', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
    description: 'Context Light Blue'
  },
  CONTEXT_PURPLE: {
    original: { fill: '#8B75BD', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
    description: 'Context Purple'
  },
  CONTEXT_GREEN: {
    original: { fill: '#147314', fillOpacity: '1', stroke: 'Black', strokeWidth: '0' },
    description: 'Context Green'
  },
  CONTEXT_BEIGE: {
    original: { fill: '#FDF5E6', fillOpacity: '1', stroke: 'Black', strokeWidth: '0' },
    description: 'Context Beige'
  },
  CONTEXT_DARK_BROWN: {
    original: { fill: '#483933', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
    description: 'Context Dark Brown'
  },
  CONTEXT_LIGHT_BROWN: {
    original: { fill: '#BD7C54', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
    description: 'Context Light Brown'
  },
  CONTEXT_LINE_LIGHT: {
    original: { fill: 'none', fillOpacity: '1', stroke: '#FFFFFF', strokeWidth: '0.24' },
    description: 'Context Light Lines'
  },
  CONTEXT_LINE_DARK: {
    original: { fill: 'none', fillOpacity: '1', stroke: '#FFFFFF', strokeWidth: '0.48' },
    description: 'Context Dark Lines'
  }
};

const colorThemes = {
  THEME_1: {
    displayName: 'Blue',
    parameterMappings: {
      SET_1: { fill: '#ACD1E7', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
      SET_2: { fill: '#94BDD5', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
      SET_3: { fill: '#C7E2F2', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
      SET_4: { fill: '#285596', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
      SET_5: { fill: '#2A528D', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
      SET_6: { fill: 'none', fillOpacity: '0', stroke: 'White', strokeWidth: '.2' },
      SET_7: { fill: 'none', fillOpacity: '0', stroke: 'White', strokeWidth: '0' },
      //context colors; same from set to set
      CONTEXT_BLUE: { fill: '#5394BD', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
      CONTEXT_PURPLE: { fill: '#8B75BD', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
      CONTEXT_GREEN: { fill: '#6C946C', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
      CONTEXT_BEIGE: { fill: '#9EAAAE', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
      CONTEXT_DARK_BROWN: { fill: '#483933', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
      CONTEXT_LIGHT_BROWN: { fill: '#BD7C54', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
      CONTEXT_LINE_LIGHT: { fill: 'none', fillOpacity: '0', stroke: 'White', strokeWidth: '.1' },
      CONTEXT_LINE_DARK: { fill: 'none', fillOpacity: '0', stroke: 'White', strokeWidth: '0.2' }

    }
  },
  THEME_2: {
    displayName: 'Green',
    parameterMappings: {
      SET_1: { fill: '#E0F0D2', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },  // Light sage
      SET_2: { fill: '#A8BFA2', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },  // Medium sage
      SET_3: { fill: '#DAE4D6', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },  // Lightest sage
      SET_4: { fill: '#445E3D', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },  // Dark sage
      SET_5: { fill: '#374E32', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },  // Darker sage
      SET_6: { fill: 'none', fillOpacity: '0', stroke: 'White', strokeWidth: '.2' },
      SET_7: { fill: 'none', fillOpacity: '0', stroke: 'White', strokeWidth: '0' },
      //context colors; same from set to set
      CONTEXT_BLUE: { fill: '#5394BD', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
      CONTEXT_PURPLE: { fill: '#8B75BD', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
      CONTEXT_GREEN: { fill: '#6C946C', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
      CONTEXT_BEIGE: { fill: '#9EAAAE', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
      CONTEXT_DARK_BROWN: { fill: '#483933', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
      CONTEXT_LIGHT_BROWN: { fill: '#BD7C54', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
      CONTEXT_LINE_LIGHT: { fill: 'none', fillOpacity: '0', stroke: 'White', strokeWidth: '.1' },
      CONTEXT_LINE_DARK: { fill: 'none', fillOpacity: '0', stroke: 'White', strokeWidth: '0.2' }
    }
  },
  THEME_3: {
    displayName: 'Black',
    parameterMappings: {
      SET_1: { fill: '#E5E7EB', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
      SET_2: { fill: '#D1D5DB', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
      SET_3: { fill: '#9CA3AF', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
      SET_4: { fill: '#4B5563', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
      SET_5: { fill: '#374151', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
      SET_6: { fill: 'none', fillOpacity: '0', stroke: 'White', strokeWidth: '.2' },
      SET_7: { fill: 'none', fillOpacity: '0', stroke: 'White', strokeWidth: '0' },
      //context colors; same from set to set
      CONTEXT_BLUE: { fill: '#5394BD', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
      CONTEXT_PURPLE: { fill: '#8B75BD', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
      CONTEXT_GREEN: { fill: '#6C946C', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
      CONTEXT_BEIGE: { fill: '#9EAAAE', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
      CONTEXT_DARK_BROWN: { fill: '#483933', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
      CONTEXT_LIGHT_BROWN: { fill: '#BD7C54', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
      CONTEXT_LINE_LIGHT: { fill: 'none', fillOpacity: '0', stroke: '#FFFFFF', strokeWidth: '.01' },
      CONTEXT_LINE_DARK: { fill: 'none', fillOpacity: '0', stroke: '#FFFFFF', strokeWidth: '0.2' }
    }
  }
};


const moduleFilenames = [
  {
    id: 'standard-base-NE',
    filename: 'standard-base-NE.svg',
    product: 'Standard Base',
    anchors: [
      { type: "SW", x: 77.204969, y: 147.394692 },
      { type: "NE", x: 163.478418, y: 97.584693 },
      { type: "HSNE", x: 120.341721, y: 105.000352 }
    ],
    price: 6500,
    dim_NE: 980,
    dim_NW: 280,
    dim_height: 430
  },
  {
    id: 'standard-base-NW',
    filename: 'standard-base-NW.svg',
    product: 'Standard Base',
    anchors: [
      { type: "NW", x: 76.521582, y: 97.584693 },
      { type: "SE", x: 162.795031, y: 147.394692 },
      { type: "HSNW", x: 119.658279, y: 105.000352 }
    ],
    price: 6500,
    dim_NW: 980,
    dim_NE: 280,
    dim_height: 430
  },
  {
    id: 'standard-extension-NE',
    filename: 'standard-extension-NE.svg',
    product: 'Standard Extension',
    anchors: [
      { type: "FSNE", x: 109.113135, y: 139.408133 },
      { type: "HSNE", x: 109.113135, y: 109.818297 }
    ],
    price: 5500,
    dim_NE: 980,
    dim_NW: 280,
    dim_height: 300
  },
  {
    id: 'standard-extension-NW',
    filename: 'standard-extension-NW.svg',
    product: 'Standard Extension',
    anchors: [
      { type: "HSNW", x: 130.886865, y: 109.818297 },
      { type: "FSNW", x: 130.886865, y: 139.408133 }
    ],
    price: 5500,
    dim_NW: 980,
    dim_NE: 280,
    dim_height: 300
  },
  {
    id: 'wide-base-NE',
    filename: 'wide-base-NE.svg',
    product: 'Wide Base',
    anchors: [
      { type: "HWNE", x: 123.440863, y: 99.040327 },
      { type: "SW", x: 62.67575, y: 151.612438 },
      { type: "NE", x: 184.205976, y: 81.446929 }
    ],
    price: 7500,
    dim_NE: 1420,
    dim_NW: 280,
    dim_height: 430
  },
  {
    id: 'wide-base-NW',
    product: 'Wide Base',
    filename: 'wide-base-NW.svg',
    anchors: [
      { type: "NW", x: 60.746793, y: 81.446929 },
      { type: "SE", x: 182.277019, y: 151.612438 },
      { type: "HWNW", x: 121.511852, y: 99.040327 }
    ],
    price: 7500,
    dim_NW: 1420,
    dim_NE: 280,
    dim_height: 430
  },
  {
    id: 'wide-extension-NE',
    filename: 'wide-extension-NE.svg',
    product: 'Wide Extension',
    anchors: [
      { type: "HWNE", x: 118.950485, y: 105.604582 },
      { type: "FWNE", x: 118.950485, y: 135.194418 }
    ],
    price: 6500,
    dim_NE: 1420,
    dim_NW: 280,
    dim_height: 300
  },
  {
    id: 'wide-extension-NW',
    filename: 'wide-extension-NW.svg',
    product: 'Wide Extension',
    anchors: [
      { type: "FWNW", x: 118.105399, y: 135.194418 },
      { type: "HWNW", x: 118.105399, y: 105.604582 }
    ],
    price: 6500,
    dim_NW: 1420,
    dim_NE: 280,
    dim_height: 300
  },


  {
    id: 'wide-adapter-NE',
    filename: 'adapter-unit-NE.svg',
    product: 'Wide Adapter',
    anchors: [
      { type: "FWNE", x: 124.221766, y: 139.173491 },
      { type: "HSNE", x: 142.889358, y: 98.805885 }
    ],
    price: 7000,
    dim_NE: 1420,
    dim_NW: 280,
    dim_height: 300
  },
  {
    id: 'wide-adapter-SE',
    filename: 'adapter-unit-SE.svg',
    product: 'Wide Adapter',
    anchors: [
      { type: "FWNW", x: 114.817492, y: 137.652845 },
      { type: "HSNW", x: 133.485138, y: 118.840748 }
    ],
    price: 7000,
    dim_NE: 1420,
    dim_NW: 280,
    dim_height: 300
  },
  {
    id: 'wide-adapter-SW',
    filename: 'adapter-unit-SW.svg',
    product: 'Wide Adapter',
    anchors: [
      { type: "HSNE", x: 104.70945, y: 125.640295 },
      { type: "FWNE", x: 123.377096, y: 144.452392 },
    ],
    price: 7000,
    dim_NW: 1420,
    dim_NE: 280,
    dim_height: 300
  },
  {
    id: 'wide-adapter-NW',
    filename: 'adapter-unit-NW.svg',
    product: 'Wide Adapter',
    anchors: [
      { type: "HSNW", x: 106.253397, y: 96.103436 },
      { type: "FWNW", x: 124.920989, y: 136.471043 }
    ],
    price: 7000,
    dim_NW: 1420,
    dim_NE: 280,
    dim_height: 300
  },
  {
    id: 'corner-base-NE',
    filename: 'corner-base-NE.svg',
    product: 'Corner Base',
    anchors: [
      { type: "NW", x: 148.102815, y: 97.832079 },
      { type: "SE", x: 170.736654, y: 110.899732 },
      { type: "SW", x: 64.166412, y: 159.360437 },
      { type: "HSNE", x: 107.679665, y: 116.739394 }
    ],
    price: 7000,
    dim_NE: 1220,
    dim_NW: 280,
    dim_height: 430
  },
  {
    id: 'corner-base-NW',
    filename: 'corner-base-NW.svg',
    product: 'Corner Base',
    anchors: [
      { type: "HSNW", x: 132.328929, y: 116.739599 },
      { type: "SW", x: 69.263346, y: 110.899732 },
      { type: "NE", x: 91.897185, y: 97.832079 },
      { type: "SE", x: 175.833642, y: 159.360437 }
    ],
    price: 7000,
    dim_NW: 1220,
    dim_NE: 280,
    dim_height: 430
  },
  {
    id: 'corner-base-SW',
    filename: 'corner-base-SW.svg',
    product: 'Corner Base',
    anchors: [
      { type: "SE", x: 92.091865, y: 148.200692 },
      { type: "NW", x: 69.458027, y: 135.133039 },
      { type: "HSNE", x: 132.483072, y: 94.314541 },
      { type: "NE", x: 176.02815, y: 86.672222 }
    ],
    price: 7000,
    dim_NE: 1220,
    dim_NW: 280,
    dim_height: 430
  },
  {
    id: 'corner-base-SE',
    filename: 'corner-base-SE.svg',
    product: 'Corner Base',
    anchors: [
      { type: "NE", x: 174.384519, y: 135.133039 },
      { type: "SW", x: 151.75068, y: 148.200692 },
      { type: "HSNW", x: 111.343529, y: 94.314603 },
      { type: "NW", x: 67.814331, y: 86.672334 }
    ],
    price: 7000,
    dim_NW: 1220,
    dim_NE: 280,
    dim_height: 430
  },
  {
    id: 'corner-extension-SE',
    filename: 'corner-extension-SE.svg',
    product: 'Corner Extension',
    anchors: [
      { type: "FSNW", x: 112.151924, y: 126.655871 },
      { type: "HSNW", x: 112.15187, y: 97.066035 }
    ],
    price: 6000,
    dim_NW: 1220,
    dim_NE: 280,
    dim_height: 300
  },
  {
    id: 'corner-extension-SW',
    filename: 'corner-extension-SW.svg',
    product: 'Corner Extension',
    anchors: [
      { type: "HSNE", x: 111.418787, y: 97.066035 },
      { type: "FSNE", x: 111.418787, y: 126.655871 }
    ],
    price: 6000,
    dim_NE: 1220,
    dim_NW: 280,
    dim_height: 300
  },
  {
    id: 'corner-extension-NW',
    filename: 'corner-extension-NW.svg',
    product: 'Corner Extension',
    anchors: [
      { type: "HSNW", x: 131.237134, y: 115.74989 },
      { type: "FSNW", x: 131.237188, y: 145.339726 }
    ],
    price: 6000,
    dim_NW: 1220,
    dim_NE: 280,
    dim_height: 300
  },
  {
    id: 'corner-extension-NE',
    filename: 'corner-extension-NE.svg',
    product: 'Corner Extension',
    anchors: [
      { type: "HSNE", x: 108.746724, y: 115.74989 },
      { type: "FSNE", x: 108.746724, y: 145.339726 }
    ],
    price: 6000,
    dim_NE: 1220,
    dim_NW: 280,
    dim_height: 300
  },
  {
    id: 'lamp-NW',
    filename: 'lamp-NW.svg',
    product: 'Lamp (left)',
    anchors: [
      { type: "FSNW", x: 129.210985, y: 146.854794 }
    ],
    price: 4500,
    dim_NW: 720,
    dim_NE: 280,
    dim_height: 760
  },
  {
    id: 'lamp-NE',
    filename: 'lamp-NE.svg',
    product: 'Lamp (right)',
    anchors: [
      { type: "FSNE", x: 129.210985, y: 146.854794 }
    ],
    price: 4500,
    dim_NE: 720,
    dim_NW: 280,
    dim_height: 760
  },
  {
    id: 'lamp-SE',
    filename: 'lamp-SE.svg',
    product: 'Lamp (left)',
    anchors: [
      { type: "FSNW", x: 106.750408, y: 147.351661 }
    ],
    price: 4500,
    dim_NW: 720,
    dim_NE: 280,
    dim_height: 760
  },
  {
    id: 'lamp-SW',
    filename: 'lamp-SW.svg',
    product: 'Lamp (right)',
    anchors: [
      { type: "FSNE", x: 133.249592, y: 147.351661 }
    ],
    price: 4500,
    dim_NE: 720,
    dim_NW: 280,
    dim_height: 760
  },
  {
    id: 'lamp-NW-2',
    filename: 'lamp-NW-2.svg',
    product: 'Lamp (right)',
    anchors: [
      { type: "FSNW", x: 117.580133, y: 154.714673 }
    ],
    price: 4500,
    dim_NW: 720,
    dim_NE: 280,
    dim_height: 760
  },
  {
    id: 'lamp-NE-2',
    filename: 'lamp-NE-2.svg',
    product: 'Lamp (left)',
    anchors: [
      { type: "FSNE", x: 101.616181, y: 146.826659 }
    ],
    price: 4500,
    dim_NE: 720,
    dim_NW: 280,
    dim_height: 760
  },
  {
    id: 'lamp-SE-2',
    filename: 'lamp-SE-2.svg',
    product: 'Lamp (right)',
    anchors: [
      { type: "FSNW", x: 109.947308, y: 165.795899 }
    ],
    price: 4500,
    dim_NW: 720,
    dim_NE: 280,
    dim_height: 760
  },
  {
    id: 'lamp-SW-2',
    filename: 'lamp-SW-2.svg',
    product: 'Lamp (left)',
    anchors: [
      { type: "FSNE", x: 138.180926, y: 142.876599 }
    ],
    price: 4500,
    dim_NE: 720,
    dim_NW: 280,
    dim_height: 760
  }

];


const contextFigures = [
  {
    id: 'cxt_woman_book_1',
    filename: 'cxt_woman-book-1.svg',
    anchorPoint: { x: 124.064914, y: 203.815396 }
  },
  {
    id: 'cxt_book_man_1',
    filename: 'cxt_book-man-1.svg',
    anchorPoint: { x: 124.064914, y: 203.815396 }
  },
  {
    id: 'cxt_woman-bed',
    filename: 'cxt_woman-bed.svg',
    anchorPoint: { x: 124.064914, y: 203.815396 }
  },
  {
    id: 'cxt_sofa-1',
    filename: 'cxt_sofa-1.svg',
    anchorPoint: { x: 175.613618, y: 226.63924 }

  },
  {
    id: 'cxt_plant-1',
    filename: 'cxt_plant-1.svg',
    anchorPoint: { x: 124.064914, y: 203.815396 }
  },
  {
    id: 'cxt_plant-2',
    filename: 'cxt_plant-2.svg',
    anchorPoint: { x: 124.470299, y: 108.468635 }
  },
  {
    id: 'cxt_plant-3',
    filename: 'cxt_plant-3.svg',
    anchorPoint: { x: 124.470299, y: 108.468635 }
  },
  {
    id: 'cxt_fruit-bowl-1',
    filename: 'cxt_fruit-bowl-1.svg',
    anchorPoint: { x: 126.299744, y: 139.27703 }
  },
  {
    id: 'cxt_fruit-bowl-2',
    filename: 'cxt_fruit-bowl-2.svg',
    anchorPoint: { x: 120.812059, y: 132.695053 }
  },
  {
    id: 'cxt_coffee-cup-1',
    filename: 'cxt_coffee-cup-1.svg',
    anchorPoint: { x: 125.573715, y: 133.23317 }
  },
  {
    id: 'cxt_kid-1',
    filename: 'cxt_kid-1.svg',
    anchorPoint: { x: 124.064914, y: 203.815396 }
  },
  {
    id: 'cxt_hanger-1',
    filename: 'cxt_hangers-1.svg',
    anchorPoint: { x: 109.672563, y: 143.278959 }
  }
];



const testPieces = moduleFilenames.map(module => ({
  ...module,
  name: module.id.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
  imagePath: `./images/designer/modules/${module.filename}`,
  width: 240,
  height: 240
}));

// Core helper functions
function findConnections(piece, placedPieces) {
  return placedPieces.flatMap(otherPiece =>
    otherPiece === piece ? [] :
      piece.piece.anchors.flatMap(anchor =>
        otherPiece.piece.anchors
          .filter(otherAnchor => {
            const isCompatible = compatibilityMap[anchor.type] === otherAnchor.type ||
              compatibilityMap[otherAnchor.type] === anchor.type;
            if (!isCompatible) return false;

            const [x1, y1] = [piece.x + anchor.x, piece.y + anchor.y];
            const [x2, y2] = [otherPiece.x + otherAnchor.x, otherPiece.y + otherAnchor.y];
            return Math.abs(x1 - x2) < 0.1 && Math.abs(y1 - y2) < 0.1;
          })
          .map(otherAnchor => ({
            piece: otherPiece,
            pieceAnchor: anchor,
            otherAnchor,
            globalX: piece.x + anchor.x,
            globalY: piece.y + anchor.y
          }))
      )
  );
}

function getVirtualAnchorPoint(piece, anchorType) {
  if (!piece.piece.id.includes('corner-')) return null;

  const pairTypeMap = {
    'NE': 'SW',
    'SW': 'NE',
    'NW': 'SE',
    'SE': 'NW'
  };
  const pairType = pairTypeMap[anchorType];
  if (!pairType) return null;

  // Count occurrences of anchor types
  const anchorCounts = piece.piece.anchors.reduce((acc, a) => {
    acc[a.type] = (acc[a.type] || 0) + 1;
    return acc;
  }, {});

  // Identify orphan anchor (if any)
  const isOrphan = anchorCounts[anchorType] === 1 && !anchorCounts[pairType];
  if (!isOrphan) return null;

  const anchor = piece.piece.anchors.find(a => a.type === anchorType);
  if (!anchor) return null;

  const dx = 105.531011;
  const dy = 60.928358;

  let virtualX, virtualY;

  // Compute virtual position based on anchor type
  switch (anchorType) {
    case 'NE':
      virtualX = anchor.x - dx;
      virtualY = anchor.y + dy;
      break;
    case 'SW':
      virtualX = anchor.x + dx;
      virtualY = anchor.y - dy;
      break;
    case 'NW':
      virtualX = anchor.x + dx;
      virtualY = anchor.y + dy;
      break;
    case 'SE':
      virtualX = anchor.x - dx;
      virtualY = anchor.y - dy;
      break;
    default:
      return null;
  }
  return { type: pairType, x: virtualX, y: virtualY, isVirtual: true };
}

function calculateLateralDimensions(piece, placedPieces, processedPairs = new Set()) {
  const dimensions = [];

  // Helper to get unique pair identifier
  const getPairId = (p1, a1, p2, a2) => {
    const points = [`${p1.piece.id}-${a1.type}`, `${p2.piece.id}-${a2.type}`].sort();
    return points.join('->');
  };

  // Process each lateral anchor
  piece.piece.anchors.forEach(anchor => {
    console.log('Processing anchor:', {
      pieceId: piece.piece.id,
      anchorType: anchor.type,
      coords: { x: anchor.x, y: anchor.y }
    });

    // Only process lateral anchors
    if (!anchor.type.match(/^(NE|NW|SE|SW)$/)) {
      console.log('Skipping anchor:', { reason: 'not lateral' });
      return;
    }

    // For corner units - handle virtual anchors and their connections
    if (piece.piece.id.includes('corner-')) {
      const virtualAnchor = getVirtualAnchorPoint(piece, anchor.type);
      if (virtualAnchor) {
        // Check if the real anchor is connected to other pieces
        const connection = findConnections(piece, placedPieces).find(conn => conn.pieceAnchor === anchor);

        // If there's a connection, we need to find the end of the chain and create a dimension to the virtual anchor
        if (connection) {
          // Start from the connected piece and follow chain to find the last open anchor
          let currentPiece = connection.piece;
          let currentAnchor = connection.otherAnchor;
          let lastOpenPiece = null;
          let lastOpenAnchor = null;
          let totalDimension = piece.piece[anchor.type.includes('NE') || anchor.type.includes('SW') ? 'dim_NE' : 'dim_NW'];
          let chain = [{ piece, anchor }, { piece: connection.piece, anchor: connection.otherAnchor }];

          // Find the end of the chain (furthest piece with an open anchor)
          while (currentPiece) {
            // Get the opposite anchor type
            const oppositeType = compatibilityMap[currentAnchor.type];

            // Find opposite anchor on current piece
            const oppositeAnchor = currentPiece.piece.anchors.find(a => a.type === oppositeType);
            if (!oppositeAnchor) break;

            // Add dimension for current piece
            const dimKey = oppositeAnchor.type.includes('NE') || oppositeAnchor.type.includes('SW') ? 'dim_NE' : 'dim_NW';
            totalDimension += currentPiece.piece[dimKey];

            // If opposite anchor is unused, we've found our end point
            if (!findConnections(currentPiece, placedPieces).some(conn => conn.pieceAnchor === oppositeAnchor)) {
              lastOpenPiece = currentPiece;
              lastOpenAnchor = oppositeAnchor;
              chain.push({ piece: currentPiece, anchor: oppositeAnchor });
              break;
            }

            // Follow the connection
            const nextConnection = findConnections(currentPiece, placedPieces)
              .find(conn => conn.pieceAnchor === oppositeAnchor);

            if (!nextConnection) {
              lastOpenPiece = currentPiece;
              lastOpenAnchor = oppositeAnchor;
              chain.push({ piece: currentPiece, anchor: oppositeAnchor });
              break;
            }

            // Move to next piece
            chain.push({ piece: nextConnection.piece, anchor: nextConnection.otherAnchor });
            currentPiece = nextConnection.piece;
            currentAnchor = nextConnection.otherAnchor;
          }

          // If we found an end point, create a dimension from it to the virtual anchor
          if (lastOpenPiece && lastOpenAnchor) {
            const chainKey = `chain-${lastOpenPiece.piece.id}-${lastOpenAnchor.type}-to-${piece.piece.id}-virtual-${virtualAnchor.type}`;

            if (!processedPairs.has(chainKey)) {
              processedPairs.add(chainKey);

              dimensions.push({
                startPoint: {
                  x: lastOpenPiece.x + lastOpenAnchor.x,
                  y: lastOpenPiece.y + lastOpenAnchor.y
                },
                endPoint: {
                  x: piece.x + virtualAnchor.x,
                  y: piece.y + virtualAnchor.y
                },
                dimension: totalDimension,
                chain: chain.concat([{ piece, anchor: virtualAnchor }])
              });
            }
          }
        } else {
          // For a standalone corner unit, create dimension between real and virtual anchor
          const dimKey = anchor.type.includes('NE') || anchor.type.includes('SW') ? 'dim_NE' : 'dim_NW';
          const virtualPairId = `${piece.piece.id}-${anchor.type}-virtual-${virtualAnchor.type}`;

          if (!processedPairs.has(virtualPairId)) {
            processedPairs.add(virtualPairId);

            dimensions.push({
              startPoint: {
                x: piece.x + anchor.x,
                y: piece.y + anchor.y
              },
              endPoint: {
                x: piece.x + virtualAnchor.x,
                y: piece.y + virtualAnchor.y
              },
              dimension: piece.piece[dimKey],
              chain: [{ piece, anchor }, { piece, anchor: virtualAnchor }]
            });
          }
        }
      }
    }

    // If the anchor is in use, skip regular dimension calculation for it
    if (findConnections(piece, placedPieces).some(conn => conn.pieceAnchor === anchor)) {
      console.log('Skipping regular dimension for anchor:', { reason: 'in use' });
      return;
    }

    // The rest of the function remains unchanged for normal dimension calculations
    let currentPiece = piece;
    let currentAnchor = anchor;
    let totalDimension = 0;
    let chain = [{ piece: currentPiece, anchor: currentAnchor }];

    // Find opposing anchor by following connections
    while (currentPiece) {
      // Get the opposite anchor type
      const oppositeType = compatibilityMap[currentAnchor.type];

      // Find opposite anchor on current piece
      const oppositeAnchor = currentPiece.piece.anchors.find(a => a.type === oppositeType);

      if (!oppositeAnchor) break;

      // If opposite anchor is unused, we've found our pair
      if (!findConnections(currentPiece, placedPieces).some(conn => conn.pieceAnchor === oppositeAnchor)) {
        // Create unique identifier for this anchor pair
        const pairId = getPairId(piece, anchor, currentPiece, oppositeAnchor);

        // Skip if we've already processed this pair
        if (processedPairs.has(pairId)) return;
        processedPairs.add(pairId);

        // Add the final dimension
        const dimKey = anchor.type.includes('NE') || anchor.type.includes('SW') ? 'dim_NE' : 'dim_NW';
        totalDimension += currentPiece.piece[dimKey];

        chain.push({ piece: currentPiece, anchor: oppositeAnchor });

        // Calculate visual points for dimension line
        const startPoint = {
          x: piece.x + anchor.x,
          y: piece.y + anchor.y
        };
        const endPoint = {
          x: currentPiece.x + oppositeAnchor.x,
          y: currentPiece.y + oppositeAnchor.y
        };

        dimensions.push({
          startPoint,
          endPoint,
          dimension: totalDimension,
          chain
        });
        break;
      }

      // If opposite anchor is in use, follow the connection
      const connection = findConnections(currentPiece, placedPieces)
        .find(conn => conn.pieceAnchor === oppositeAnchor);

      if (!connection) break;

      // Add dimension for current piece
      const dimKey = anchor.type.includes('NE') || anchor.type.includes('SW') ? 'dim_NE' : 'dim_NW';
      totalDimension += currentPiece.piece[dimKey];

      // Move to next piece
      currentPiece = connection.piece;
      currentAnchor = connection.otherAnchor;
      chain.push({ piece: currentPiece, anchor: currentAnchor });
    }
  });

  return dimensions;
}

// Update the getVerticalDimensions function to handle lamp mounts differently
function getVerticalDimensions(placedPieces) {
  // Find all root pieces
  const roots = placedPieces.filter(p => isRoot(p, placedPieces));
  const groups = roots.map(root => ({
    root,
    pieces: findGroupFromRoot(root, placedPieces)
  }));

  const dimensions = [];
  const processedHeights = new Set();

  groups.forEach(group => {
    if (group.pieces.length === 0) return;

    // Sort pieces by y-coordinate (ascending)
    const sortedPieces = [...group.pieces].sort((a, b) => a.y - b.y);

    // Calculate total height of the group
    let totalHeight = 0;
    sortedPieces.forEach(piece => {
      totalHeight += piece.piece.dim_height || 0;
    });

    // Only add one dimension per unique height
    if (processedHeights.has(totalHeight)) return;
    processedHeights.add(totalHeight);

    // Get the topmost piece
    const topPiece = sortedPieces[0];
    const isLamp = topPiece.piece.id.includes('lamp-');

    if (isLamp) {
      // For lamps, use their foot anchor point, but move the dimension arrow up by 100 units
      const lampAnchor = topPiece.piece.anchors[0]; // Lamp mount has only one anchor

      // Calculate start point with vertical offset of 100 units up from the anchor
      const startPoint = {
        x: topPiece.x + lampAnchor.x,
        y: topPiece.y + lampAnchor.y - 80 // Move 100 units up from the anchor point
      };

      dimensions.push({
        startPoint,
        dimension: totalHeight,
        isVertical: true,
        isLamp: true // Add a flag to identify lamp dimensions
      });
    } else {
      // Regular case for non-lamp pieces
      // Find a suitable anchor for the dimension arrow - prefer head anchors
      const anchor = topPiece.piece.anchors.find(a => a.type.startsWith('H')) ||
        topPiece.piece.anchors[0];

      // Calculate start point (top anchor)
      const startPoint = {
        x: topPiece.x + anchor.x,
        y: topPiece.y + anchor.y
      };

      dimensions.push({
        startPoint,
        dimension: totalHeight,
        isVertical: true
      });
    }
  });

  return dimensions;
}

// Update the VerticalDimensionLine component to handle lamp dimensions
const VerticalDimensionLine = ({ startPoint, dimension, scale, isLamp = false }) => {
  // Constants for dimension line appearance
  const arrowLength = isLamp ? 100 : 40; // Longer arrow for lamps
  const labelOffset = 8;
  const arrowSize = 6;

  // Calculate arrow start point (above the anchor point)
  const arrowStart = {
    x: startPoint.x,
    y: startPoint.y - arrowLength
  };

  // Calculate text position (centered above the arrow start)
  const textX = startPoint.x;
  const textY = arrowStart.y - labelOffset;

  return (
    <g>
      {/* Dimension arrow - pointing DOWN to the anchor point */}
      <line
        x1={arrowStart.x}
        y1={arrowStart.y}
        x2={startPoint.x}
        y2={startPoint.y}
        stroke="rgba(0,0,0,0.6)"
        strokeWidth={1}
      />

      {/* Arrow head - at the anchor point, pointing down */}
      <path
        d={`M${startPoint.x},${startPoint.y} l${arrowSize / 2},${-arrowSize} h${-arrowSize} z`}
        fill="rgba(0,0,0,0.6)"
      />

      {/* Text - centered directly above the arrow */}
      <text
        x={textX}
        y={textY}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="rgba(0,0,0,0.8)"
        fontSize={10}
      >
        {dimension}mm
      </text>
    </g>
  );
};
function isRoot(piece, placedPieces) {
  const footAnchors = piece.piece.anchors.filter(a => a.type.startsWith('F'));
  return footAnchors.length === 0 || !placedPieces.some(other =>
    other !== piece && other.piece.anchors.some(otherAnchor =>
      otherAnchor.type.startsWith('H') && footAnchors.some(footAnchor => {
        const [x1, y1] = [piece.x + footAnchor.x, piece.y + footAnchor.y];
        const [x2, y2] = [other.x + otherAnchor.x, other.y + otherAnchor.y];
        return Math.abs(x1 - x2) < 0.1 && Math.abs(y1 - y2) < 0.1;
      })
    )
  );
}

function findGroupFromRoot(root, placedPieces, visited = new Set()) {
  if (visited.has(root)) return [];
  visited.add(root);

  const group = [root];
  placedPieces.forEach(piece => {
    if (!visited.has(piece) && root.piece.anchors.some(rootAnchor => {
      return piece.piece.anchors.some(pieceAnchor => {
        // Check for both standard and wide head-foot connections
        const isHeadToFoot = ((rootAnchor.type.startsWith('HS') || rootAnchor.type.startsWith('HW')) &&
          (pieceAnchor.type.startsWith('FS') || pieceAnchor.type.startsWith('FW')));
        const isFootToHead = ((rootAnchor.type.startsWith('FS') || rootAnchor.type.startsWith('FW')) &&
          (pieceAnchor.type.startsWith('HS') || pieceAnchor.type.startsWith('HW')));
        if (!isHeadToFoot && !isFootToHead) return false;

        const [x1, y1] = [root.x + rootAnchor.x, root.y + rootAnchor.y];
        const [x2, y2] = [piece.x + pieceAnchor.x, piece.y + pieceAnchor.y];
        return Math.abs(x1 - x2) < 0.1 && Math.abs(y1 - y2) < 0.1;
      });
    })) {
      group.push(...findGroupFromRoot(piece, placedPieces, visited));
    }
  });

  // Sort by y-coordinate ascending (smaller y values first)
  return group.sort((a, b) => a.y - b.y);
}

function orderPieces(placedPieces) {
  const roots = placedPieces.filter(p => isRoot(p, placedPieces));
  const groups = roots.map(root => ({
    root,
    pieces: findGroupFromRoot(root, placedPieces)
  }));

  groups.sort((a, b) => (b.root.y + b.root.piece.height) - (a.root.y + a.root.piece.height));
  return groups.flatMap(g => g.pieces);
}

function generateConfigCode(placedPieces, placedContextFigures) {
  if (placedPieces.length === 0 && placedContextFigures.length === 0) return '';

  const processed = new Set();
  const usedConnections = new Set();

  // Find all root pieces and their groups
  const roots = placedPieces.filter(p => isRoot(p, placedPieces));
  const groups = roots.map(root => ({
    root,
    pieces: findGroupFromRoot(root, placedPieces)
  }));

  function formatGroup(group) {
    if (group.pieces.length === 0) return '';

    let code = '(';
    const sortedPieces = [...group.pieces].sort((a, b) => b.y - a.y);

    for (let i = 0; i < sortedPieces.length; i++) {
      const piece = sortedPieces[i];
      code += `{${piece.piece.id}}`;

      if (i < sortedPieces.length - 1) {
        const nextPiece = sortedPieces[i + 1];
        const verticalConn = findConnections(piece, [nextPiece])
          .find(conn =>
            ((conn.pieceAnchor.type.startsWith('FS') || conn.pieceAnchor.type.startsWith('FW')) &&
              (conn.otherAnchor.type.startsWith('HS') || conn.otherAnchor.type.startsWith('HW'))) ||
            ((conn.pieceAnchor.type.startsWith('HS') || conn.pieceAnchor.type.startsWith('HW')) &&
              (conn.otherAnchor.type.startsWith('FS') || conn.otherAnchor.type.startsWith('FW')))
          );

        if (verticalConn) {
          code += verticalConn.pieceAnchor.type + '-' + verticalConn.otherAnchor.type;
        }
      }
    }

    return code + ')';
  }

  // Create a graph of group connections
  const groupConnections = new Map();
  const connectionTypes = new Map();

  for (const group1 of groups) {
    for (const group2 of groups) {
      if (group1 === group2) continue;

      for (const piece1 of group1.pieces) {
        for (const piece2 of group2.pieces) {
          const lateralConn = findConnections(piece1, [piece2])
            .find(conn => !conn.pieceAnchor.type.startsWith('HS') &&
              !conn.pieceAnchor.type.startsWith('FS'));

          if (lateralConn) {
            if (!groupConnections.has(group1)) {
              groupConnections.set(group1, new Set());
            }
            groupConnections.get(group1).add(group2);
            connectionTypes.set(`${group1.root.uniqueId}-${group2.root.uniqueId}`,
              `${lateralConn.pieceAnchor.type}-${lateralConn.otherAnchor.type}`);
          }
        }
      }
    }
  }

  // Helper to find entry points (groups with 1 or 0 connections)
  function findEntryGroups() {
    return groups.filter(group =>
      !groupConnections.has(group) || groupConnections.get(group).size <= 1
    ).sort((a, b) => a.root.x - b.root.x);
  }

  // Helper to build chain from a starting group
  function buildChain(startGroup, visited = new Set()) {
    const chain = [startGroup];
    visited.add(startGroup);

    let currentGroup = startGroup;
    while (true) {
      const connections = groupConnections.get(currentGroup);
      if (!connections) break;

      let nextGroup = null;
      for (const connected of connections) {
        if (!visited.has(connected)) {
          nextGroup = connected;
          break;
        }
      }

      if (!nextGroup) break;

      chain.push(nextGroup);
      visited.add(nextGroup);
      currentGroup = nextGroup;
    }

    return chain;
  }

  // Generate code for placed pieces
  let baseCode = '';
  const processedGroups = new Set();

  while (processedGroups.size < groups.length) {
    const entryGroups = findEntryGroups()
      .filter(group => !processedGroups.has(group));

    if (entryGroups.length === 0) break;

    const startGroup = entryGroups[0];
    const chain = buildChain(startGroup, processedGroups);

    // Add code for this chain
    for (let i = 0; i < chain.length; i++) {
      const group = chain[i];
      baseCode += formatGroup(group);
      processedGroups.add(group);

      if (i < chain.length - 1) {
        const nextGroup = chain[i + 1];
        const connType = connectionTypes.get(`${group.root.uniqueId}-${nextGroup.root.uniqueId}`) ||
          connectionTypes.get(`${nextGroup.root.uniqueId}-${group.root.uniqueId}`);
        if (connType) {
          baseCode += connType;
        }
      }
    }
  }

  // Add context figures if present
  if (placedContextFigures.length > 0) {
    baseCode += '_' + placedContextFigures.map(fig =>
      `[${fig.filename},${fig.x.toFixed(1)},${fig.y.toFixed(1)}]`
    ).join('');
  }

  return baseCode;
}

async function animateConfiguration(code, setPlacedPieces, setNewPieceId, setPlacedContextFigures) {
  console.log('Starting animation with code:', code);

  // Get reference to the global contextFigures array
  const contextFiguresRef = window.contextFigures || contextFigures;

  let moduleCode = code;
  let contextCode = '';

  // Split into module code and context code, but only at the first standalone underscore
  const splitIndex = code.indexOf(')_[');  // Look for the specific pattern where context starts
  if (splitIndex !== -1) {
    moduleCode = code.substring(0, splitIndex + 1);  // Include the closing parenthesis
    contextCode = code.substring(splitIndex + 2);    // Skip the underscore but keep the [
    console.log('Split code into:', { moduleCode, contextCode });
  }


  const pieces = [];
  const uniqueCounter = (() => {
    let count = 0;
    return () => `piece-${Date.now()}-${count++}`;

  })();

  function isModuleId(token) {
    return testPieces.some(p => p.id === token);
  }

  function isLateralConnection(token) {
    return ['NE-SW', 'SW-NE', 'NW-SE', 'SE-NW'].includes(token);
  }

  function createPiece(moduleId, x = 200, y = 200) {
    const moduleInfo = testPieces.find(p => p.id === moduleId);
    if (!moduleInfo) throw new Error(`Invalid module: ${moduleId}`);
    return {
      piece: moduleInfo,
      x,
      y,
      rotation: 0,
      uniqueId: uniqueCounter()
    };
  }

  function positionPieceRelativeTo(newPiece, basePiece, sourceType, targetType) {

    const sourceAnchor = newPiece.piece.anchors.find(a => a.type === sourceType);
    const targetAnchor = basePiece.piece.anchors.find(a => a.type === targetType);

    if (!sourceAnchor || !targetAnchor) {
      console.error('Missing anchors for:', sourceType, targetType);
      throw new Error(`Cannot find required anchors: ${sourceType}, ${targetType}`);
    }

    newPiece.x = basePiece.x + targetAnchor.x - sourceAnchor.x;
    newPiece.y = basePiece.y + targetAnchor.y - sourceAnchor.y;
  }

  function parseCode(code) {
    const tokens = [];
    let i = 0;

    function isConnectionChar(char) {
      return /[A-Z]/.test(char) || char === '-';
    }

    while (i < code.length) {
      while (i < code.length && /\s/.test(code[i])) i++;
      if (i >= code.length) break;

      if (code[i] === '(' || code[i] === ')') {
        tokens.push(code[i]);
        i++;
        continue;
      }

      if (code[i] === '{') {
        i++;
        let moduleId = '';
        while (i < code.length && code[i] !== '}') {
          moduleId += code[i];
          i++;
        }
        tokens.push(moduleId);
        i++;
        continue;
      }

      if (isConnectionChar(code[i])) {
        let connection = '';
        while (i < code.length && isConnectionChar(code[i])) {
          connection += code[i];
          i++;
        }
        if (connection) tokens.push(connection);
        continue;
      }

      i++;
    }

    return tokens.filter(token => token.length > 0);
  }

  async function processVerticalChain(tokens, startIndex) {

    const groupPieces = [];
    let i = startIndex;
    let lastPiece = null;
    let pendingConnection = null;

    function isVerticalConnection(token) {
      // Updated to include both standard and wide variants
      return /^(HS|FS|HW|FW)(NE|NW)-(HS|FS|HW|FW)(NE|NW)$/.test(token);
    }

    function analyzeConnection(token) {
      if (!isVerticalConnection(token)) return null;
      const [source, target] = token.split('-');
      return {
        source,
        target,
        isReversed: source.startsWith('F'), // Changed to check for any F prefix
        direction: source.endsWith('NE') ? 'NE' : 'NW'
      };
    }

    while (i < tokens.length && tokens[i] !== ')') {
      const token = tokens[i];

      if (isModuleId(token)) {
        const newPiece = createPiece(token);

        if (lastPiece && pendingConnection) {
          const connection = analyzeConnection(pendingConnection);
          if (connection) {
            const sourceType = connection.isReversed ? connection.target : connection.source;
            const targetType = connection.isReversed ? connection.source : connection.target;
            positionPieceRelativeTo(newPiece, lastPiece, targetType, sourceType);
          }
          pendingConnection = null;
        }

        groupPieces.push(newPiece);
        lastPiece = newPiece;
      } else if (isVerticalConnection(token)) {
        pendingConnection = token;
      }

      i++;
    }



    return { pieces: groupPieces, endIndex: i };
  }

  async function processTokens(tokens) {
    const allGroups = [];
    let currentGroupIndex = 0;
    let i = 0;

    while (i < tokens.length) {
      if (tokens[i] === '(') {
        const { pieces, endIndex } = await processVerticalChain(tokens, i + 1);
        allGroups.push(pieces);
        i = endIndex + 1;
      } else if (isLateralConnection(tokens[i])) {
        const connection = tokens[i];
        const [sourceType, targetType] = connection.split('-');

        // Find the next group
        i++;
        while (i < tokens.length && tokens[i] !== '(') i++;

        if (i < tokens.length) {
          const { pieces, endIndex } = await processVerticalChain(tokens, i + 1);

          if (allGroups[currentGroupIndex].length > 0 && pieces.length > 0) {
            positionPieceRelativeTo(pieces[0], allGroups[currentGroupIndex][0], targetType, sourceType);

            // Adjust all pieces in the new group
            const dx = pieces[0].x - 200;
            const dy = pieces[0].y - 200;
            for (let j = 1; j < pieces.length; j++) {
              pieces[j].x += dx;
              pieces[j].y += dy;
            }
          }

          allGroups.push(pieces);
          currentGroupIndex++;
          i = endIndex + 1;
        }
      } else {
        i++;
      }
    }


    // Add all pieces to the scene with animation
    for (const group of allGroups) {
      for (const piece of group) {
        const uniqueId = `piece-${Date.now()}-${Math.random()}`;
        piece.uniqueId = uniqueId;

        // First set the newPieceId
        setNewPieceId(uniqueId);
        // Wait a frame for React
        await new Promise(resolve => requestAnimationFrame(resolve));

        // Now add the piece
        pieces.push(piece);
        setPlacedPieces(orderPieces([...pieces]));

        // Wait for animation
        await new Promise(resolve => setTimeout(resolve, 300));

        // Clear animation state
        setNewPieceId(null);
        // Small delay before next piece
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
  }


  setPlacedPieces([]); // Clear existing pieces

  const tokens = parseCode(moduleCode);
  await processTokens(tokens);

  // Handle context figures if present
  if (contextCode) {
    console.log('Processing context code:', contextCode);
    const figures = [...contextCode.matchAll(/\[(.*?)\]/g)]
      .map(match => {
        console.log('Processing match:', match);
        const [filename, x, y] = match[1].split(',');
        const template = contextFiguresRef.find(f => f.filename === filename);
        console.log('Found template:', template);
        if (!template) return null;
        return {
          ...template,
          x: parseFloat(x),
          y: parseFloat(y),
          uniqueId: `ctx-${Date.now()}-${Math.random()}`
        };
      })
      .filter(Boolean);
    // Wait a moment before adding the context figures
    await new Promise(resolve => setTimeout(resolve, 500))

    // Add context figures one by one with animation
    for (const figure of figures) {
      setPlacedContextFigures(prev => [...prev, figure]);
      // Wait a moment before adding the next one
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
}

function canPieceReplace(originalPiece, newPieceTemplate, placedPieces) {
  const connections = findConnections(originalPiece, placedPieces);

  // If it's a corner-extension, check what's below it
  if (newPieceTemplate.id.startsWith('corner-extension-')) {
    const headConnection = connections.find(conn =>
      conn.pieceAnchor.type.startsWith('HS') || conn.pieceAnchor.type.startsWith('FS')
    );

    if (headConnection) {
      const connectedPiece = headConnection.piece.piece.id;
      if (!connectedPiece.startsWith('corner-')) return false;

      // Check if suffixes match
      const newSuffix = newPieceTemplate.id.slice(-2);
      const connectedSuffix = connectedPiece.slice(-2);
      if (newSuffix !== connectedSuffix) return false;
    }
  }

  // If it has a corner-extension above it, check if suffixes match
  const cornerExtensionAbove = connections.find(conn =>
    conn.piece.piece.id.startsWith('corner-extension-') &&
    (conn.pieceAnchor.type.startsWith('HS') || conn.pieceAnchor.type.startsWith('FS'))
  );

  if (cornerExtensionAbove) {
    const aboveSuffix = cornerExtensionAbove.piece.piece.id.slice(-2);
    const thisSuffix = newPieceTemplate.id.slice(-2);
    if (aboveSuffix !== thisSuffix) return false;
  }

  const usedAnchorTypes = new Set(connections.map(conn => conn.pieceAnchor.type));
  return Array.from(usedAnchorTypes).every(type =>
    newPieceTemplate.anchors.some(a => a.type === type)
  );
}

function getCompatibleReplacements(piece, placedPieces) {
  return testPieces.filter(template =>
    template.id !== piece.piece.id &&
    canPieceReplace(piece, template, placedPieces)
  );
}

function hasActiveHeadAnchor(piece, placedPieces) {
  return findConnections(piece, placedPieces)
    .some(conn => conn.pieceAnchor.type.includes('H'));
}

function countActiveConnections(piece, placedPieces) {
  return new Set(findConnections(piece, placedPieces)
    .map(conn => conn.pieceAnchor.type)).size;
}

function applySVGTheme(svgDoc, theme) {
  if (!svgDoc?.documentElement) {
    return;
  }


  const paths = svgDoc.getElementsByTagName('path');

  Array.from(paths).forEach(path => {
    // Get current attributes with more flexible matching
    const currentAttributes = {
      fill: path.getAttribute('fill')?.toLowerCase() || 'none',
      fillOpacity: path.getAttribute('fill-opacity') || '1',
      stroke: path.getAttribute('stroke')?.toLowerCase() || 'none',
      strokeWidth: path.getAttribute('stroke-width') || '0'
    };

    // Find matching parameter set with more flexible matching
    const matchingSet = Object.entries(originalParameterSets).find(([_, set]) => {
      const orig = set.original;
      const origFill = orig.fill.toLowerCase();
      const origStroke = orig.stroke.toLowerCase();

      return (
        (origFill === currentAttributes.fill ||
          (origFill === '#ffffff' && currentAttributes.fill === '#fff') ||
          (origFill === 'none' && !currentAttributes.fill)) &&
        (origStroke === currentAttributes.stroke ||
          (origStroke === '#000000' && currentAttributes.stroke === '#000') ||
          (origStroke === 'none' && !currentAttributes.stroke)) &&
        Math.abs(parseFloat(orig.strokeWidth) - parseFloat(currentAttributes.strokeWidth)) < 0.01
      );
    });

    if (matchingSet) {
      const [setKey] = matchingSet;
      const themeMapping = colorThemes[theme].parameterMappings[setKey];

      // Remove attributes when they should be none or 0
      if (themeMapping.fill === 'none') {
        path.removeAttribute('fill');
      } else {
        path.setAttribute('fill', themeMapping.fill);
      }

      if (themeMapping.stroke === 'none' || parseFloat(themeMapping.strokeWidth) === 0) {
        path.removeAttribute('stroke');
        path.removeAttribute('stroke-width');
      } else {
        path.setAttribute('stroke', themeMapping.stroke);
        path.setAttribute('stroke-width', themeMapping.strokeWidth);
      }

      if (parseFloat(themeMapping.fillOpacity) === 1) {
        path.removeAttribute('fill-opacity');
      } else {
        path.setAttribute('fill-opacity', themeMapping.fillOpacity);
      }
    }
  });
}


const QRPanel = ({ url, onClose }) => {
  const canvasRef = React.useRef(null);

  React.useEffect(() => {
    if (!canvasRef.current || !url) return;

    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    script.onload = () => {
      // Clear any existing content
      while (canvasRef.current.firstChild) {
        canvasRef.current.removeChild(canvasRef.current.firstChild);
      }

      new window.QRCode(canvasRef.current, {
        text: url,
        width: 223,
        height: 223,
        colorDark: "#000000",
        colorLight: "#ffffff",
      });
    };
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, [url]);

  return (
    <div className="fixed bottom-6 right-72 bg-white rounded-lg shadow-lg p-4 w-[calc(100%-48px)] max-w-md z-50">
      <div className="flex flex-col items-center gap-2">
        <div ref={canvasRef} className="w-[223px] h-[223px]" />
        <p className="text-sm text-gray-600">Scan to view this design</p>
      </div>
    </div>
  );
};
// Update the DimensionLines component to include vertical dimensions
const DimensionLines = ({ placedPieces, scale, offset, containerRef }) => {
  // Create a unique key for each dimension
  const createDimensionKey = (dim) => {
    if (dim.isVertical) {
      // For vertical dimensions, use only the start point
      const [x, y] = [Math.round(dim.startPoint.x * 100) / 100, Math.round(dim.startPoint.y * 100) / 100];
      return `v-${x},${y}-${dim.dimension}`;
    } else {
      // For horizontal dimensions, use both points
      const [x1, y1] = [Math.round(dim.startPoint.x * 100) / 100, Math.round(dim.startPoint.y * 100) / 100];
      const [x2, y2] = [Math.round(dim.endPoint.x * 100) / 100, Math.round(dim.endPoint.y * 100) / 100];
      return `h-${x1 < x2 ? `${x1},${y1}-${x2},${y2}` : `${x2},${y2}-${x1},${y1}`}`;
    }
  };

  // Get unique dimensions
  const getDimensions = () => {
    const dimensionsMap = new Map();

    // Add horizontal dimensions
    placedPieces.forEach(piece => {
      const dimensions = calculateLateralDimensions(piece, placedPieces);

      dimensions.forEach(dim => {
        const key = createDimensionKey(dim);
        if (!dimensionsMap.has(key)) {
          dimensionsMap.set(key, dim);
        }
      });
    });

    // Add vertical dimensions
    const verticalDimensions = getVerticalDimensions(placedPieces);
    verticalDimensions.forEach(dim => {
      const key = createDimensionKey(dim);
      if (!dimensionsMap.has(key)) {
        dimensionsMap.set(key, dim);
      }
    });

    return Array.from(dimensionsMap.values());
  };

  const uniqueDimensions = getDimensions();

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 15000 }}
      width="100%"
      height="100%"
      viewBox={`0 0 ${containerRef.current?.clientWidth || 1000} ${containerRef.current?.clientHeight || 1000}`}
    >
      {uniqueDimensions.map((dim, index) => {
        // Calculate screen coordinates
        const screenStart = {
          x: dim.startPoint.x * scale + offset.x,
          y: dim.startPoint.y * scale + offset.y
        };

        if (dim.isVertical) {
          return (
            <VerticalDimensionLine
              key={`vdim-${index}-${dim.startPoint.x}-${dim.startPoint.y}`}
              startPoint={screenStart}
              dimension={dim.dimension}
              scale={scale}
            />
          );
        } else {
          const screenEnd = {
            x: dim.endPoint.x * scale + offset.x,
            y: dim.endPoint.y * scale + offset.y
          };

          return (
            <DimensionLine
              key={`dim-${index}-${dim.startPoint.x},${dim.startPoint.y}-${dim.endPoint.x},${dim.endPoint.y}`}
              startPoint={screenStart}
              endPoint={screenEnd}
              dimension={dim.dimension}
              scale={scale}
            />
          );
        }
      })}
    </svg>
  );
};
// Updated horizontal dimension line with no extension lines and larger arrows
const DimensionLine = ({ startPoint, endPoint, dimension, scale }) => {
  const dx = endPoint.x - startPoint.x;
  const dy = endPoint.y - startPoint.y;
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  const lineLength = Math.sqrt(dx * dx + dy * dy);

  // Constants for dimension line appearance
  const extensionOffset = 130; // Distance below anchor points for the dimension line
  const arrowSize = 6; // Increased arrow size (1.5x)
  const textGapSize = 40; // Size of gap in line for text

  // Calculate dimension line endpoints directly
  const startDim = {
    x: startPoint.x,
    y: startPoint.y + extensionOffset
  };
  const endDim = {
    x: endPoint.x,
    y: endPoint.y + extensionOffset
  };

  // Calculate midpoint for text
  const midX = (startDim.x + endDim.x) / 2;
  const midY = (startDim.y + endDim.y) / 2;

  // Calculate points for split line with gap
  const gapStart = 0.5 - (textGapSize / lineLength / 2);
  const gapEnd = 0.5 + (textGapSize / lineLength / 2);

  return (
    <g>
      {/* Dimension line segments - directly between points, no extension lines */}
      <line
        x1={startDim.x}
        y1={startDim.y}
        x2={startDim.x + dx * gapStart}
        y2={startDim.y + dy * gapStart}
        stroke="rgba(0,0,0,0.6)"
        strokeWidth={1}
      />
      <line
        x1={startDim.x + dx * gapEnd}
        y1={startDim.y + dy * gapEnd}
        x2={endDim.x}
        y2={endDim.y}
        stroke="rgba(0,0,0,0.6)"
        strokeWidth={1}
      />

      {/* Larger arrows */}
      <path
        d={`M${startDim.x},${startDim.y} l${arrowSize},${arrowSize / 2} v${-arrowSize} z`}
        fill="rgba(0,0,0,0.6)"
        transform={`rotate(${angle}, ${startDim.x}, ${startDim.y})`}
      />
      <path
        d={`M${endDim.x},${endDim.y} l${-arrowSize},${arrowSize / 2} v${-arrowSize} z`}
        fill="rgba(0,0,0,0.6)"
        transform={`rotate(${angle}, ${endDim.x}, ${endDim.y})`}
      />


      {/* Flat text - no rotation */}
      <text
        x={midX}
        y={midY}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="rgba(0,0,0,0.8)"
        fontSize={10}
      >
        {dimension}mm
      </text>
    </g>
  );
};
function ModuleBuilder() {
  // Replace all state declarations with these:
  const [placedPieces, setPlacedPieces] = React.useState([]);
  const [scale, setScale] = React.useState(1);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  const [newPieceId, setNewPieceId] = React.useState(null);
  const loadedSvgs = React.useRef(new Set());
  const containerRef = React.useRef(null);
  const [configCode, setConfigCode] = React.useState('');
  const [inputCode, setInputCode] = React.useState('');
  const [error, setError] = React.useState('');
  const [selectedTheme, setSelectedTheme] = React.useState('THEME_1');
  const [showButtons, setShowButtons] = React.useState(true);
  const [placedContextFigures, setPlacedContextFigures] = React.useState([]);
  const [isContextPlacementMode, setIsContextPlacementMode] = React.useState(false);
  const [draggingContextId, setDraggingContextId] = React.useState(null);
  const dragStartRef = React.useRef({ x: 0, y: 0 });
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [showQR, setShowQR] = React.useState(false);
  const [buttonState, setButtonState] = React.useState('initial');
  const [showDimensions, setShowDimensions] = React.useState(false);

  React.useEffect(() => {
    const loadFromHash = async () => {
      const hash = window.location.hash;
      if (hash.startsWith('#')) {
        const hashContent = decodeURIComponent(hash.slice(1));
        if (hashContent) {
          // Hide controls when loading from URL
          setShowButtons(false);
          setIsExpanded(false);

          const [code, theme] = hashContent.split(';');
          if (theme && Object.keys(colorThemes).includes(theme)) {
            setSelectedTheme(theme);
          }
          if (code) {
            setInputCode(code);
            // Add delay before starting animation
            await new Promise(resolve => setTimeout(resolve, 300));
            await animateConfiguration(code, setPlacedPieces, setNewPieceId, setPlacedContextFigures);
          }
        }
      }
    };
    loadFromHash();
  }, []);


  // Update handleDragStart to store the initial click position
  const handleDragStart = (figureId, e) => {
    e.stopPropagation();
    const rect = containerRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    dragStartRef.current = {
      x: (clientX - rect.left - offset.x) / scale,
      y: (clientY - rect.top - offset.y) / scale
    };

    setDraggingContextId(figureId);
  };

  const handleDragMove = (e) => {
    if (!draggingContextId) return;

    const rect = containerRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const currentX = (clientX - rect.left - offset.x) / scale;
    const currentY = (clientY - rect.top - offset.y) / scale;

    const deltaX = currentX - dragStartRef.current.x;
    const deltaY = currentY - dragStartRef.current.y;

    setPlacedContextFigures(prev => prev.map(fig => {
      if (fig.uniqueId === draggingContextId) {
        return {
          ...fig,
          x: fig.x + deltaX,
          y: fig.y + deltaY
        };
      }
      return fig;
    }));

    dragStartRef.current = { x: currentX, y: currentY };
  };

  const handleDragEnd = () => {
    setDraggingContextId(null);
  };



  // In ModuleBuilder component, add these handlers:
  const handleAddContext = () => {
    setIsContextPlacementMode(true);
  };

  const handleContextPlace = (e) => {
    if (!isContextPlacementMode) return;

    const rect = containerRef.current.getBoundingClientRect();
    const clickX = (e.clientX - rect.left - offset.x) / scale;
    const clickY = (e.clientY - rect.top - offset.y) / scale;

    // Filter out already placed figures
    const availableFigures = contextFigures.filter(
      fig => !placedContextFigures.some(placed => placed.id === fig.id)
    );
    if (availableFigures.length === 0) return;

    const randomFigure = availableFigures[Math.floor(Math.random() * availableFigures.length)];

    // Offset the position by the anchor point so the anchor aligns with click
    const x = clickX - randomFigure.anchorPoint.x;
    const y = clickY - randomFigure.anchorPoint.y;

    setPlacedContextFigures(prev => [...prev, {
      ...randomFigure,
      x,
      y,
      uniqueId: Date.now().toString()
    }]);

    setIsContextPlacementMode(false);
  };

  const handleContextCycle = (placedFigure) => {
    const availableFigures = contextFigures.filter(
      fig => fig.id !== placedFigure.id
    );
    if (availableFigures.length === 0) return;

    // Find current index and get next in rotation
    const currentIndex = contextFigures.findIndex(fig => fig.id === placedFigure.id);
    const nextIndex = (currentIndex + 1) % contextFigures.length;
    const nextFigure = contextFigures[nextIndex];

    // Clear from cache using proper key before cycling
    svgCache.current.delete(`context-${placedFigure.filename}`);

    setPlacedContextFigures(prev => prev.map(fig =>
      fig.uniqueId === placedFigure.uniqueId
        ? { ...nextFigure, x: fig.x, y: fig.y, uniqueId: fig.uniqueId }
        : fig
    ));
  };


  const handleContextDelete = (uniqueId) => {
    setPlacedContextFigures(prev => prev.filter(fig => fig.uniqueId !== uniqueId));
  };


  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(configCode);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  // Add SVG content cache
  const svgCache = React.useRef(new Map());


  const isAnchorInUse = React.useCallback((piece, anchor) => {
    return placedPieces.some(otherPiece =>
      otherPiece !== piece && otherPiece.piece.anchors?.some(otherAnchor => {
        const compatibleType = compatibilityMap[anchor.type] === otherAnchor.type ||
          compatibilityMap[otherAnchor.type] === anchor.type;
        if (!compatibleType) return false;

        const [x1, y1] = [piece.x + anchor.x, piece.y + anchor.y];
        const [x2, y2] = [otherPiece.x + otherAnchor.x, otherPiece.y + otherAnchor.y];
        return Math.abs(x1 - x2) < 0.1 && Math.abs(y1 - y2) < 0.1;
      })
    );
  }, [placedPieces]);

  const handleSVGLoad = async (obj, type, id) => {
    try {
      const svgDoc = obj.contentDocument;
      if (!svgDoc?.documentElement) {
        console.error('No SVG document found:', id);
        return;
      }

      obj.style.visibility = 'hidden';

      // Cache handling - now works for both types
      if (!svgCache.current.has(id)) {
        const originalSvg = svgDoc.documentElement.cloneNode(true);
        svgCache.current.set(id, originalSvg);
      } else {
        const cachedSvg = svgCache.current.get(id);
        const freshSvg = cachedSvg.cloneNode(true);
        svgDoc.documentElement.replaceWith(freshSvg);
      }

      // Apply theme
      applySVGTheme(svgDoc, selectedTheme);

      // Handle anchor points only for furniture pieces
      if (type === 'furniture') {
        const anchorPointsString = svgDoc.documentElement.getAttribute('data-anchor-points');
        if (anchorPointsString) {
          const anchors = JSON.parse(anchorPointsString);
          const piece = testPieces.find(p => p.id === id);
          if (piece) piece.anchors = anchors;
        }
      }

      loadedSvgs.current.add(id);
      obj.style.visibility = 'visible';

    } catch (error) {
      console.error('Error in handleSVGLoad:', id, error);
      obj.style.visibility = 'visible';
    }
  };

  const checkCacheStatus = (pieceId) => {
    return {
      isCached: svgCache.current.has(pieceId),
      cachedContent: svgCache.current.get(pieceId)
    };
  };

  const calculateBounds = React.useCallback(() => {
    if (placedPieces.length === 0 && placedContextFigures.length === 0) return null;

    const bounds = {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity
    };

    // Include placed pieces
    placedPieces.forEach(piece => {
      bounds.minX = Math.min(bounds.minX, piece.x);
      bounds.minY = Math.min(bounds.minY, piece.y);
      bounds.maxX = Math.max(bounds.maxX, piece.x + piece.piece.width);
      bounds.maxY = Math.max(bounds.maxY, piece.y + piece.piece.height);
    });

    // Include context figures
    placedContextFigures.forEach(figure => {
      bounds.minX = Math.min(bounds.minX, figure.x);
      bounds.minY = Math.min(bounds.minY, figure.y);
      bounds.maxX = Math.max(bounds.maxX, figure.x + 240);
      bounds.maxY = Math.max(bounds.maxY, figure.y + 240);
    });

    return bounds;
  }, [placedPieces, placedContextFigures]);

  const updateZoom = React.useCallback(() => {
    // Don't update zoom if we're dragging
    if (draggingContextId) return;

    if (!containerRef.current) return;
    const bounds = calculateBounds();
    if (!bounds) return;

    const padding = 40;
    const container = containerRef.current;
    const contentWidth = bounds.maxX - bounds.minX + (padding * 2);
    const contentHeight = bounds.maxY - bounds.minY + (padding * 2);

    const scaleX = container.clientWidth / contentWidth;
    const scaleY = container.clientHeight / contentHeight;
    const newScale = Math.min(scaleX, scaleY);

    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;

    requestAnimationFrame(() => {
      setScale(newScale);
      setOffset({
        x: (container.clientWidth / 2) - (centerX * newScale),
        y: (container.clientHeight / 2) - (centerY * newScale)
      });
    });
  }, [calculateBounds, draggingContextId]);


  const handleCodeSubmit = async () => {
    try {
      setError('');
      setPlacedPieces([]); // Clear pieces
      setPlacedContextFigures([]); // Clear context figures
      await animateConfiguration(inputCode, setPlacedPieces, setNewPieceId, setPlacedContextFigures);
    } catch (err) {
      setError('Invalid configuration code');
      console.error(err);
    }
  };

  React.useEffect(() => {
    setShowQR(false);
    setButtonState('initial');
  }, [placedPieces, placedContextFigures, selectedTheme]);

  React.useEffect(() => {
    updateZoom();
    window.addEventListener('resize', updateZoom);
    return () => window.removeEventListener('resize', updateZoom);
  }, [updateZoom]);

  React.useEffect(() => {
    if (!window.location.hash) {  // Only load default if no hash present
      const basePiece = testPieces.find(p => p.id === 'standard-base-NE');
      if (basePiece) {
        setPlacedPieces([{
          piece: basePiece,
          x: 200,
          y: 200,
          rotation: 0,
          uniqueId: 'initial'
        }]);
      }
    }
  }, []);

  React.useEffect(() => {
    setConfigCode(generateConfigCode(placedPieces, placedContextFigures));
  }, [placedPieces, placedContextFigures]);

  const handleCyclePiece = (piece, e) => {
    e.stopPropagation();

    // Get connections to determine if this is a first piece
    const connections = findConnections(piece, placedPieces);
    const isFirstPiece = connections.length === 0;

    // Get all possible pieces for this position, including current piece
    const allPieces = testPieces.filter(p => {
      // Must be current piece or able to replace it
      const isValidReplacement = p.id === piece.piece.id || canPieceReplace(piece, p, placedPieces);

      // For first piece with no connections, exclude pieces with foot anchors
      if (isFirstPiece) {
        const hasFootAnchor = p.anchors.some(anchor => anchor.type.startsWith('F'));
        return isValidReplacement && !hasFootAnchor;
      }

      return isValidReplacement;
    });


    // Find current index in all pieces
    const currentIndex = allPieces.findIndex(p => p.id === piece.piece.id);

    // Calculate next index with wraparound
    const nextIndex = (currentIndex + 1) % allPieces.length;

    // Get next piece
    const nextPiece = allPieces[nextIndex];

    // Remove from loaded SVGs cache before cycling
    const pieceId = `${piece.piece.id}-${piece.uniqueId}`;
    loadedSvgs.current.delete(pieceId);

    setPlacedPieces(prev => {
      const index = prev.findIndex(p => p === piece);
      const newPieces = [...prev];


      if (connections.length > 0) {
        const firstConnection = connections[0];
        const newAnchor = nextPiece.anchors.find(a => a.type === firstConnection.pieceAnchor.type);

        newPieces[index] = {
          ...piece,
          piece: nextPiece,
          x: firstConnection.globalX - newAnchor.x,
          y: firstConnection.globalY - newAnchor.y,
          uniqueId: Date.now().toString()
        };
      } else {
        newPieces[index] = {
          ...piece,
          piece: nextPiece,
          uniqueId: Date.now().toString()
        };
      }

      return newPieces;
    });
  };




  const handleAnchorClick = (sourcePiece, anchor) => {
    const compatiblePieces = testPieces.filter(piece =>
      piece.anchors.some(a => compatibilityMap[anchor.type] === a.type)
    );
    if (compatiblePieces.length === 0) return;

    const newPiece = compatiblePieces[0];
    const compatibleAnchor = newPiece.anchors.find(a =>
      compatibilityMap[anchor.type] === a.type
    );

    const uniqueId = Date.now().toString();
    const newPlacedPiece = {
      piece: newPiece,
      x: sourcePiece.x + anchor.x - compatibleAnchor.x,
      y: sourcePiece.y + anchor.y - compatibleAnchor.y,
      rotation: 0,
      uniqueId
    };

    setNewPieceId(uniqueId);
    setPlacedPieces(orderPieces([...placedPieces, newPlacedPiece]));

    setTimeout(() => setNewPieceId(null), 300);
  };

  const HelpDisplay = ({ isExpanded }) => {
    if (!isExpanded) return null;

    const controls = [
      { symbol: '↻', description: 'Cycle through available objects', color: 'bg-blue-500' },
      { symbol: '+', description: 'Add module', color: 'bg-green-500' },
      { symbol: '-', description: 'Remove object', color: 'bg-red-500' },
      { symbol: '⇄', description: 'Click and drag to move context', color: 'bg-green-500' }
    ];

    return (
      <div className="absolute bottom-full mb-2 left-0 right-0">
        <div className="bg-white rounded-lg shadow-lg p-3">
          <div className="space-y-2">
            {controls.map((control, index) => (
              <div key={index} className="flex items-center gap-3">
                <div className={`${control.color} w-5 h-5 rounded-full flex items-center justify-center text-white text-xs shrink-0`}>
                  {control.symbol}
                </div>
                <span className="text-xs text-gray-700">{control.description}</span>
              </div>
            ))}
          </div>
          <div className="absolute bottom-0 left-4 w-2 h-2 bg-white transform translate-y-1/2 rotate-45 border-r border-b border-gray-200"></div>
        </div>
      </div>
    );
  };

  const EditorControls = ({ selectedTheme, onThemeChange, onAddContext, showButtons, isContextPlacementMode }) => {
    return (
      <div className="fixed top-4 right-4 z-50">
        <div className="bg-white rounded-lg shadow-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600">Shelf color:</span>
            <select
              value={selectedTheme}
              onChange={(e) => onThemeChange(e.target.value)}
              className="bg-white border border-gray-200 rounded-md shadow-sm px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer hover:border-gray-300 transition-colors duration-200 sm:text-xs md:text-sm"
            >
              {Object.entries(colorThemes).map(([themeKey, theme]) => (
                <option key={themeKey} value={themeKey}>
                  {theme.displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="relative">
            <button
              onClick={onAddContext}
              className={`w-full bg-white border border-gray-200 rounded-md px-3 py-1.5 text-xs hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-200 shadow-sm sm:text-xs md:text-sm ${isContextPlacementMode ? 'bg-blue-50 border-blue-200' : ''}`}
            >
              Add Context
            </button>
            {isContextPlacementMode && (
              <div className="absolute top-full left-0 right-0 mt-5">
                <div className="bg-white rounded-lg shadow-lg p-2 text-xs text-gray-600 relative">
                  Click anywhere to add objects or people.
                  <div className="absolute -top-1 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-white rotate-45 border-t border-l border-gray-200"></div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const HelperControls = ({ showButtons, onToggleButtons, isExpanded, setIsExpanded }) => {
    return (
      <div className="fixed bottom-6 left-6 z-50">
        <div className="relative"> {/* Add this wrapper */}
          <div className="bg-white rounded-lg shadow-lg p-1.5 flex gap-2">
            <div className="relative">
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-200 sm:text-xs md:text-sm"
              >
                {isExpanded ? 'Hide Help' : 'Show Help'}
              </button>
            </div>
            <div className="w-px bg-gray-200"></div>
            <button
              onClick={onToggleButtons}
              className="px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-200 sm:text-xs md:text-sm"
            >
              {showButtons ? 'Hide Controls' : 'Show Controls'}
            </button>

            <div className="w-px bg-gray-200"></div>
            <button
              onClick={() => setShowDimensions(!showDimensions)}
              className="px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-200 sm:text-xs md:text-sm"
            >
              {showDimensions ? 'Hide Dimensions' : 'Show Dimensions'}
            </button>
          </div>
          {/* Move HelpDisplay here */}
          {isExpanded && (
            <div className="absolute bottom-full mb-2 left-0 w-full">
              <div className="bg-white rounded-lg shadow-lg p-3">
                <div className="space-y-2">
                  {[
                    { symbol: '↻', description: 'Cycle through available objects', color: 'bg-blue-500' },
                    { symbol: '+', description: 'Add module', color: 'bg-green-500' },
                    { symbol: '-', description: 'Remove object', color: 'bg-red-500' },
                    { symbol: '⇄', description: 'Click and drag to move context', color: 'bg-green-500' }
                  ].map((control, index) => (
                    <div key={index} className="flex items-center gap-3">
                      <div className={`${control.color} w-5 h-5 rounded-full flex items-center justify-center text-white text-xs shrink-0`}>
                        {control.symbol}
                      </div>
                      <span className="text-xs text-gray-700">{control.description}</span>
                    </div>
                  ))}
                </div>
                <div className="absolute bottom-0 left-4 w-2 h-2 bg-white transform translate-y-1/2 rotate-45 border-r border-b border-gray-200"></div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div ref={containerRef}
      className="relative w-full h-screen bg-gray-100 overflow-hidden touch-none"
      style={{
        touchAction: 'none',
        WebkitOverflowScrolling: 'touch',
        position: 'fixed',
        inset: 0
      }}
      onClick={isContextPlacementMode ? handleContextPlace : undefined}
      onMouseMove={handleDragMove}
      onTouchMove={handleDragMove}
      onMouseUp={handleDragEnd}
      onTouchEnd={handleDragEnd}>
      <div className="absolute top-0 left-0 origin-top-left"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transition: 'transform 2s cubic-bezier(0.25, 1, 0.3, 1)',
          willChange: 'transform'
        }}>

        {/* SVG Layer */}
        {/* Furniture SVG Layer */}
        {placedPieces.map((placedPiece, index) => (
          <div
            key={placedPiece.uniqueId}
            className="absolute"
            style={{
              left: `${placedPiece.x}px`,
              top: `${placedPiece.y}px`,
              width: `${placedPiece.piece.width}px`,
              height: `${placedPiece.piece.height}px`,
              zIndex: 100 + (placedPieces.length - index),
              transition: 'opacity 0.3s ease-out, transform 0.3s ease-out',
              opacity: placedPiece.uniqueId === newPieceId ? 0 : 1,
              transform: placedPiece.uniqueId === newPieceId ? 'translateY(-10px)' : 'none'
            }}
          >
            <object
              data={placedPiece.piece.imagePath}
              type="image/svg+xml"
              className="absolute w-full h-full pointer-events-none"
              onLoad={(e) => handleSVGLoad(e.target, 'furniture', placedPiece.piece.id)}
              style={{ willChange: 'transform', visibility: 'hidden' }}
            />
          </div>
        ))}

        {/* Context Figures Layer */}
        {placedContextFigures.map((figure) => (
          <div
            key={figure.uniqueId}
            className="absolute"
            style={{
              left: `${figure.x}px`,
              top: `${figure.y}px`,
              zIndex: Math.floor(figure.y * 100)
            }}
          >
            <object
              data={`./images/designer/context/${figure.filename}`}
              type="image/svg+xml"
              className="absolute pointer-events-none"
              style={{ width: '240px', height: '240px' }}
              onLoad={(e) => handleSVGLoad(e.target, 'context', figure.filename)}
            />
            {showButtons && (
              <div
                style={{
                  position: 'absolute',
                  left: `${figure.anchorPoint.x}px`,
                  top: `${figure.anchorPoint.y}px`,
                  transform: `scale(${1 / scale})`,
                  display: 'flex',
                  gap: '4px',
                  transformOrigin: 'center'
                }}
              >
                <button
                  className="bg-red-500 rounded-full w-6 h-6 text-white hover:bg-red-600 flex items-center justify-center"
                  onClick={() => handleContextDelete(figure.uniqueId)}
                >
                  -
                </button>
                <button
                  className="bg-blue-500 rounded-full w-6 h-6 text-white hover:bg-blue-600 flex items-center justify-center"
                  onClick={() => handleContextCycle(figure)}
                >
                  ↻
                </button>
                <button
                  className={`${draggingContextId === figure.uniqueId ? 'bg-green-600' : 'bg-green-500'} rounded-full w-6 h-6 text-white hover:bg-green-600 flex items-center justify-center`}
                  onMouseDown={(e) => handleDragStart(figure.uniqueId, e)}
                  onTouchStart={(e) => handleDragStart(figure.uniqueId, e)}
                >
                  ⇄
                </button>
              </div>
            )}
          </div>
        ))}

        {/* Controls Layer */}
        <div className="absolute inset-0" style={{ zIndex: 20000 }}>
          {placedPieces.map((placedPiece, index) => (
            <React.Fragment key={`controls-${placedPiece.uniqueId}`}>
              {showButtons && (
                <>
                  {/* Control Buttons Group */}
                  {getCompatibleReplacements(placedPiece, placedPieces).length > 0 &&
                    countActiveConnections(placedPiece, placedPieces) <= 1 &&
                    !hasActiveHeadAnchor(placedPiece, placedPieces) && (
                      <div
                        className="absolute flex flex-col gap-1 items-center"
                        style={{
                          left: `${placedPiece.x + placedPiece.piece.width / 2}px`,
                          top: `${placedPiece.y + placedPiece.piece.height / 2}px`,
                          transform: `translate(-50%, -50%) scale(${1 / scale})`,
                          transformOrigin: 'center',
                          pointerEvents: 'auto'
                        }}
                      >
                        <button
                          className="bg-blue-500 rounded-full flex items-center justify-center text-white w-5 h-5 text-xs shadow-sm"
                          onClick={(e) => handleCyclePiece(placedPiece, e)}
                        >
                          ↻
                        </button>
                        <button
                          className="bg-red-500 rounded-full flex items-center justify-center text-white w-5 h-5 text-xs shadow-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPlacedPieces(pieces => pieces.filter(p => p !== placedPiece));
                          }}
                        >
                          -
                        </button>
                      </div>
                    )}

                  {/* Anchor Points */}
                  {placedPiece.piece.anchors?.map((anchor, anchorIndex) => !isAnchorInUse(placedPiece, anchor) && (
                    <button
                      key={anchorIndex}
                      className="absolute bg-green-500 rounded-full flex items-center justify-center text-white text-xs shadow-sm"
                      style={{
                        left: `${placedPiece.x + anchor.x}px`,
                        top: `${placedPiece.y + anchor.y}px`,
                        width: '14px',
                        height: '14px',
                        transform: `translate(-50%, -50%) scale(${1 / scale})`,
                        transformOrigin: 'center',
                        pointerEvents: 'auto'
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAnchorClick(placedPiece, anchor);
                      }}
                    >
                      +
                    </button>
                  ))}
                </>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {showDimensions && (
        <DimensionLines
          placedPieces={placedPieces}
          scale={scale}
          offset={offset}
          containerRef={containerRef}
        />
      )}


      {/* Editor Controls */}
      <EditorControls
        selectedTheme={selectedTheme}
        onThemeChange={(newTheme) => {
          setSelectedTheme(newTheme);
          document.querySelectorAll('object[type="image/svg+xml"]').forEach(obj => {
            const svgDoc = obj.contentDocument;
            if (!svgDoc?.documentElement) return;
            obj.style.visibility = 'hidden';
            const svgPath = obj.data;
            const baseId = svgPath.split('/').pop().replace('.svg', '');
            const cachedSvg = svgCache.current.get(baseId);
            if (cachedSvg) {
              const freshSvg = cachedSvg.cloneNode(true);
              svgDoc.documentElement.replaceWith(freshSvg);
              applySVGTheme(svgDoc, newTheme);
            } else {
              applySVGTheme(svgDoc, newTheme);
            }
            obj.style.visibility = 'visible';
          });
        }}
        onAddContext={handleAddContext}
        showButtons={showButtons}
        isContextPlacementMode={isContextPlacementMode}
      />


      {/* Helper Controls */}
      <HelperControls
        showButtons={showButtons}
        onToggleButtons={() => setShowButtons(!showButtons)}
        isExpanded={isExpanded}
        setIsExpanded={setIsExpanded}
      />

      {placedPieces.length > 0 && (
        <div className="fixed bottom-6 right-6 bg-white rounded-lg shadow-lg p-4 max-w-md z-50">
          {/* Product List */}
          {Object.entries(
            placedPieces.reduce((acc, { piece }) => {
              // Extract the base product type without direction suffix
              const baseProductType = piece.product;

              // Group by product name instead of ID
              if (!acc[baseProductType]) {
                acc[baseProductType] = {
                  count: 0,
                  price: piece.price
                };
              }
              acc[baseProductType].count += 1;
              return acc;
            }, {})
          )
            .sort(([productA], [productB]) => {
              const order = {
                'Standard Base': 1,
                'Standard Extension': 2,
                'Corner Base': 3,
                'Corner Extension': 4,
                'Wide Base': 5,
                'Wide Adapter': 6,
                'Wide Extension': 7,
                'Lamp (left)': 8,
                'Lamp (right)': 8
              };
              return (order[productA] || 999) - (order[productB] || 999);
            })
            .map(([product, { count, price }], index, array) => {
              return (
                <div key={product} className="text-sm text-gray-600">
                  {`${count} x ${product} @ Ksh ${price.toLocaleString()}${index !== array.length - 1 ? ' +' : ''}`}
                </div>
              );
            })}

          {/* Total Price */}
          <div className="mt-2 pt-2 border-t border-gray-200">
            <span className="text-lg font-medium">
              Total: Ksh {placedPieces.reduce((sum, { piece }) => sum + piece.price, 0).toLocaleString()}
            </span>
            <span className="text-sm text-gray-500 ml-2">(VAT inclusive)</span>
          </div>
          {/* Add this line for the QR panel */}
          {showQR && (
            <QRPanel
              url={`https://framework.co.ke/designer#${encodeURIComponent(configCode)};${selectedTheme}`}
              onClose={() => setShowQR(false)}
            />
          )}
          {/* Action Buttons */}
          <div className="mt-4 space-y-2">
            <a
              href={`https://wa.me/254783891005?text=${encodeURIComponent(
                `I'd like to place an order for:\n${Object.entries(
                  placedPieces.reduce((acc, { piece }) => {
                    // Extract the base product type without direction suffix
                    const baseProductType = piece.product;

                    // Group by product name instead of ID
                    if (!acc[baseProductType]) {
                      acc[baseProductType] = {
                        count: 0,
                        price: piece.price
                      };
                    }
                    acc[baseProductType].count += 1;
                    return acc;
                  }, {})
                )
                  .sort(([productA], [productB]) => {
                    const order = {
                      'Standard Base': 1,
                      'Standard Extension': 2,
                      'Corner Base': 3,
                      'Corner Extension': 4,
                      'Wide Base': 5,
                      'Wide Adapter': 6,
                      'Wide Extension': 7,
                      'Lamp (left)': 8,
                      'Lamp (right)': 8
                    };
                    return (order[productA] || 999) - (order[productB] || 999);
                  })
                  .map(([product, { count, price }]) => {
                    return `${count} x ${product} @ Ksh ${price.toLocaleString()}`;
                  })
                  .join('\n')
                }\nAll in ${colorThemes[selectedTheme].displayName}\nTotal Cost: Ksh ${placedPieces.reduce((sum, { piece }) => sum + piece.price, 0).toLocaleString()
                } (VAT inclusive)`
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full bg-green-600 text-white text-center px-2.5 py-1 rounded-md text-xs font-medium"
            >
              Order via WhatsApp
            </a>
            <button
              onClick={async (e) => {
                const shareableURL = `https://framework.co.ke/designer#${encodeURIComponent(configCode)};${selectedTheme}`;

                if (buttonState === 'copied') {
                  setShowQR(true);
                  setButtonState('qr');
                  return;
                }

                if (buttonState === 'qr') {
                  setShowQR(false);
                  setButtonState('initial');
                  return;
                }

                try {
                  await navigator.clipboard.writeText(shareableURL);
                  setButtonState('copied');
                  const button = e.target;
                  button.textContent = 'Click again for QR Code';

                  setTimeout(() => {
                    if (buttonState === 'copied') {
                      setButtonState('initial');
                      button.textContent = 'Share Your Design';
                    }
                  }, 5000);
                } catch (err) {
                  console.error('Failed to copy URL:', err);
                }
              }}
              className="block w-full bg-indigo-600 text-white text-center px-2.5 py-1 rounded-md text-xs font-medium"
            >
              {buttonState === 'initial' ? 'Share Your Design' :
                buttonState === 'copied' ? 'Link copied! Click again for QR Code' :
                  'Close QR Code'}
            </button>
          </div>
        </div>
      )}




    </div>

  );
}