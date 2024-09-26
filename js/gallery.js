// Inline JSON data
const galleryData = {
    "images": [
      {
        "src": "images/gallery/bend-chair.jpg",
        "alt": "Gallery Image 1",
        "title": "New Image 1",
        "description": "Description for new image 1. Please update this text."
      },
      {
        "src": "images/gallery/color.png",
        "alt": "Gallery Image 2",
        "title": "New Image 2",
        "description": "Description for new image 2. Please update this text."
      },
      {
        "src": "images/gallery/shop.jpg",
        "alt": "Gallery Image 3",
        "title": "New Image 3",
        "description": "Description for new image 3. Please update this text."
      },
      {
        "src": "images/gallery/stand.jpg",
        "alt": "Gallery Image 4",
        "title": "New Image 4",
        "description": "Description for new image 4. Please update this text."
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