document.addEventListener('DOMContentLoaded', function() {
    // Only add FAQ schema if we're on the shelving page
    if (window.location.pathname.includes('shelving.html')) {
        const faqSchema = {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": [
                {
                    "@type": "Question",
                    "name": "What makes Framework's shelving unique in Nairobi?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "Our shelving systems are designed and manufactured in Kenya using premium steel and expert craftsmanship. Unlike imported furniture, our modular shelving is specifically designed for Nairobi homes and businesses, with adjustable features that make it adaptable to any space."
                    }
                },
                {
                    "@type": "Question",
                    "name": "How customizable are your shelving solutions?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "Our modular shelving systems are infinitely customizable. You can choose colors, dimensions, and configurations to match your exact needs. Our online designer tool lets you visualize your custom shelving before ordering, ensuring a perfect fit for your Nairobi home or office."
                    }
                },
                {
                    "@type": "Question",
                    "name": "Do you deliver and install in Nairobi?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "Yes, we offer delivery throughout Nairobi and surrounding areas. Installation services are also available for an additional fee. Our team ensures your shelving is properly set up and stable, with adjustable feet that adapt to uneven floors commonly found in Nairobi buildings."
                    }
                },
                {
                    "@type": "Question",
                    "name": "What is the price range for Framework shelving?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "Our shelving starts at KSh 6,500 for a standard base unit, with extension units available from KSh 5,500. Custom configurations vary in price based on size and features. Being Kenyan-made, our shelving offers exceptional value compared to imported options of similar quality."
                    }
                }
            ]
        };
    
        // Add the structured data to the page
        const script = document.createElement('script');
        script.type = 'application/ld+json';
        script.text = JSON.stringify(faqSchema);
        document.head.appendChild(script);
    }
});