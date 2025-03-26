// Inline JSON data
const galleryData = {
  "images": [
    {
      "src": "images/shelving/shelf (00).jpg",
      "alt": "Colorful modular steel shelving system in Nairobi with blue and green finishes",
      "description": "Our shelves are available in green, black and blue"
    },
    {
      "src": "images/shelving/shelf (01).jpg",
      "alt": "Kenyan-made steel shelving base unit with two functional tiers",
      "description": "The base unit comes with two tiers and is fully functional on its own."
    },
    {
      "src": "images/shelving/shelf (03).jpg",
      "alt": "Space-saving modular shelving solution for Nairobi homes with multiple extensions",
      "description": "Base unit + two short extensions grows into a multi-functional shelving system."
    },
    {
      "src": "images/shelving/shelf (04).jpg",
      "alt": "Expandable steel shelving system with multiple extensions for Nairobi apartments",
      "description": "Base unit + three short extensions + one long extension shows how much room there is to grow."
    },
    {
      "src": "images/shelving/shelf (10).jpg",
      "alt": "Tool-free assembly of custom shelving solutions in Kenya with sliding mechanism",
      "description": "Adding on extra shelves is as easy as sliding them together. No tools necessary."
    },
    {
      "src": "images/shelving/shelf (11).jpg",
      "alt": "Durable steel shelving construction made in Nairobi for lasting stability",
      "description": "Steel construction makes for a rock-solid structure"
    },
    {
      "src": "images/shelving/shelf (11b).jpg",
      "alt": "Expandable Kenyan-made bookshelf system perfect for growing collections",
      "description": "Grow your shelves as you grow your library."
    },
    {
      "src": "images/shelving/shelf (12).jpg",
      "alt": "Adjustable steel shelving with leveling feet for uneven Nairobi floors",
      "description": "All shelves come with adjustable feet to ensure stability on uneven floors."
    },
    {
      "src": "images/shelving/shelf (13).jpg",
      "alt": "Modular furniture with removable caps for future expansion in Kenyan homes",
      "description": "The top unit comes with removable caps, so you get a clean finish that doesn't limit you from adding extensions later on."
    },
    {
      "src": "images/shelving/shelf (14).jpg",
      "alt": "Premium steel shelving craftsmanship with detailed engineering made in Kenya",
      "description": "Top-notch fabrication and perfectly engineered details."
    },
    {
      "src": "images/shelving/shelf (16a).jpg",
      "alt": "Colorful blue steel shelving unit for Nairobi homes and offices",
      "description": "Base unit + one short extension shown in blue"
    },
    {
      "src": "images/shelving/shelf (16b).jpg",
      "alt": "Vibrant green modular shelving solution made in Kenya for modern spaces",
      "description": "Base unit + one short extension shown in green"
    },
    {
      "src": "images/shelving/shelf (16c).jpg",
      "alt": "Sleek black steel shelving system for contemporary Nairobi interiors",
      "description": "Base unit + one short extension shown in black"
    },
    {
      "src": "images/shelving/shelf (17).jpg",
      "alt": "Versatile corner shelving solution for maximizing space in Kenyan homes",
      "description": "Designed to fit in any corner of your home or office."
    },
    {
      "src": "images/shelving/shelf (18).jpg",
      "alt": "Custom height steel shelving configurations for dynamic Nairobi interiors",
      "description": "Arrange shelves of different heights for a dynamic effect."
    },
    {
      "src": "images/shelving/shelf (20).jpg",
      "alt": "Expandable shelving system for large collections in Kenyan homes and businesses",
      "description": "The system can expand to hold your entire collection."
    }
  ]
};

const GalleryImage = ({ src, alt, description }) => {
    return React.createElement('div', { className: 'gallery-item' },
        React.createElement('img', { src, alt }),
        React.createElement('div', { className: 'gallery-item-caption' }, description)
    );
};

const Gallery = () => {
    return React.createElement('div', { className: 'gallery-grid' },
        galleryData.images.map((image, index) => 
            React.createElement(GalleryImage, { key: index, ...image })
        )
    );
};

ReactDOM.render(React.createElement(Gallery), document.getElementById('gallery'));