// Inline JSON data for products and services
const galleryData = {
    "images": [
      {
        "src": "images/products-services/cart1.jpg",
        "description": "Portable pavilion system, 'Bonga Baze', designed and fabricated for the Kounkuey Design Initiative."
      },
      {
        "src": "images/products-services/cart2.jpg",
        "description": "Bonga Baze can be expanded to serve as a fully functional community meeting space. When collapsed, it is fully portable."
      },
      {
        "src": "images/products-services/window1.jpg",
        "description": "Framework Designs developed an entirely new steel window system."
      },
      {
        "src": "images/products-services/window2.jpg",
        "description": "While we no longer offer our window products, they showcase the attention to detail at the core of our innovative approach."
      },
      {
        "src": "images/products-services/chair1.jpg",
        "description": "We have designed and fabricated a wide range of furniture on private commission. These services are only available for bulk orders."
      },
      {
        "src": "images/products-services/chair2.jpg",
        "description": "When it comes to developing custom products for clients, we work through countless prototypes before delivering a final product."
      },
      {
        "src": "images/products-services/expo1.jpg",
        "description": "A modular system we developed to showcase artworks in any location."
      },
      {
        "src": "images/products-services/expo2.jpg",
        "description": "Our expertise aslo spans fine art framing, where we have a track record of working with leading Nairobi artists."
      },
      {
        "src": "images/products-services/class1.jpg",
        "description": "Framework Designs foregrounds the joy of welding, and we've hosted many workshops to introduce beginners to the process."
      },
      {
        "src": "images/products-services/class2.jpg",
        "description": "We've developed tools and techniques to make welding easier and more enjoyable to learn for all kinds of students."
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