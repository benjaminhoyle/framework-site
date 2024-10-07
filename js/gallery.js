// Inline JSON data
const galleryData = {
  "images": [
    {
      "src": "images/shelving/shelf (00).jpg",
      "alt": "Gallery Image 1",
      "description": "Available in green, black and blue"
    },
    {
      "src": "images/shelving/shelf (01).jpg",
      "alt": "Gallery Image 1",
      "description": "Base unit"
    },
    {
      "src": "images/shelving/shelf (03).jpg",
      "alt": "Gallery Image 3",
      "description": "Base unit + two short extensions"
    },
    {
      "src": "images/shelving/shelf (04).jpg",
      "alt": "Gallery Image 4",
      "description": "Base unit + three short extensions + one long extension"
    },
    {
      "src": "images/shelving/shelf (10).jpg",
      "alt": "Gallery Image 5",
      "description": "Adding on extra shelves is as easy as sliding them together. No tools necessary."
    },
    {
      "src": "images/shelving/shelf (11).jpg",
      "alt": "Gallery Image 6",
      "description": "Steel construction makes for a rock-solid shelving system"
    },
    {
      "src": "images/shelving/shelf (11b).jpg",
      "alt": "Gallery Image 7",
      "description": "Grow your shelves as you grow your library."
    },
    {
      "src": "images/shelving/shelf (12).jpg",
      "alt": "Gallery Image 7",
      "description": "All shelves come with adjustable feet to ensure stability on uneven floors."
    },
    {
      "src": "images/shelving/shelf (13).jpg",
      "alt": "Gallery Image 8",
      "description": "The top unit comes with removable caps, so you get a clean finish that doesn't limit you from adding extensions later on."
    },
    {
      "src": "images/shelving/shelf (14).jpg",
      "alt": "Gallery Image 9",
      "description": "Top-knotch fabrication and perfectly engineered details."
    },
    {
      "src": "images/shelving/shelf (16a).jpg",
      "alt": "Gallery Image 11",
      "description": "Base unit + one short extension, blue"
    },
    {
      "src": "images/shelving/shelf (16b).jpg",
      "alt": "Gallery Image 12",
      "description": "Base unit + one short extension, green"
    },
    {
      "src": "images/shelving/shelf (16c).jpg",
      "alt": "Gallery Image 13",
      "description": "Base unit + one short extension, black"
    },
    {
      "src": "images/shelving/shelf (17).jpg",
      "alt": "Gallery Image 14",
      "description": "Designed to fit in any corner of your home or office."  
    }
  ]
};
  
  const GalleryImage = ({ src, alt, title, description }) => {
      const [isActive, setIsActive] = React.useState(false);
  
      const toggleActive = () => {
          setIsActive(!isActive);
      };
  
      return React.createElement('div', { 
          className: `gallery-item ${isActive ? 'active' : ''}`,
          onClick: toggleActive
      },
          React.createElement('img', { src, alt }),
          React.createElement('div', { className: 'gallery-item-info' },
              React.createElement('h2', null, title),
              React.createElement('p', null, description)
          )
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