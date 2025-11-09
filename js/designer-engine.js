// designer-engine.js - Core functionality for the shelving designer

// Create a global object to hold all shared functionality
window.DesignerEngine = {};


// Compatibility mappings
DesignerEngine.compatibilityMap = {
  'HSNE': 'FSNE',  //'head-std-NE': 'foot-std-NE',
  'HSNW': 'FSNW',  //'head-std-NE': 'foot-std-NE',
  'FSNE': 'HSNE',
  'FSNW': 'HSNW',
  'HWNE': 'FWNE',  //'head-wide-NE': 'foot-wide-NE',
  'HWNW': 'FWNW',  //'head-wide-NE': 'foot-wide-NE',
  'FWNE': 'HWNE',
  'FWNW': 'HWNW',
  'HDNE': 'FDNE',  //'head-deep-NE': 'foot-deep-NE',
  'HDNW': 'FDNW',  //'head-deep-NE': 'foot-deep-NE',
  'FDNE': 'HDNE',
  'FDNW': 'HDNW',
  'HCNE': 'FCNE',  //'head-compact-NE': 'foot-compact-NE',
  'HCNW': 'FCNW',  //'head-compact-NE': 'foot-compact-NE',
  'FCNE': 'HCNE',
  'FCNW': 'HCNW',
  'SW': 'NE',
  'NE': 'SW',
  'NW': 'SE',
  'SE': 'NW'
};


