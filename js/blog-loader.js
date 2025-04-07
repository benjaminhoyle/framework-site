// Save this as js/blog-loader.js
document.addEventListener('DOMContentLoaded', function() {
    const blogGrid = document.querySelector('.blog-grid');
    if (!blogGrid) return;

    // Clear any existing content
    blogGrid.innerHTML = '';
    
    // Show loading indicator
    const loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'loading-indicator';
    loadingIndicator.innerText = 'Loading articles...';
    blogGrid.appendChild(loadingIndicator);

    // Fetch the list of blog posts from a JSON file, a directory listing, or a known pattern
    // For this example, we'll use a simple technique - tracking a list of known blog post filenames
    // In a more advanced setup, you could generate this list dynamically on the server
    
    const blogFiles = [
        // Your initial blog posts - add new ones as you create them
        'modularity-for-kenya.html'
    ];
    
    // Base path for blog posts
    const basePath = 'blog/';
    
    // Array to store post data
    const blogPosts = [];
    
    // Counter to track loaded posts
    let loadedPosts = 0;
    
    // Function to fetch and parse each blog post
    blogFiles.forEach(filename => {
        const url = basePath + filename;
        
        fetch(url)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }
                return response.text();
            })
            .then(html => {
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');
                
                // Extract metadata from the blog post HTML
                const post = {
                    title: doc.querySelector('.blog-post-title')?.textContent || 
                           doc.querySelector('title')?.textContent.split('|')[0].trim() || 
                           'Untitled Post',
                    
                    date: doc.querySelector('.blog-post-date')?.textContent || 'No date',
                    
                    dateISO: doc.querySelector('.blog-post-date')?.getAttribute('datetime') || 
                             new Date().toISOString().split('T')[0],
                    
                    excerpt: doc.querySelector('meta[name="description"]')?.getAttribute('content') || 
                             doc.querySelector('.blog-post-content p')?.textContent.slice(0, 150) + '...' || 
                             'No excerpt available',
                    
                    image: doc.querySelector('.blog-post-featured-image')?.getAttribute('src') || 
                           '',
                    
                    url: url,
                    
                    // You can use a meta tag or data attribute to mark featured posts
                    featured: doc.querySelector('meta[property="og:featured"]')?.getAttribute('content') === 'true' || 
                              filename === 'sustainable-steel-furniture.html', // Default featured post
                    
                    tags: Array.from(doc.querySelectorAll('.blog-post-tag')).map(tag => 
                        tag.textContent.toLowerCase())
                };
                
                // Fix image path if needed
                if (post.image && post.image.startsWith('../')) {
                    post.image = post.image.replace('../', '');
                }
                
                blogPosts.push(post);
                loadedPosts++;
                
                // When all posts are loaded, render them
                if (loadedPosts === blogFiles.length) {
                    renderBlogPosts(blogPosts);
                }
            })
            .catch(error => {
                console.error(`Error loading ${url}:`, error);
                loadedPosts++;
                
                // Try to render what we have if all fetches are completed
                if (loadedPosts === blogFiles.length) {
                    renderBlogPosts(blogPosts);
                }
            });
    });

    function renderBlogPosts(posts) {
        // Remove loading indicator
        const loadingIndicator = document.querySelector('.loading-indicator');
        if (loadingIndicator) {
            loadingIndicator.remove();
        }

        // If no posts were loaded successfully, show a message
        if (posts.length === 0) {
            blogGrid.innerHTML = '<div class="no-posts">No blog posts found.</div>';
            return;
        }

        // Sort posts by date (newest first)
        posts.sort((a, b) => new Date(b.dateISO) - new Date(a.dateISO));

        // First, find the featured post (if any)
        const featuredPost = posts.find(post => post.featured);
        
        // Add featured post first if it exists
        if (featuredPost) {
            blogGrid.innerHTML += createBlogPostHTML(featuredPost, true);
        }

        // Add the rest of the posts
        posts
            .filter(post => !post.featured)
            .forEach(post => {
                blogGrid.innerHTML += createBlogPostHTML(post, false);
            });

        // Handle tag filtering
        const urlParams = new URLSearchParams(window.location.search);
        const tagFilter = urlParams.get('tag');
        
        if (tagFilter) {
            let visibleCount = 0;
            
            document.querySelectorAll('.blog-card').forEach(card => {
                const cardTags = card.dataset.tags || '';
                if (!cardTags.includes(tagFilter.toLowerCase())) {
                    card.style.display = 'none';
                } else {
                    visibleCount++;
                }
            });
            
            // Update header to show we're filtering
            const headerTitle = document.querySelector('.blog-header h1');
            if (headerTitle) {
                headerTitle.innerHTML = `Posts Tagged: ${tagFilter.charAt(0).toUpperCase() + tagFilter.slice(1)}`;
            }
            
            // If no posts match the tag, show a message
            if (visibleCount === 0) {
                const noTagMatch = document.createElement('div');
                noTagMatch.className = 'no-posts';
                noTagMatch.innerText = `No posts found with tag "${tagFilter}"`;
                blogGrid.appendChild(noTagMatch);
            }
        }
    }

    function createBlogPostHTML(post, isFeatured) {
        const featuredClass = isFeatured ? 'featured-post' : '';
        const tagsData = (post.tags || []).join(' ').toLowerCase();
        
        return `
            <article class="blog-card ${featuredClass}" data-tags="${tagsData}">
                <img src="${post.image}" alt="${post.title}" class="blog-card-image">
                <div class="blog-card-content">
                    <div class="blog-card-date">${post.date}</div>
                    <h2 class="blog-card-title">${post.title}</h2>
                    <p class="blog-card-excerpt">${post.excerpt}</p>
                    <a href="${post.url}" class="blog-card-link">Read More</a>
                </div>
            </article>
        `;
    }
});