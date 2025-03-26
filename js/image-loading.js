document.addEventListener('DOMContentLoaded', function() {
    // Find all images that could benefit from lazy loading
    const images = document.querySelectorAll('img:not([loading])');
    
    // Add loading="lazy" attribute to images that are not in the immediate viewport
    images.forEach(img => {
        // Skip small images or icons
        if (img.height < 50 || img.width < 50) return;
        
        // Add lazy loading for non-critical images
        if (!isInViewport(img)) {
            img.setAttribute('loading', 'lazy');
        } else {
            // For visible images, add eager loading
            img.setAttribute('loading', 'eager');
        }
    });
    
    // Helper function to check if element is in viewport
    function isInViewport(element) {
        const rect = element.getBoundingClientRect();
        return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
            rect.right <= (window.innerWidth || document.documentElement.clientWidth)
        );
    }
});