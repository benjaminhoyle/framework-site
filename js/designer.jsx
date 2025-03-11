//designer.jsx

export function ModuleBuilder() {
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
  const [hideControls, setHideControls] = React.useState(false);
  const [isSimplifiedMode, setIsSimplifiedMode] = React.useState(false);
  const MobileControlPanel = ({
    showButtons,
    onToggleButtons,
    showDimensions,
    setShowDimensions,
    isExpanded,
    setIsExpanded,
    selectedTheme,
    onThemeChange,
    onAddContext,
    isContextPlacementMode,
    configCode,
    placedPieces,
    setShowQR,
    buttonState,
    setButtonState,
    isSimplifiedMode
  }) => {
    // Only show on mobile devices
    const [isMobile, setIsMobile] = React.useState(false);
    const [showThemeSelector, setShowThemeSelector] = React.useState(false);
  
    React.useEffect(() => {
      const checkMobile = () => {
        setIsMobile(window.innerWidth <= 768);
      };
  
      checkMobile();
      window.addEventListener('resize', checkMobile);
      return () => window.removeEventListener('resize', checkMobile);
    }, []);
  
    // Enhanced check for simplified mode - don't render if in simplified mode or not on mobile
    // Check multiple conditions to make sure this component is properly hidden
    if (!isMobile || isSimplifiedMode || 
        document.body.classList.contains('simplified-mode') || 
        window.location.search.includes('mode=simplified')) {
      return null;
    }
  
    return (
      <div className="fixed bottom-0 left-0 right-0 bg-white shadow-lg p-3 z-50 mobile-control-panel" style={{ borderTop: '1px solid #e5e7eb' }}>
        <div className="flex flex-wrap justify-center gap-2">
          {/* Current theme indicator and toggle */}
          <button
            onClick={() => setShowThemeSelector(!showThemeSelector)}
            className="flex-1 bg-white border border-gray-200 rounded-md px-3 py-2 text-sm shadow-sm designer-btn"
          >
            {DesignerEngine.colorThemes[selectedTheme].displayName} ▾
          </button>
  
          {/* Add Context */}
          <button
            onClick={onAddContext}
            className={`flex-1 bg-white border border-gray-200 rounded-md px-3 py-2 text-sm shadow-sm designer-btn ${isContextPlacementMode ? 'bg-blue-50 border-blue-200' : ''}`}
          >
            Add Context
          </button>
  
          {/* Show/Hide dimensions */}
          <button
            onClick={() => setShowDimensions(!showDimensions)}
            className="flex-1 bg-white border border-gray-200 rounded-md px-3 py-2 text-sm shadow-sm designer-btn"
          >
            {showDimensions ? 'Hide Sizes' : 'Show Sizes'}
          </button>
  
          {/* Toggle Controls */}
          <button
            onClick={onToggleButtons}
            className="flex-1 bg-white border border-gray-200 rounded-md px-3 py-2 text-sm shadow-sm designer-btn"
          >
            {showButtons ? 'Hide Buttons' : 'Show Buttons'}
          </button>
        </div>
  
        {/* Theme selector dropdown */}
        {showThemeSelector && (
          <div className="mt-2 pb-1 border-t border-gray-200 pt-2">
            <div className="flex flex-wrap gap-2 justify-center">
              {Object.entries(DesignerEngine.colorThemes).map(([themeKey, theme]) => (
                <button
                  key={themeKey}
                  onClick={() => {
                    onThemeChange(themeKey);
                    setShowThemeSelector(false);
                  }}
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors ${selectedTheme === themeKey
                    ? 'bg-blue-100 border border-blue-300'
                    : 'bg-white border border-gray-200'
                    }`}
                >
                  {theme.displayName}
                </button>
              ))}
            </div>
          </div>
        )}
  
        {/* WhatsApp and Share buttons, only show when pieces are placed */}
        {placedPieces.length > 0 && (
          <div className="mt-2 flex gap-2 border-t border-gray-200 pt-2">
            <a
              href={`https://wa.me/254783891005?text=${encodeURIComponent(
                `I'd like to place an order for:\n${Object.entries(
                  placedPieces.reduce((acc, { piece }) => {
                    const baseProductType = piece.product;
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
                  .map(([product, { count, price }]) => {
                    return `${count} x ${product} @ Ksh ${price.toLocaleString()}`;
                  })
                  .join('\n')
                }\nAll in ${DesignerEngine.colorThemes[selectedTheme].displayName}\nTotal Cost: Ksh ${placedPieces.reduce((sum, { piece }) => sum + piece.price, 0).toLocaleString()
                } (VAT inclusive)`
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 bg-green-600 text-white text-center px-3 py-2 rounded-md text-sm font-medium"
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
                  setTimeout(() => {
                    if (buttonState === 'copied') {
                      setButtonState('initial');
                    }
                  }, 5000);
                } catch (err) {
                  console.error('Failed to copy URL:', err);
                }
              }}
              className="flex-1 bg-indigo-600 text-white text-center px-3 py-2 rounded-md text-sm font-medium"
            >
              {buttonState === 'initial' ? 'Share Design' :
                buttonState === 'copied' ? 'Link Copied!' :
                  'Close QR Code'}
            </button>
          </div>
        )}
      </div>
    );
  };


 // Update the mobile-specific CSS to make the plus buttons the same size as other control buttons
React.useEffect(() => {
  // Create style element for mobile adjustments
  const mobileStyle = document.createElement('style');
  mobileStyle.textContent = `
  @media (max-width: 768px) {
    /* Make buttons larger on mobile */
    .designer-btn {
      font-size: 16px !important;
      padding: 8px 12px !important;
      min-height: 44px !important;
    }
    
    /* Hide desktop controls on mobile */
    .desktop-only-controls {
      display: none !important;
    }
    
    /* Make ALL control buttons the same size */
    .anchor-control-btn, .module-control-btn, .context-control-btn {
      width: 22px !important;
      height: 22px !important;
      font-size: 16px !important;
      margin: 2px !important;
    }
    
    /* Make pricing more compact */
    .pricing-panel {
      position: fixed !important;
      top: 10px !important; /* Position at top instead of bottom */
      right: 10px !important;
      max-width: 160px !important;
      padding: 8px !important;
      border-radius: 8px !important;
      background-color: rgba(255, 255, 255, 0.9) !important;
      z-index: 1000 !important;
    }
    
    .pricing-panel .breakdown {
      font-size: 10px !important;
      line-height: 1.2 !important;
      max-height: 80px !important;
      overflow-y: auto !important;
    }
    
    .pricing-panel .total {
      font-size: 14px !important;
      font-weight: bold !important;
      margin-top: 4px !important;
    }
    
    /* Make text more legible */
    .control-text {
      font-size: 16px !important;
    }
    
    /* Add bottom padding to container for mobile control panel */
    .designer-container {
      padding-bottom: 120px !important;
    }
  }
  
  /* Hide mobile pricing in desktop view */
  @media (min-width: 769px) {
    .pricing-panel {
      display: none !important;
    }
  }
  
  /* Hide mobile elements in simplified mode */
  .simplified-mode .pricing-panel,
  .simplified-mode .mobile-control-panel {
    display: none !important;
  }
`;
  document.head.appendChild(mobileStyle);

  // Cleanup on unmount
  return () => {
    document.head.removeChild(mobileStyle);
  };
}, []);

  // Move QRPanel inside the function
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

  // Dimension calculation functions
  const calculateLateralDimensions = (piece, placedPieces, processedPairs = new Set()) => {
    const dimensions = [];

    // Helper to get unique pair identifier
    const getPairId = (p1, a1, p2, a2) => {
      const points = [`${p1.piece.id}-${a1.type}`, `${p2.piece.id}-${a2.type}`].sort();
      return points.join('->');
    };

    // Process each lateral anchor
    piece.piece.anchors.forEach(anchor => {
      // Only process lateral anchors
      if (!anchor.type.match(/^(NE|NW|SE|SW)$/)) {
        return;
      }

      // For corner units - handle virtual anchors and their connections
      if (piece.piece.id.includes('corner-')) {
        const virtualAnchor = getVirtualAnchorPoint(piece, anchor.type);
        if (virtualAnchor) {
          // Check if the real anchor is connected to other pieces
          const connection = DesignerEngine.findConnections(piece, placedPieces).find(conn => conn.pieceAnchor === anchor);

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
              const oppositeType = DesignerEngine.compatibilityMap[currentAnchor.type];

              // Find opposite anchor on current piece
              const oppositeAnchor = currentPiece.piece.anchors.find(a => a.type === oppositeType);
              if (!oppositeAnchor) break;

              // Add dimension for current piece
              const dimKey = oppositeAnchor.type.includes('NE') || oppositeAnchor.type.includes('SW') ? 'dim_NE' : 'dim_NW';
              totalDimension += currentPiece.piece[dimKey];

              // If opposite anchor is unused, we've found our end point
              if (!DesignerEngine.findConnections(currentPiece, placedPieces).some(conn => conn.pieceAnchor === oppositeAnchor)) {
                lastOpenPiece = currentPiece;
                lastOpenAnchor = oppositeAnchor;
                chain.push({ piece: currentPiece, anchor: oppositeAnchor });
                break;
              }

              // Follow the connection
              const nextConnection = DesignerEngine.findConnections(currentPiece, placedPieces)
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
      if (DesignerEngine.findConnections(piece, placedPieces).some(conn => conn.pieceAnchor === anchor)) {
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
        const oppositeType = DesignerEngine.compatibilityMap[currentAnchor.type];

        // Find opposite anchor on current piece
        const oppositeAnchor = currentPiece.piece.anchors.find(a => a.type === oppositeType);

        if (!oppositeAnchor) break;

        // If opposite anchor is unused, we've found our pair
        if (!DesignerEngine.findConnections(currentPiece, placedPieces).some(conn => conn.pieceAnchor === oppositeAnchor)) {
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
        const connection = DesignerEngine.findConnections(currentPiece, placedPieces)
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
  };

  const getVirtualAnchorPoint = (piece, anchorType) => {
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
  };

  const getVerticalDimensions = (placedPieces) => {
    // Find all root pieces
    const roots = placedPieces.filter(p => DesignerEngine.isRoot(p, placedPieces));
    const groups = roots.map(root => ({
      root,
      pieces: DesignerEngine.findGroupFromRoot(root, placedPieces)
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
  };

  // Replace the existing DimensionLines component with this updated version
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
                isLamp={dim.isLamp}
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

  // Make sure these components are also in your ModuleBuilder

  // 1. VerticalDimensionLine component
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

  // 2. DimensionLine component for horizontal dimensions
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
          if (theme && Object.keys(DesignerEngine.colorThemes).includes(theme)) {
            setSelectedTheme(theme);
          }
          if (code) {
            setInputCode(code);
            // Add delay before starting animation
            await new Promise(resolve => setTimeout(resolve, 300));
            await DesignerEngine.animateConfiguration(code, setPlacedPieces, setNewPieceId, setPlacedContextFigures);
          }
        }
      }
    };
    loadFromHash();
  }, []);


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
    const availableFigures = DesignerEngine.contextFigures.filter(
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
    const availableFigures = DesignerEngine.contextFigures.filter(
      fig => fig.id !== placedFigure.id
    );
    if (availableFigures.length === 0) return;

    // Find current index and get next in rotation
    const currentIndex = DesignerEngine.contextFigures.findIndex(fig => fig.id === placedFigure.id);
    const nextIndex = (currentIndex + 1) % DesignerEngine.contextFigures.length;
    const nextFigure = DesignerEngine.contextFigures[nextIndex];

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
        const compatibleType = DesignerEngine.compatibilityMap[anchor.type] === otherAnchor.type ||
          DesignerEngine.compatibilityMap[otherAnchor.type] === anchor.type;
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

      // Extract the SVG filename from the data URL
      const svgPath = obj.data;
      const filename = svgPath.split('/').pop();

      // Use the filename as cache key instead of just the id
      const cacheKey = `${type === 'context' ? 'context-' : ''}${filename}`;

      // Cache handling
      if (!svgCache.current.has(cacheKey)) {
        const originalSvg = svgDoc.documentElement.cloneNode(true);
        svgCache.current.set(cacheKey, originalSvg);
      } else {
        const cachedSvg = svgCache.current.get(cacheKey);
        const freshSvg = cachedSvg.cloneNode(true);
        svgDoc.documentElement.replaceWith(freshSvg);
      }

      // Apply theme
      DesignerEngine.applySVGTheme(svgDoc, selectedTheme);

      // Handle anchor points only for furniture pieces
      if (type === 'furniture') {
        const anchorPointsString = svgDoc.documentElement.getAttribute('data-anchor-points');
        if (anchorPointsString) {
          const anchors = JSON.parse(anchorPointsString);
          const piece = DesignerEngine.testPieces.find(p => p.id === id);
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

    // Include placed pieces with content-based adjustments
    placedPieces.forEach(piece => {
      // Apply content margin adjustments (30% inset from each edge)
      const contentMargin = 0.3;
      const contentX = piece.x + (piece.piece.width * contentMargin);
      const contentY = piece.y + (piece.piece.width * contentMargin);
      const contentWidth = piece.piece.width * (1 - 2 * contentMargin);
      const contentHeight = piece.piece.height * (1 - 2 * contentMargin);

      bounds.minX = Math.min(bounds.minX, contentX);
      bounds.minY = Math.min(bounds.minY, contentY);
      bounds.maxX = Math.max(bounds.maxX, contentX + contentWidth);
      bounds.maxY = Math.max(bounds.maxY, contentY + contentHeight);
    });

    // Include context figures with similar adjustments
    placedContextFigures.forEach(figure => {
      const contentMargin = 0.2; // Less margin for context figures
      const figureWidth = 240;
      const figureHeight = 240;

      const contentX = figure.x + (figureWidth * contentMargin);
      const contentY = figure.y + (figureHeight * contentMargin);
      const contentWidth = figureWidth * (1 - 2 * contentMargin);
      const contentHeight = figureHeight * (1 - 2 * contentMargin);

      bounds.minX = Math.min(bounds.minX, contentX);
      bounds.minY = Math.min(bounds.minY, contentY);
      bounds.maxX = Math.max(bounds.maxX, contentX + contentWidth);
      bounds.maxY = Math.max(bounds.maxY, contentY + contentHeight);
    });

    return bounds;
  }, [placedPieces, placedContextFigures]);

  const updateZoom = React.useCallback(() => {
    // Don't update zoom if we're dragging
    if (draggingContextId) return;

    if (!containerRef.current) return;
    const bounds = calculateBounds();
    if (!bounds) return;

    // Asymmetric padding to account for UI elements - more moderate values
    const paddingLeft = 40;
    const paddingRight = 150;  // Extra space for right panel
    const paddingTop = 40;
    const paddingBottom = 100; // Extra space for bottom controls
    
    const container = containerRef.current;
    const contentWidth = bounds.maxX - bounds.minX + paddingLeft + paddingRight;
    const contentHeight = bounds.maxY - bounds.minY + paddingTop + paddingBottom;

    const scaleX = container.clientWidth / contentWidth;
    const scaleY = container.clientHeight / contentHeight;
    const newScale = Math.min(scaleX, scaleY);

    // Adjust center calculation to account for asymmetric padding
    const centerX = bounds.minX + (bounds.maxX - bounds.minX) / 2;
    const centerY = bounds.minY + (bounds.maxY - bounds.minY) / 2;

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
      DesignerEngine.animateConfiguration(inputCode, setPlacedPieces, setNewPieceId, setPlacedContextFigures);
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
      const basePiece = DesignerEngine.testPieces.find(p => p.id === 'standard-base-NE');
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


  // Replace the existing simplified mode useEffect with this:
  React.useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode');

    if (mode === 'simplified') {
      // Set state variables
      setIsSimplifiedMode(true);
      setShowButtons(false);
      setHideControls(true);
      setShowDimensions(false);
      setIsExpanded(false);

      // Add a class to the body element for more global CSS control
      document.body.classList.add('simplified-mode');

      // Create a style element with high-specificity rules
      const styleElement = document.createElement('style');
      styleElement.textContent = `
        /* Force hide all controls in simplified mode with high specificity */
        body.simplified-mode .pricing-panel, 
        body.simplified-mode .mobile-control-panel,
        body.simplified-mode .desktop-only-controls,
        body.simplified-mode .fixed.bottom-0.left-0.right-0,
        body.simplified-mode .helper-controls,
        body.simplified-mode .editor-controls {
          display: none !important;
          opacity: 0 !important;
          visibility: hidden !important;
          pointer-events: none !important;
        }
      `;
      document.head.appendChild(styleElement);

      // Direct manipulation of elements as a fallback
      setTimeout(() => {
        document.querySelectorAll('.pricing-panel, .mobile-control-panel, .desktop-only-controls, .fixed.bottom-0').forEach(el => {
          el.style.display = 'none';
          el.style.visibility = 'hidden';
        });
      }, 100);

      // Store references for cleanup
      const simplifiedStyleElement = styleElement;

      // Ensure zoom updates
      requestAnimationFrame(() => updateZoom());
      setTimeout(() => updateZoom(), 500);

      return () => {
        // Cleanup when component unmounts or simplified mode changes
        document.body.classList.remove('simplified-mode');
        if (simplifiedStyleElement && simplifiedStyleElement.parentNode) {
          simplifiedStyleElement.parentNode.removeChild(simplifiedStyleElement);
        }
      };
    }
  }, [updateZoom]);

  // Add this new useEffect to handle zoom updates when pieces change in simplified mode
  React.useEffect(() => {
    if (isSimplifiedMode) {
      updateZoom();
    }
  }, [placedPieces, placedContextFigures, isSimplifiedMode, updateZoom]);

  React.useEffect(() => {
    window.placedPieces = placedPieces;
    window.selectedTheme = selectedTheme;
    window.setInputCode = setInputCode;
    window.handleCodeSubmit = handleCodeSubmit;
    window.setSelectedTheme = setSelectedTheme;
    window.setShowDimensions = setShowDimensions;
  }, [placedPieces, selectedTheme, handleCodeSubmit]);

  React.useEffect(() => {
    setConfigCode(DesignerEngine.generateConfigCode(placedPieces, placedContextFigures));
  }, [placedPieces, placedContextFigures]);

  const handleCyclePiece = (piece, e) => {
    e.stopPropagation();

    // Get connections to determine if this is a first piece
    const connections = DesignerEngine.findConnections(piece, placedPieces);
    const isFirstPiece = connections.length === 0;

    // Get all possible pieces for this position, including current piece
    const allPieces = DesignerEngine.testPieces.filter(p => {
      // Must be current piece or able to replace it
      const isValidReplacement = p.id === piece.piece.id || DesignerEngine.canPieceReplace(piece, p, placedPieces);

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
    const compatiblePieces = DesignerEngine.testPieces.filter(piece =>
      piece.anchors.some(a => DesignerEngine.compatibilityMap[anchor.type] === a.type)
    );
    if (compatiblePieces.length === 0) return;

    const newPiece = compatiblePieces[0];
    const compatibleAnchor = newPiece.anchors.find(a =>
      DesignerEngine.compatibilityMap[anchor.type] === a.type
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
    setPlacedPieces(DesignerEngine.orderPieces([...placedPieces, newPlacedPiece]));

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
      <div className="fixed top-4 right-4 z-50 desktop-only-controls">
        <div className="bg-white rounded-lg shadow-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600 control-text">Shelf color:</span>
            <select
              value={selectedTheme}
              onChange={(e) => onThemeChange(e.target.value)}
              className="bg-white border border-gray-200 rounded-md shadow-sm px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer hover:border-gray-300 transition-colors duration-200 sm:text-xs md:text-sm theme-select"
            >
              {Object.entries(DesignerEngine.colorThemes).map(([themeKey, theme]) => (
                <option key={themeKey} value={themeKey}>
                  {theme.displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="relative">
            <button
              onClick={onAddContext}
              className={`w-full bg-white border border-gray-200 rounded-md px-3 py-1.5 text-xs hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-200 shadow-sm sm:text-xs md:text-sm designer-btn ${isContextPlacementMode ? 'bg-blue-50 border-blue-200' : ''}`}
            >
              Add Context
            </button>
            {isContextPlacementMode && (
              <div className="absolute top-full left-0 right-0 mt-5">
                <div className="bg-white rounded-lg shadow-lg p-2 text-xs text-gray-600 relative control-text">
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
      <div className="fixed bottom-6 left-6 z-50 desktop-only-controls">
        <div className="relative">
          <div className="bg-white rounded-lg shadow-lg p-1.5 flex gap-2">
            <div className="relative">
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-200 sm:text-xs md:text-sm designer-btn"
              >
                {isExpanded ? 'Hide Help' : 'Show Help'}
              </button>
            </div>
            <div className="w-px bg-gray-200"></div>
            <button
              onClick={onToggleButtons}
              className="px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-200 sm:text-xs md:text-sm designer-btn"
            >
              {showButtons ? 'Hide Controls' : 'Show Controls'}
            </button>

            <div className="w-px bg-gray-200"></div>
            <button
              onClick={() => setShowDimensions(!showDimensions)}
              className="px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-200 sm:text-xs md:text-sm designer-btn"
            >
              {showDimensions ? 'Hide Dimensions' : 'Show Dimensions'}
            </button>
          </div>
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
                      <span className="text-xs text-gray-700 control-text">{control.description}</span>
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

  // Expose API for simplified designer
  React.useEffect(() => {
    window.DesignerAPI = {
      // State setters
      setPlacedPieces,
      setNewPieceId,
      setPlacedContextFigures,
      setSelectedTheme,
      setShowDimensions,
      setHideControls,

      // Core functions
      animateConfiguration: (code) => DesignerEngine.animateConfiguration(
        code,
        setPlacedPieces,
        setNewPieceId,
        setPlacedContextFigures
      ),

      // Helper functions
      generateConfigCode: () => DesignerEngine.generateConfigCode(placedPieces, placedContextFigures),
      updateZoom,
      orderPieces: () => DesignerEngine.orderPieces(placedPieces),
      getColorThemes: () => DesignerEngine.colorThemes
    };

    return () => {
      window.DesignerAPI = undefined;
    };
  }, [placedPieces, placedContextFigures, updateZoom, hideControls]);

  return (
    <div ref={containerRef}
      className={`relative w-full h-screen bg-gray-100 overflow-hidden touch-none designer-container ${isSimplifiedMode ? 'simplified-mode' : ''}`}
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
          top: `${figure.anchorPoint.y - (60 / Math.max(1, scale))}px`, // Adjust by zoom level
          transform: `scale(${1 / scale})`,
          display: 'flex',
          gap: '4px',
          transformOrigin: 'center'
        }}
      >
        <button
          className="bg-red-500 rounded-full flex items-center justify-center text-white w-5 h-5 text-xs shadow-sm context-control-btn"
          onClick={(e) => {
            e.stopPropagation();
            handleContextDelete(figure.uniqueId);
          }}
        >
          -
        </button>
        <button
          className="bg-blue-500 rounded-full flex items-center justify-center text-white w-5 h-5 text-xs shadow-sm context-control-btn"
          onClick={(e) => {
            e.stopPropagation();
            handleContextCycle(figure);
          }}
        >
          ↻
        </button>
        <button
          className={`${draggingContextId === figure.uniqueId ? 'bg-green-600' : 'bg-green-500'} rounded-full w-6 h-6 text-white hover:bg-green-600 flex items-center justify-center context-control-btn`}
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
              {showButtons && !hideControls && (
                <>
                  {/* Control Buttons Group */}
                  {DesignerEngine.getCompatibleReplacements(placedPiece, placedPieces).length > 0 &&
                    DesignerEngine.countActiveConnections(placedPiece, placedPieces) <= 1 &&
                    !DesignerEngine.hasActiveHeadAnchor(placedPiece, placedPieces) && (
                      <div
                        className="absolute flex flex-col gap-1 items-center"
                        style={{
                          left: `${placedPiece.x + placedPiece.piece.width / 2}px`,
                          top: `${placedPiece.y + placedPiece.piece.height / 2 - (20 / Math.max(1, scale))}px`, // Add vertical offset that adjusts with zoom
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
                      className="absolute bg-green-500 rounded-full flex items-center justify-center text-white text-xs shadow-sm anchor-control-btn"
                      style={{
                        left: `${placedPiece.x + anchor.x}px`,
                        top: `${placedPiece.y + anchor.y - (40 / Math.max(1, scale))}px`, // Vertical offset adjusted for zoom
                        width: '22px', // Desktop size (smaller)
                        height: '22px', // Desktop size (smaller)
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

      {showDimensions && !isSimplifiedMode && (
        <DimensionLines
          placedPieces={placedPieces}
          scale={scale}
          offset={offset}
          containerRef={containerRef}
        />
      )}


      {/* Editor Controls */}
      {!isSimplifiedMode && (
        <EditorControls
          className="editor-controls"
          selectedTheme={selectedTheme}
          onThemeChange={(newTheme) => {
            setSelectedTheme(newTheme);
            document.querySelectorAll('object[type="image/svg+xml"]').forEach(obj => {
              const svgDoc = obj.contentDocument;
              if (!svgDoc?.documentElement) return;

              obj.style.visibility = 'hidden';

              // Extract filename from the path to use as cache key
              const svgPath = obj.data;
              const filename = svgPath.split('/').pop();
              const isContext = svgPath.includes('/context/');
              const cacheKey = `${isContext ? 'context-' : ''}${filename}`;

              const cachedSvg = svgCache.current.get(cacheKey);
              if (cachedSvg) {
                const freshSvg = cachedSvg.cloneNode(true);
                svgDoc.documentElement.replaceWith(freshSvg);
                DesignerEngine.applySVGTheme(svgDoc, newTheme);
              } else {
                DesignerEngine.applySVGTheme(svgDoc, newTheme);
              }

              obj.style.visibility = 'visible';
            });
          }}
          onAddContext={handleAddContext}
          showButtons={showButtons}
          isContextPlacementMode={isContextPlacementMode}
        />
      )}

      {!isSimplifiedMode && (
        <HelperControls
          className="helper-controls"
          showButtons={showButtons}
          onToggleButtons={() => setShowButtons(!showButtons)}
          isExpanded={isExpanded}
          setIsExpanded={setIsExpanded}
        />
      )}
      {placedPieces.length > 0 && !isSimplifiedMode && (
        <div className="fixed bottom-6 right-6 bg-white rounded-lg shadow-lg p-4 max-w-md z-50 desktop-only-controls">
          {/* Product List - Desktop version */}
          {Object.entries(
            placedPieces.reduce((acc, { piece }) => {
              const baseProductType = piece.product;
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
                    const baseProductType = piece.product;
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
                  .map(([product, { count, price }]) => {
                    return `${count} x ${product} @ Ksh ${price.toLocaleString()}`;
                  })
                  .join('\n')
                }\nAll in ${DesignerEngine.colorThemes[selectedTheme].displayName}\nTotal Cost: Ksh ${placedPieces.reduce((sum, { piece }) => sum + piece.price, 0).toLocaleString()
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
                  setTimeout(() => {
                    if (buttonState === 'copied') {
                      setButtonState('initial');
                    }
                  }, 5000);
                } catch (err) {
                  console.error('Failed to copy URL:', err);
                }
              }}
              className="block w-full bg-indigo-600 text-white text-center px-2.5 py-1 rounded-md text-xs font-medium"
            >
              {buttonState === 'initial' ? 'Share Your Design' :
                buttonState === 'copied' ? 'Link copied! Click for QR' :
                  'Close QR Code'}
            </button>
          </div>
        </div>
      )}

      {/* 3. Mobile-only pricing panel with simplified mode check */}
      {placedPieces.length > 0 && !isSimplifiedMode && (
        <div className="pricing-panel">
          <div className="breakdown">
            {Object.entries(
              placedPieces.reduce((acc, { piece }) => {
                const baseProductType = piece.product;
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
              .map(([product, { count }]) => {
                // More compact format for mobile
                return (
                  <div key={product}>
                    {`${count}x ${product.replace(' ', '')}`}
                  </div>
                );
              })}
          </div>
          <div className="total border-t border-gray-200 pt-1 mt-1">
            Ksh {placedPieces.reduce((sum, { piece }) => sum + piece.price, 0).toLocaleString()}
          </div>
        </div>
      )}


      {/* Add isSimplifiedMode prop to MobileControlPanel */}
      <MobileControlPanel
        showButtons={showButtons}
        onToggleButtons={() => setShowButtons(!showButtons)}
        showDimensions={showDimensions}
        setShowDimensions={setShowDimensions}
        isExpanded={isExpanded}
        setIsExpanded={setIsExpanded}
        selectedTheme={selectedTheme}
        onThemeChange={(newTheme) => {
          setSelectedTheme(newTheme);
          document.querySelectorAll('object[type="image/svg+xml"]').forEach(obj => {
            const svgDoc = obj.contentDocument;
            if (!svgDoc?.documentElement) return;

            obj.style.visibility = 'hidden';

            // Extract filename from the path to use as cache key
            const svgPath = obj.data;
            const filename = svgPath.split('/').pop();
            const isContext = svgPath.includes('/context/');
            const cacheKey = `${isContext ? 'context-' : ''}${filename}`;

            const cachedSvg = svgCache.current.get(cacheKey);
            if (cachedSvg) {
              const freshSvg = cachedSvg.cloneNode(true);
              svgDoc.documentElement.replaceWith(freshSvg);
              DesignerEngine.applySVGTheme(svgDoc, newTheme);
            } else {
              DesignerEngine.applySVGTheme(svgDoc, newTheme);
            }

            obj.style.visibility = 'visible';
          });
        }}
        onAddContext={handleAddContext}
        isContextPlacementMode={isContextPlacementMode}
        configCode={configCode}
        placedPieces={placedPieces}
        setShowQR={setShowQR}
        buttonState={buttonState}
        setButtonState={setButtonState}
        isSimplifiedMode={isSimplifiedMode}
      />
    </div>



  );
}
