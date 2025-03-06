// simplified-designer.js
class SimplifiedDesigner {
    constructor(containerId, options = {}) {
      this.containerId = containerId;
      this.options = {
        size: options.size || 400,
        defaultCode: options.defaultCode || '({standard-base-NE})',
        defaultTheme: options.defaultTheme || 'THEME_1',
        ...options
      };
      
      this.container = document.getElementById(this.containerId);
      if (!this.container) {
        console.error(`Container with ID "${this.containerId}" not found`);
        return;
      }
      
      this.initialize();
    }
    
    initialize() {
      // Create iframe to load the full designer
      this.designerFrame = document.createElement('iframe');
      this.designerFrame.style.width = `${this.options.size}px`;
      this.designerFrame.style.height = `${this.options.size}px`;
      this.designerFrame.style.border = 'none';
      this.designerFrame.style.overflow = 'hidden';
      
      this.designerFrame.src = 'designer.html';
      
      this.container.appendChild(this.designerFrame);
      
      // Wait for iframe to load before initializing
      this.designerFrame.onload = () => {
        this.hideControls();
        // Wait a bit more to ensure DesignerEngine is fully loaded
        setTimeout(() => {
          this.loadConfiguration(this.options.defaultCode, false); // false = no animation
        }, 500);
      };
  
      // Make dimensions accessible
      this.dimensions = {
        width: 0,
        height: 0,
        depth: 0
      };
    }
    
    hideControls() {
      try {
        const doc = this.designerFrame.contentDocument;
        if (!doc) return;
        
        const style = doc.createElement('style');
        style.textContent = `
          /* Hide menu controls */
          .fixed.top-4.right-4.z-50,
          .fixed.bottom-6.left-6.z-50,
          .fixed.bottom-6.right-6,
          .dimensions-svg {
            display: none !important;
          }
          
          /* Hide anchor point buttons (green + buttons) */
          button.absolute.bg-green-500,
          button.absolute.rounded-full,
          
          /* Hide all control buttons on pieces */
          .absolute button,
          
          /* Hide all buttons in the controls layer */
          div[style*="z-index: 20000"] button {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
            pointer-events: none !important;
          }
        `;
        doc.head.appendChild(style);
        
        // Force hide controls via the API if available
        setTimeout(() => {
          if (this.designerFrame.contentWindow.DesignerAPI) {
            this.designerFrame.contentWindow.DesignerAPI.setHideControls(true);
            this.designerFrame.contentWindow.DesignerAPI.setShowDimensions(false);
          }
        }, 300);
      } catch (err) {
        console.error('Error hiding controls:', err);
      }
    }
    
    loadConfiguration(code, animate = true) {
      if (!code || !this.designerFrame.contentWindow) return;
      
      try {
        console.log("Loading configuration:", code, animate ? "with animation" : "without animation");
        
        // Use the DesignerAPI exposed by the iframe
        if (this.designerFrame.contentWindow.DesignerAPI) {
          if (animate) {
            this.designerFrame.contentWindow.DesignerAPI.animateConfiguration(code);
          } else {
            // Skip animation by directly setting pieces
            const win = this.designerFrame.contentWindow;
            
            // Parse the configuration code and set pieces directly
            try {
              // First clear existing pieces
              win.DesignerAPI.setPlacedPieces([]);
              win.DesignerAPI.setPlacedContextFigures([]);
              
              // Load pieces instantly - modify the configuration slightly to ensure it renders correctly
              const codeWithoutAnim = code.startsWith('(') ? code : `(${code})`;
              win.DesignerEngine.animateConfiguration(
                codeWithoutAnim,
                pieces => win.DesignerAPI.setPlacedPieces(pieces),
                () => {}, // Skip new piece ID animation
                figures => win.DesignerAPI.setPlacedContextFigures(figures)
              );
              
              // Update zoom to fit the configuration
              setTimeout(() => win.DesignerAPI.updateZoom(), 100);
            } catch (e) {
              console.error("Failed to load without animation, falling back to animated", e);
              win.DesignerAPI.animateConfiguration(code);
            }
          }
        } else {
          // Fall back to postMessage
          this.designerFrame.contentWindow.postMessage({
            type: 'loadConfiguration',
            config: code,
            theme: this.options.defaultTheme,
            animate: animate
          }, '*');
        }
      } catch (err) {
        console.error('Error loading configuration:', err);
      }
    }
    
