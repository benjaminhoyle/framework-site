// Inline JSON data
const galleryData = {
  "images": [
    {
      "src": "images/shelving/shelf (00).jpg",
      "alt": "Gallery Image 1",
      "description": "Our shelves are available in green, black and blue"
    },
    {
      "src": "images/shelving/shelf (01).jpg",
      "alt": "Gallery Image 1",
      "description": "The base unit comes with two tiers and is fully functional on its own."
    },
    {
      "src": "images/shelving/shelf (03).jpg",
      "alt": "Gallery Image 3",
      "description": "Base unit + two short extensions grows into a multi-functional shelving system."
    },
    {
      "src": "images/shelving/shelf (04).jpg",
      "alt": "Gallery Image 4",
      "description": "Base unit + three short extensions + one long extension shows how much room there is to grow."
    },
    {
      "src": "images/shelving/shelf (10).jpg",
      "alt": "Gallery Image 5",
      "description": "Adding on extra shelves is as easy as sliding them together. No tools necessary."
    },
    {
      "src": "images/shelving/shelf (11).jpg",
      "alt": "Gallery Image 6",
      "description": "Steel construction makes for a rock-solid structure"
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
      "description": "Base unit + one short extension shown in blue"
    },
    {
      "src": "images/shelving/shelf (16b).jpg",
      "alt": "Gallery Image 12",
      "description": "Base unit + one short extension shown in green"
    },
    {
      "src": "images/shelving/shelf (16c).jpg",
      "alt": "Gallery Image 13",
      "description": "Base unit + one short extension shown in black"
    },
    {
      "src": "images/shelving/shelf (17).jpg",
      "alt": "Gallery Image 14",
      "description": "Designed to fit in any corner of your home or office."
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