// Define parameter sets and color themes
DesignerEngine.originalParameterSets = {
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

DesignerEngine.colorThemes = {
  THEME_1: {
    displayName: 'Marine',
    parameterMappings: {
      SET_1: { fill: '#A4CBE3', fillOpacity: '1', stroke: 'none', strokeWidth: '0' }, // Light blue top
      SET_2: { fill: '#89B4D2', fillOpacity: '1', stroke: 'none', strokeWidth: '0' }, // Blue edge
      SET_3: { fill: '#C0DDF1', fillOpacity: '1', stroke: 'none', strokeWidth: '0' }, // Lighter blue surface
      SET_4: { fill: '#4A6E9C', fillOpacity: '1', stroke: 'none', strokeWidth: '0' }, // Blue post
      SET_5: { fill: '#1D4A84', fillOpacity: '1', stroke: 'none', strokeWidth: '0' }, // Dark blue post base
      SET_6: { fill: 'none', fillOpacity: '0', stroke: 'White', strokeWidth: '.2' },
      SET_7: { fill: 'none', fillOpacity: '0', stroke: 'White', strokeWidth: '0' },
      CONTEXT_BLUE: { fill: '#4A87B5', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
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
    displayName: 'Sage',
    parameterMappings: {
      SET_1: { fill: '#C5DCC1', fillOpacity: '1', stroke: 'none', strokeWidth: '0' }, // Light sage top
      SET_2: { fill: '#9DBB95', fillOpacity: '1', stroke: 'none', strokeWidth: '0' }, // Mid sage edge
      SET_3: { fill: '#D8E6D4', fillOpacity: '1', stroke: 'none', strokeWidth: '0' }, // Lightest sage surface
      SET_4: { fill: '#709169', fillOpacity: '1', stroke: 'none', strokeWidth: '0' }, // Dark sage post
      SET_5: { fill: '#567050', fillOpacity: '1', stroke: 'none', strokeWidth: '0' }, // Darker sage base
      SET_6: { fill: 'none', fillOpacity: '0', stroke: 'White', strokeWidth: '.2' },
      SET_7: { fill: 'none', fillOpacity: '0', stroke: 'White', strokeWidth: '0' },
      CONTEXT_BLUE: { fill: '#4A87B5', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
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
    displayName: 'Charcoal',
    parameterMappings: {
      SET_1: { fill: '#bec2cc', fillOpacity: '1', stroke: 'none', strokeWidth: '0' }, // top-facing shelf surface
      SET_2: { fill: '#9EA3B2', fillOpacity: '1', stroke: 'none', strokeWidth: '0' }, // edge – cooler, darker grey-blue
      SET_3: { fill: '#CCD1DD', fillOpacity: '1', stroke: 'none', strokeWidth: '0' }, // surface light
      SET_4: { fill: '#4a4a47', fillOpacity: '1', stroke: 'none', strokeWidth: '0' }, // post – softened charcoal
      SET_5: { fill: '#2F312D', fillOpacity: '1', stroke: 'none', strokeWidth: '0' }, // post base – just a bit deeper
      SET_6: { fill: 'none', fillOpacity: '0', stroke: 'White', strokeWidth: '.2' },
      SET_7: { fill: 'none', fillOpacity: '0', stroke: 'White', strokeWidth: '0' },
      CONTEXT_BLUE: { fill: '#4A87B5', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
      CONTEXT_PURPLE: { fill: '#8B75BD', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
      CONTEXT_GREEN: { fill: '#6C946C', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
      CONTEXT_BEIGE: { fill: '#9EAAAE', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
      CONTEXT_DARK_BROWN: { fill: '#483933', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
      CONTEXT_LIGHT_BROWN: { fill: '#BD7C54', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
      CONTEXT_LINE_LIGHT: { fill: 'none', fillOpacity: '0', stroke: '#FFFFFF', strokeWidth: '.01' },
      CONTEXT_LINE_DARK: { fill: 'none', fillOpacity: '0', stroke: '#FFFFFF', strokeWidth: '0.2' }
    }
  },


  THEME_4: {
    displayName: 'Coral',
    parameterMappings: {
      SET_1: { fill: '#F5C6B2', fillOpacity: '1', stroke: 'none', strokeWidth: '0' }, // Light coral top
      SET_2: { fill: '#EA9273', fillOpacity: '1', stroke: 'none', strokeWidth: '0' }, // Mid coral edge
      SET_3: { fill: '#FFD1BD', fillOpacity: '1', stroke: 'none', strokeWidth: '0' }, // Lightest coral surface
      SET_4: { fill: '#C04E39', fillOpacity: '1', stroke: 'none', strokeWidth: '0' }, // Coral post
      SET_5: { fill: '#A03D2C', fillOpacity: '1', stroke: 'none', strokeWidth: '0' }, // Dark coral base
      SET_6: { fill: 'none', fillOpacity: '0', stroke: 'White', strokeWidth: '.2' },
      SET_7: { fill: 'none', fillOpacity: '0', stroke: 'White', strokeWidth: '0' },
      CONTEXT_BLUE: { fill: '#4A87B5', fillOpacity: '1', stroke: 'none', strokeWidth: '0' },
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



DesignerEngine.moduleFilenames = [
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
    id: 'standard-spacer-NE',
    filename: 'standard-spacer-NE.svg',
    product: 'Standard Spacer',
    anchors: [
      { type: "FSNE", x: 109.113135, y: 139.408133 },
      { type: "HSNE", x: 109.113135, y: 109.818297 }
    ],
    price: 4000,
    dim_NE: 980,
    dim_NW: 280,
    dim_height: 300
  },
  {
    id: 'standard-spacer-NW',
    filename: 'standard-spacer-NW.svg',
    product: 'Standard Spacer',
    anchors: [
      { type: "HSNW", x: 130.886865, y: 109.818297 },
      { type: "FSNW", x: 130.886865, y: 139.408133 }
    ],
    price: 4000,
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
    price: 8000,
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
    price: 8000,
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
    price: 7000,
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
    price: 7000,
    dim_NW: 1420,
    dim_NE: 280,
    dim_height: 300
  },
  {
    id: 'wide-spacer-NW',
    filename: 'wide-spacer-NW.svg',
    product: 'Wide Spacer',
    anchors: [
      { type: "FWNW", x: 118.105399, y: 135.194418 },
      { type: "HWNW", x: 118.105399, y: 105.604582 }
    ],
    price: 5000,
    dim_NW: 1420,
    dim_NE: 280,
    dim_height: 300
  },
  {
    id: 'wide-spacer-NE',
    filename: 'wide-spacer-NE.svg',
    product: 'Wide Spacer',
    anchors: [
      { type: "HWNE", x: 118.950485, y: 105.604582 },
      { type: "FWNE", x: 118.950485, y: 135.194418 }
    ],
    price: 5000,
    dim_NE: 1420,
    dim_NW: 280,
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
    id: 'deep-base-NE',
    product: 'Deep Base',
    filename: 'deep-base-NE.svg',
    anchors: [
      { type: "HDNE", x: 123.440863, y: 99.040327 },
      { type: "SW", x: 62.67575, y: 151.612438 },
      { type: "NE", x: 184.205976, y: 81.446929 }
    ],
    price: 14500,
    dim_NE: 1420,
    dim_NW: 450,
    dim_height: 430
  },
  {
    id: 'deep-base-NW',
    product: 'Deep Base',
    filename: 'deep-base-NW.svg',
    anchors: [
      { type: "NW", x: 60.746793, y: 81.446929 },
      { type: "SE", x: 182.277019, y: 151.612438 },
      { type: "HDNW", x: 121.511852, y: 99.040327 }
    ],
    price: 14500,
    dim_NW: 1420,
    dim_NE: 450,
    dim_height: 430
  },
  {
    id: 'deep-extension-NE',
    filename: 'deep-extension-NE.svg',
    product: 'Deep Extension',
    anchors: [
      { type: "FDNE", x: 118.950485, y: 135.194418 },
      { type: "HDNE", x: 118.950485, y: 105.604582 }
    ],
    price: 9500,
    dim_NE: 1420,
    dim_NW: 450,
    dim_height: 300
  },
  {
    id: 'deep-extension-NW',
    filename: 'deep-extension-NW.svg',
    product: 'Deep Extension',
    anchors: [
      { type: "FDNW", x: 118.105399, y: 135.194418 },
      { type: "HDNW", x: 118.105399, y: 105.604582 }
    ],
    price: 9500,
    dim_NW: 1420,
    dim_NE: 450,
    dim_height: 300
  },
  {
    id: 'deep-spacer-NE',
    filename: 'deep-spacer-NE.svg',
    product: 'Deep Spacer',
    anchors: [
      { type: "FDNE", x: 118.950485, y: 135.194418 },
      { type: "HDNE", x: 118.950485, y: 105.604582 }
    ],
    price: 6000,
    dim_NE: 1420,
    dim_NW: 450,
    dim_height: 300
  },
  {
    id: 'deep-spacer-NW',
    filename: 'deep-spacer-NW.svg',
    product: 'Deep Spacer',
    anchors: [
      { type: "FDNW", x: 118.105399, y: 135.194418 },
      { type: "HDNW", x: 118.105399, y: 105.604582 }
    ],
    price: 6000,
    dim_NW: 1420,
    dim_NE: 450,
    dim_height: 300
  },
  {
    id: 'compact-base-NE',
    product: 'Compact Base',
    filename: 'compact-base-NE.svg',
    anchors: [
      { type: "HCNE", x: 114.476518, y: 95.933639 },
      { type: "SW", x: 84.682628, y: 120.336618 },
      { type: "NE", x: 129.845322, y: 94.261925 }
    ],
    price: 9500,
    dim_NE: 520,
    dim_NW: 450,
    dim_height: 430
  },
  {
    id: 'compact-base-NW',
    product: 'Compact Base',
    filename: 'compact-base-NW.svg',
    anchors: [
      { type: "NW", x: 99.107715, y: 94.261925 },
      { type: "SE", x: 144.270408, y: 120.336618 },
      { type: "HCNW", x: 114.476518, y: 95.933639 }
    ],
    price: 9500,
    dim_NW: 520,
    dim_NE: 450,
    dim_height: 430
  },
  {
    id: 'compact-extension-NE',
    filename: 'compact-extension-NE.svg',
    product: 'Compact Extension',
    anchors: [
      { type: "FCNE", x: 114.425775, y: 132.438223 },
      { type: "HCNE", x: 114.425775, y: 102.848356 }
    ],
    price: 8500,
    dim_NE: 520,
    dim_NW: 450,
    dim_height: 300
  },
  {
    id: 'compact-extension-NW',
    filename: 'compact-extension-NW.svg',
    product: 'Compact Extension',
    anchors: [
      { type: "FCNW", x: 114.425775, y: 132.438223 },
      { type: "HCNW", x: 114.425775, y: 102.848356 }
    ],
    price: 8500,
    dim_NW: 520,
    dim_NE: 450,
    dim_height: 300
  },
  {
    id: 'compact-spacer-NE',
    filename: 'compact-spacer-NE.svg',
    product: 'Compact Spacer',
    anchors: [
      { type: "FCNE", x: 114.425775, y: 132.438223 },
      { type: "HCNE", x: 114.425775, y: 102.848356 }
    ],
    price: 5000,
    dim_NE: 520,
    dim_NW: 450,
    dim_height: 300
  },
  {
    id: 'compact-spacer-NW',
    filename: 'compact-spacer-NW.svg',
    product: 'Compact Spacer',
    anchors: [
      { type: "FCNW", x: 114.425775, y: 132.438223 },
      { type: "HCNW", x: 114.425775, y: 102.848356 }
    ],
    price: 5000,
    dim_NW: 520,
    dim_NE: 450,
    dim_height: 300
  },
  {
    id: 'lamp-NW',
    filename: 'lamp-NW.svg',
    product: 'Lamp',
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
    product: 'Lamp',
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
    product: 'Lamp',
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
    product: 'Lamp',
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
    product: 'Lamp',
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
    product: 'Lamp',
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
    product: 'Lamp',
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
    product: 'Lamp',
    anchors: [
      { type: "FSNE", x: 138.180926, y: 142.876599 }
    ],
    price: 4500,
    dim_NE: 720,
    dim_NW: 280,
    dim_height: 760
  },
  {
    id: 'lamp-compact-NW-N',
    filename: 'lamp-compact-NW-N.svg',
    product: 'Lamp',
    anchors: [
      { type: "FCNW", x: 115.476518, y: 95.933639 }
    ],
    price: 4500,
    dim_NE: 720,
    dim_NW: 280,
    dim_height: 760
  },
  {
    id: 'lamp-compact-NW-W',
    filename: 'lamp-compact-NW-W.svg',
    product: 'Lamp',
    anchors: [
      { type: "FCNW", x: 114.476518, y: 95.933639 }
    ],
    price: 4500,
    dim_NE: 720,
    dim_NW: 280,
    dim_height: 760
  },
  {
    id: 'lamp-compact-NE-N',
    filename: 'lamp-compact-NE-N.svg',
    product: 'Lamp',
    anchors: [
      { type: "FCNE",  x: 113.476518, y: 95.933639 }
    ],
    price: 4500,
    dim_NE: 720,
    dim_NW: 280,
    dim_height: 760
  },
  {
    id: 'lamp-compact-NE-E',
    filename: 'lamp-compact-NE-E.svg',
    product: 'Lamp',
    anchors: [
      { type: "FCNE", x: 114.476518, y: 95.933639 }
    ],
    price: 4500,
    dim_NE: 720,
    dim_NW: 280,
    dim_height: 760
  }

];


DesignerEngine.contextFigures = [
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



DesignerEngine.testPieces = DesignerEngine.moduleFilenames.map(module => ({
  ...module,
  name: module.id.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
  imagePath: `./images/designer/modules/${module.filename}`,
  width: 240,
  height: 240
}));

// Core helper functions
DesignerEngine.findConnections = function (piece, placedPieces) {
  return placedPieces.flatMap(otherPiece =>
    otherPiece === piece ? [] :
      piece.piece.anchors.flatMap(anchor =>
        otherPiece.piece.anchors
          .filter(otherAnchor => {
            const isCompatible = DesignerEngine.compatibilityMap[anchor.type] === otherAnchor.type ||
              DesignerEngine.compatibilityMap[otherAnchor.type] === anchor.type;
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



DesignerEngine.isRoot = function (piece, placedPieces) {
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

DesignerEngine.findGroupFromRoot = function (root, placedPieces, visited = new Set()) {
  if (visited.has(root)) return [];
  visited.add(root);

  const group = [root];
  placedPieces.forEach(piece => {
    if (!visited.has(piece) && root.piece.anchors.some(rootAnchor => {
      return piece.piece.anchors.some(pieceAnchor => {
        // Check for both standard and wide head-foot connections
        // Check for standard, wide, and deep head-foot connections
        const isHeadToFoot = ((rootAnchor.type.startsWith('HS') || rootAnchor.type.startsWith('HW') || rootAnchor.type.startsWith('HD') || rootAnchor.type.startsWith('HC')) &&
          (pieceAnchor.type.startsWith('FS') || pieceAnchor.type.startsWith('FW') || pieceAnchor.type.startsWith('FD') || pieceAnchor.type.startsWith('FC')));

        const isFootToHead = ((rootAnchor.type.startsWith('FS') || rootAnchor.type.startsWith('FW') || rootAnchor.type.startsWith('FD') || rootAnchor.type.startsWith('FC')) &&
          (pieceAnchor.type.startsWith('HS') || pieceAnchor.type.startsWith('HW') || pieceAnchor.type.startsWith('HD') || pieceAnchor.type.startsWith('HC')));
        if (!isHeadToFoot && !isFootToHead) return false;

        const [x1, y1] = [root.x + rootAnchor.x, root.y + rootAnchor.y];
        const [x2, y2] = [piece.x + pieceAnchor.x, piece.y + pieceAnchor.y];
        return Math.abs(x1 - x2) < 0.1 && Math.abs(y1 - y2) < 0.1;
      });
    })) {
      group.push(...DesignerEngine.findGroupFromRoot(piece, placedPieces, visited));
    }
  });

  // Sort by y-coordinate ascending (smaller y values first)
  return group.sort((a, b) => a.y - b.y);
}

DesignerEngine.orderPieces = function (placedPieces) {
  const roots = placedPieces.filter(p => DesignerEngine.isRoot(p, placedPieces));
  const groups = roots.map(root => ({
    root,
    pieces: DesignerEngine.findGroupFromRoot(root, placedPieces)
  }));

  groups.sort((a, b) => (b.root.y + b.root.piece.height) - (a.root.y + a.root.piece.height));
  return groups.flatMap(g => g.pieces);
}

DesignerEngine.generateConfigCode = function (placedPieces, placedContextFigures) {
  if (placedPieces.length === 0 && placedContextFigures.length === 0) return '';

  const processed = new Set();
  const usedConnections = new Set();

  // Find all root pieces and their groups
  const roots = placedPieces.filter(p => DesignerEngine.isRoot(p, placedPieces));
  const groups = roots.map(root => ({
    root,
    pieces: DesignerEngine.findGroupFromRoot(root, placedPieces)
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
        const verticalConn = DesignerEngine.findConnections(piece, [nextPiece])
          .find(conn =>
            ((conn.pieceAnchor.type.startsWith('FS') || conn.pieceAnchor.type.startsWith('FW') || conn.pieceAnchor.type.startsWith('FD') || conn.pieceAnchor.type.startsWith('FC')) &&
              (conn.otherAnchor.type.startsWith('HS') || conn.otherAnchor.type.startsWith('HW') || conn.otherAnchor.type.startsWith('HD') || conn.otherAnchor.type.startsWith('HC'))) ||
            ((conn.pieceAnchor.type.startsWith('HS') || conn.pieceAnchor.type.startsWith('HW') || conn.pieceAnchor.type.startsWith('HD') || conn.pieceAnchor.type.startsWith('HC')) &&
              (conn.otherAnchor.type.startsWith('FS') || conn.otherAnchor.type.startsWith('FW') || conn.otherAnchor.type.startsWith('FD') || conn.otherAnchor.type.startsWith('FC')))
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
          const lateralConn = DesignerEngine.findConnections(piece1, [piece2])
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

DesignerEngine.animateConfiguration = async function (code, setPlacedPieces, setNewPieceId, setPlacedContextFigures) {
  console.log('Starting animation with code:', code);

  // Get reference to the global DesignerEngine.contextFigures array
  const contextFiguresRef = window.DesignerEngine.contextFigures || DesignerEngine.contextFigures;

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
    return DesignerEngine.testPieces.some(p => p.id === token);
  }

  function isLateralConnection(token) {
    return ['NE-SW', 'SW-NE', 'NW-SE', 'SE-NW'].includes(token);
  }

  function createPiece(moduleId, x = 200, y = 200) {
    const moduleInfo = DesignerEngine.testPieces.find(p => p.id === moduleId);
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
      // Updated to include standard, wide, deep, and compact variants
      return /^(HS|FS|HW|FW|HD|FD|HC|FC)(NE|NW)-(HS|FS|HW|FW|HD|FD|HC|FC)(NE|NW)$/.test(token);
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
        setPlacedPieces(DesignerEngine.orderPieces([...pieces]));

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


DesignerEngine.canPieceReplace = function (originalPiece, newPieceTemplate, placedPieces) {
  const connections = DesignerEngine.findConnections(originalPiece, placedPieces);

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

DesignerEngine.getCompatibleReplacements = function (piece, placedPieces) {
  return DesignerEngine.testPieces.filter(template =>
    template.id !== piece.piece.id &&
    DesignerEngine.canPieceReplace(piece, template, placedPieces)
  );
}

DesignerEngine.hasActiveHeadAnchor = function (piece, placedPieces) {
  return DesignerEngine.findConnections(piece, placedPieces)
    .some(conn => conn.pieceAnchor.type.includes('H'));
}

DesignerEngine.countActiveConnections = function (piece, placedPieces) {
  return new Set(DesignerEngine.findConnections(piece, placedPieces)
    .map(conn => conn.pieceAnchor.type)).size;
}

DesignerEngine.applySVGTheme = function (svgDoc, theme) {
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
    const matchingSet = Object.entries(DesignerEngine.originalParameterSets).find(([_, set]) => {
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
      const themeMapping = DesignerEngine.colorThemes[theme].parameterMappings[setKey];

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

