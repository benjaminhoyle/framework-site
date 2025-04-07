document.addEventListener('DOMContentLoaded', function () {
    loadHeaderAndFooter();
    setupMobileMenu();
    highlightActivePage();
});

function loadHeaderAndFooter() {
    // Add favicon dynamically
    if (!document.querySelector('link[rel="icon"]')) {
        const favicon = document.createElement('link');
        favicon.rel = 'icon';
        favicon.href = 'images/global/fwk-icon-lg.png';
        document.head.appendChild(favicon);
    }
    const headerContent = `
        <div class="logo">
            <a href="index.html">
                <img src="/images/global/fwk-icon.png" alt="Framework Designs Logo">
            </a>
        </div>
        <nav>
            <ul id="nav-menu">
                <li><a href="index.html">Home</a></li>
                <li><a href="shelving.html">Shelving</a></li>
                <li><a href="products-services.html">Products and Services</a></li>
                <li><a href="https://wa.me/254783891005">Contact</a></li>
            </ul>
        </nav>
        <button id="mobile-menu-toggle" aria-label="Toggle mobile menu">
            <span></span>
            <span></span>
            <span></span>
        </button>
    `;

    const footerContent = `
    <div class="footer-content">
        <div class="footer-info">
            <p>© ${new Date().getFullYear()} Framework Designs Limited</p>
            <p>Email: <a href="mailto:info@framework.co.ke" class="text-link">info@framework.co.ke</a></p>
            <p>WhatsApp: <a href="https://wa.me/254783891005" class="text-link">+254 783 891 005</a></p>
            <p>Instagram: <a href="https://www.instagram.com/framework_nairobi/" class="text-link">framework_nairobi</a></p>

        </div>
        <div class="footer-keywords">
            <p class="footer-tags">Custom Steel Shelving | Modular Furniture Kenya | Space-Saving Solutions | Kenyan-Made Furniture</p>
        </div>
    </div>
`;

    const header = document.createElement('header');
    header.innerHTML = headerContent;
    document.body.prepend(header);

    const footer = document.createElement('footer');
    footer.innerHTML = footerContent;
    document.body.append(footer);
}

function setupMobileMenu() {
    const toggle = document.getElementById('mobile-menu-toggle');
    const menu = document.getElementById('nav-menu');
    const header = document.querySelector('header');

    function toggleMobileMenu() {
        menu.classList.toggle('show');
        header.classList.toggle('mobile-menu-open');
    }

    toggle.addEventListener('click', toggleMobileMenu);

    // Close menu when clicking outside
    document.addEventListener('click', function (event) {
        const isClickInsideMenu = menu.contains(event.target);
        const isClickOnToggle = toggle.contains(event.target);
        if (!isClickInsideMenu && !isClickOnToggle && menu.classList.contains('show')) {
            toggleMobileMenu();
        }
    });

    function checkMobileView() {
        if (window.innerWidth <= 768) {
            header.classList.add('mobile-view');
        } else {
            header.classList.remove('mobile-view');
            menu.classList.remove('show');
        }
    }

    window.addEventListener('resize', checkMobileView);
    checkMobileView(); // Initial check
}

function highlightActivePage() {
    const currentPage = window.location.pathname.split("/").pop() || 'index.html';
    const navLinks = document.querySelectorAll('#nav-menu a');

    navLinks.forEach(link => {
        if (link.getAttribute('href') === currentPage) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
}