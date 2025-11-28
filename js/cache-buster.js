// Cache Buster - generates timestamp for cache-busting CSS and JS files
// This script should be loaded inline or first in all HTML pages

const CacheBuster = {
    // Get current timestamp for cache busting
    getTimestamp: function() {
        return Date.now();
    },

    // Get a daily timestamp (changes once per day) - less aggressive
    getDailyTimestamp: function() {
        const now = new Date();
        return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    },

    // Get version with hour precision
    getHourlyTimestamp: function() {
        const now = new Date();
        return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}`;
    },

    // Load a script dynamically with cache busting
    loadScript: function(src, callback) {
        const script = document.createElement('script');
        script.src = src + (src.includes('?') ? '&' : '?') + 'v=' + this.getTimestamp();
        script.onload = callback;
        document.head.appendChild(script);
    },

    // Load CSS dynamically with cache busting
    loadCSS: function(href) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href + (href.includes('?') ? '&' : '?') + 'v=' + this.getTimestamp();
        document.head.appendChild(link);
    },

    // Update all existing script and link tags with cache buster
    bustAllCaches: function() {
        const timestamp = this.getTimestamp();

        // Update all script tags
        document.querySelectorAll('script[src]').forEach(script => {
            const src = script.getAttribute('src');
            if (src && !src.includes('cdn') && !src.includes('http')) {
                // Only bust local scripts, not CDN ones
                const newSrc = src.replace(/(\?v=\d+)?$/, '?v=' + timestamp);
                script.setAttribute('src', newSrc);
            }
        });

        // Update all link tags (CSS)
        document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
            const href = link.getAttribute('href');
            if (href && !href.includes('cdn') && !href.includes('http')) {
                const newHref = href.replace(/(\?v=\d+)?$/, '?v=' + timestamp);
                link.setAttribute('href', newHref);
            }
        });
    }
};

// Export for use
if (typeof window !== 'undefined') {
    window.CacheBuster = CacheBuster;
    window.CACHE_VERSION = CacheBuster.getTimestamp();
}