    setTheme(theme) {
      if (!theme || !this.designerFrame.contentWindow) return;
      
      try {
        if (this.designerFrame.contentWindow.DesignerAPI) {
          this.designerFrame.contentWindow.DesignerAPI.setSelectedTheme(theme);
        } else {
          this.designerFrame.contentWindow.postMessage({
            type: 'setTheme',
            theme: theme
          }, '*');
        }
      } catch (err) {
        console.error('Error setting theme:', err);
      }
    }
  
    // Helper function to get module info from the iframe
    getModuleInfo(moduleId) {
      if (!this.designerFrame.contentWindow || !this.designerFrame.contentWindow.DesignerEngine) {
        return null;
      }
      
      return this.designerFrame.contentWindow.DesignerEngine.moduleFilenames.find(m => m.id === moduleId);
    }
  
    // Calculate dimensions based on the configuration
    calculateDimensions(config, mode) {
      if (!this.designerFrame.contentWindow || !this.designerFrame.contentWindow.DesignerEngine) {
        return { width: 0, height: 0, depth: 0 };
      }
  
      const moduleFilenames = this.designerFrame.contentWindow.DesignerEngine.moduleFilenames;
      
      // Extract all module IDs from the configuration
      const moduleIds = [...config.matchAll(/\{([^}]+)\}/g)].map(match => match[1]);
      if (moduleIds.length === 0) return { width: 0, height: 0, depth: 0 };
  
      // Group modules by vertical stack (as in the layout)
      const stackPattern = /\(([^)]+)\)/g;
      const stacks = [...config.matchAll(stackPattern)].map(match => {
        const stackContent = match[1];
        return [...stackContent.matchAll(/\{([^}]+)\}/g)].map(m => m[1]);
      });
  
      let width = 0;
      let height = 0;
      let depth = 0;
  
      if (mode === 'standard' || mode === 'wide') {
        // For standard/wide mode: width = sum of NE dimensions, depth = single NW dimension
        const baseModules = stacks.map(stack => stack[0]); // Get first module from each stack
        
        // Calculate width (sum of all base modules' NE dimension)
        width = baseModules.reduce((sum, moduleId) => {
          const module = moduleFilenames.find(m => m.id === moduleId);
          return sum + (module ? module.dim_NE : 0);
        }, 0);
  
        // Get depth from first base module NW dimension
        const firstModule = moduleFilenames.find(m => m.id === baseModules[0]);
        depth = firstModule ? firstModule.dim_NW : 0;
  
        // Calculate height from first stack
        if (stacks.length > 0) {
          height = stacks[0].reduce((sum, moduleId) => {
            const module = moduleFilenames.find(m => m.id === moduleId);
            return sum + (module ? module.dim_height : 0);
          }, 0);
        }
      } else if (mode === 'corner') {
        // For corner mode: width = sum of NW dimensions (except the corner), depth = corner NE dimension
        if (stacks.length > 0) {
          const cornerModule = moduleFilenames.find(m => m.id === stacks[0][0]);
          depth = cornerModule ? cornerModule.dim_NE : 0;
          
          // Width is the NW of corner plus sum of NW dimensions of all other bases
          width = cornerModule ? cornerModule.dim_NW : 0;
          
          if (stacks.length > 1) {
            const otherBaseModules = stacks.slice(1).map(stack => stack[0]);
            width += otherBaseModules.reduce((sum, moduleId) => {
              const module = moduleFilenames.find(m => m.id === moduleId);
              return sum + (module ? module.dim_NW : 0);
            }, 0);
          }
  
          // Height is still the sum of heights in the first stack
          height = stacks[0].reduce((sum, moduleId) => {
            const module = moduleFilenames.find(m => m.id === moduleId);
            return sum + (module ? module.dim_height : 0);
          }, 0);
        }
      }
  
      // Store the dimensions
      this.dimensions = { width, height, depth };
      return this.dimensions;
    }
  
    // Get the current dimensions
    getDimensions() {
      return this.dimensions;
    }
  }
  
  window.SimplifiedDesigner = SimplifiedDesigner;