document.addEventListener('DOMContentLoaded', function() {
    const structuredData = {
        "@context": "https://schema.org",
        "@type": "LocalBusiness",
        "name": "Framework Designs",
        "image": "https://www.framework.co.ke/images/global/fwk-icon.png",
        "description": "Premium steel shelving systems and modular furniture solutions in Nairobi, Kenya. Custom-designed, space-saving shelving for homes, offices, and retail spaces.",
        "url": "https://www.framework.co.ke",
        "telephone": "+254783891005",
        "email": "info@framework.co.ke",
        "address": {
            "@type": "PostalAddress",
            "addressLocality": "Nairobi",
            "addressRegion": "Nairobi",
            "addressCountry": "KE"
        },
        "geo": {
            "@type": "GeoCoordinates",
            "latitude": "-1.2921",
            "longitude": "36.8219"
        },
        "openingHoursSpecification": {
            "@type": "OpeningHoursSpecification",
            "dayOfWeek": [
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday"
            ],
            "opens": "09:00",
            "closes": "17:00"
        },
        "sameAs": [
            "https://www.instagram.com/frameworkdesignskenya",
            "https://www.facebook.com/frameworkdesignskenya"
        ],
        "priceRange": "$$",
        "makesOffer": [
            {
                "@type": "Offer",
                "itemOffered": {
                    "@type": "Product",
                    "name": "Modular Steel Shelving System",
                    "description": "Customizable steel shelving units that can be expanded and reconfigured as needed."
                }
            },
            {
                "@type": "Offer",
                "itemOffered": {
                    "@type": "Service",
                    "name": "Custom Steel Fabrication",
                    "description": "Bespoke steel furniture design and fabrication services."
                }
            }
        ]
    };

    // Add the structured data to the page
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.text = JSON.stringify(structuredData);
    document.head.appendChild(script);
});