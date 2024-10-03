// Inline JSON data
const galleryData = {
  "images": [
    {
      "src": "images/shelving/shelf (01).jpg",
      "alt": "Gallery Image 1",
      "description": "Base unit"
    },
    {
      "src": "images/shelving/shelf (02).jpg",
      "alt": "Gallery Image 2",
      "description": "Base unit + short extension"
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