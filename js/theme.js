/**
 * HYPERDROID THEME SYSTEM
 * =======================
 * Dynamic theme configuration for white-label customization.
 *
 * HOW TO USE:
 * -----------
 * 1. Set your brand colors in the BRAND_CONFIG object below
 * 2. Call Theme.apply() on page load
 * 3. All UI elements will update to match your brand
 *
 * CUSTOMIZATION:
 * --------------
 * Only modify the BRAND_CONFIG object. The system will automatically
 * generate all derived colors (hover states, backgrounds, etc.)
 */

// ============================================================================
// BRAND CONFIGURATION - MODIFY THESE VALUES FOR YOUR BRAND
// ============================================================================
const BRAND_CONFIG = {
    // Primary brand color - your main brand color
    // This affects buttons, links, highlights, and accent elements
    primary: '#3b82f6',         // Blue (default)

    // Secondary brand color - complementary accent color
    secondary: '#8b5cf6',       // Purple

    // Accent color - for special highlights
    accent: '#6366f1',          // Indigo

    // Brand name for display
    brandName: 'HyperDroid',

    // Optional: Override specific colors (leave null for auto-generation)
    overrides: {
        // Uncomment and modify to override specific colors:
        // primaryLight: '#60a5fa',
        // primaryDark: '#2563eb',
        // success: '#10b981',
        // danger: '#ef4444',
        // warning: '#f59e0b',
        // info: '#3b82f6',

        // Background colors (light mode defaults shown)
        // bgBody: '#f5f7fa',        // Main app background
        // bgCard: '#ffffff',        // Card/panel backgrounds
        // bgNavbar: '#ffffff',      // Navbar background
        // bgSidebar: '#ffffff',     // Sidebar background
        // bgInput: '#ffffff',       // Input field backgrounds
    }
};

// ============================================================================
// THEME ENGINE - DO NOT MODIFY BELOW THIS LINE
// ============================================================================

const Theme = {
    // Color manipulation utilities
    utils: {
        /**
         * Validate hex color format
         * Accepts #RGB or #RRGGBB formats
         * @param {string} color - Color to validate
         * @returns {boolean} True if valid hex color
         */
        isValidHex(color) {
            if (typeof color !== 'string') return false;
            return /^#([0-9A-F]{3}){1,2}$/i.test(color);
        },

        /**
         * Normalize hex color to 6-digit format
         * Converts #RGB to #RRGGBB
         * @param {string} hex - Hex color (3 or 6 digits)
         * @returns {string|null} 6-digit hex or null if invalid
         */
        normalizeHex(hex) {
            if (!this.isValidHex(hex)) return null;
            hex = hex.replace('#', '');
            if (hex.length === 3) {
                hex = hex.split('').map(c => c + c).join('');
            }
            return '#' + hex.toLowerCase();
        },

        /**
         * Convert hex color to RGB object
         * Handles both 3-digit (#RGB) and 6-digit (#RRGGBB) formats
         */
        hexToRgb(hex) {
            // Normalize to 6-digit format first
            const normalized = this.normalizeHex(hex);
            if (!normalized) return null;

            const result = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(normalized);
            return result ? {
                r: parseInt(result[1], 16),
                g: parseInt(result[2], 16),
                b: parseInt(result[3], 16)
            } : null;
        },

        /**
         * Convert RGB to hex
         */
        rgbToHex(r, g, b) {
            return '#' + [r, g, b].map(x => {
                const hex = Math.max(0, Math.min(255, Math.round(x))).toString(16);
                return hex.length === 1 ? '0' + hex : hex;
            }).join('');
        },

        /**
         * Convert hex to HSL
         */
        hexToHsl(hex) {
            const rgb = this.hexToRgb(hex);
            if (!rgb) return null;

            const r = rgb.r / 255;
            const g = rgb.g / 255;
            const b = rgb.b / 255;

            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            let h, s, l = (max + min) / 2;

            if (max === min) {
                h = s = 0;
            } else {
                const d = max - min;
                s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                switch (max) {
                    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
                    case g: h = ((b - r) / d + 2) / 6; break;
                    case b: h = ((r - g) / d + 4) / 6; break;
                }
            }

            return { h: h * 360, s: s * 100, l: l * 100 };
        },

        /**
         * Convert HSL to hex
         */
        hslToHex(h, s, l) {
            s /= 100;
            l /= 100;
            const a = s * Math.min(l, 1 - l);
            const f = n => {
                const k = (n + h / 30) % 12;
                const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
                return Math.round(255 * color).toString(16).padStart(2, '0');
            };
            return `#${f(0)}${f(8)}${f(4)}`;
        },

        /**
         * Lighten a color by percentage
         */
        lighten(hex, percent) {
            const hsl = this.hexToHsl(hex);
            if (!hsl) return hex;
            hsl.l = Math.min(100, hsl.l + percent);
            return this.hslToHex(hsl.h, hsl.s, hsl.l);
        },

        /**
         * Darken a color by percentage
         */
        darken(hex, percent) {
            const hsl = this.hexToHsl(hex);
            if (!hsl) return hex;
            hsl.l = Math.max(0, hsl.l - percent);
            return this.hslToHex(hsl.h, hsl.s, hsl.l);
        },

        /**
         * Adjust saturation
         */
        saturate(hex, percent) {
            const hsl = this.hexToHsl(hex);
            if (!hsl) return hex;
            hsl.s = Math.min(100, hsl.s + percent);
            return this.hslToHex(hsl.h, hsl.s, hsl.l);
        },

        /**
         * Get contrasting text color (black or white)
         */
        getContrastColor(hex) {
            const rgb = this.hexToRgb(hex);
            if (!rgb) return '#ffffff';
            // Calculate relative luminance
            const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
            return luminance > 0.5 ? '#000000' : '#ffffff';
        },

        /**
         * Create rgba string from hex and alpha
         */
        rgba(hex, alpha) {
            const rgb = this.hexToRgb(hex);
            if (!rgb) return `rgba(0, 0, 0, ${alpha})`;
            return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
        }
    },

    /**
     * Validate brand configuration
     * @param {Object} config - Brand configuration to validate
     * @returns {Object} Validation result with isValid boolean and errors array
     */
    validateConfig(config) {
        const errors = [];
        const utils = this.utils;

        if (!config || typeof config !== 'object') {
            return { isValid: false, errors: ['Config must be an object'] };
        }

        // Required colors
        const requiredColors = ['primary', 'secondary', 'accent'];
        requiredColors.forEach(colorKey => {
            if (!config[colorKey]) {
                errors.push(`Missing required color: ${colorKey}`);
            } else if (!utils.isValidHex(config[colorKey])) {
                errors.push(`Invalid hex color for ${colorKey}: ${config[colorKey]}`);
            }
        });

        // Optional overrides
        if (config.overrides && typeof config.overrides === 'object') {
            const colorOverrides = ['primaryLight', 'primaryDark', 'secondaryLight', 'secondaryDark', 'success', 'danger', 'warning', 'info'];
            colorOverrides.forEach(colorKey => {
                if (config.overrides[colorKey] && !utils.isValidHex(config.overrides[colorKey])) {
                    errors.push(`Invalid hex color for override ${colorKey}: ${config.overrides[colorKey]}`);
                }
            });
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    },

    /**
     * Generate complete theme from brand config
     */
    generateTheme(config) {
        const utils = this.utils;

        // Validate and use fallbacks for invalid colors
        const defaultPrimary = '#3b82f6';
        const defaultSecondary = '#8b5cf6';
        const defaultAccent = '#6366f1';

        const primary = utils.isValidHex(config?.primary) ? config.primary : defaultPrimary;
        const secondary = utils.isValidHex(config?.secondary) ? config.secondary : defaultSecondary;
        const accent = utils.isValidHex(config?.accent) ? config.accent : defaultAccent;
        const overrides = config?.overrides || {};

        // Generate primary variants
        const primaryLight = overrides.primaryLight || utils.lighten(primary, 10);
        const primaryDark = overrides.primaryDark || utils.darken(primary, 10);

        // Generate secondary variants
        const secondaryLight = overrides.secondaryLight || utils.lighten(secondary, 10);
        const secondaryDark = overrides.secondaryDark || utils.darken(secondary, 10);

        // Semantic colors (can be overridden)
        const success = overrides.success || '#10b981';
        const danger = overrides.danger || '#ef4444';
        const warning = overrides.warning || '#f59e0b';
        const info = overrides.info || primary;

        // Background colors (only include if explicitly set - otherwise CSS defaults apply)
        const bgBody = utils.isValidHex(overrides.bgBody) ? overrides.bgBody : null;
        const bgCard = utils.isValidHex(overrides.bgCard) ? overrides.bgCard : null;
        const bgNavbar = utils.isValidHex(overrides.bgNavbar) ? overrides.bgNavbar : null;
        const bgSidebar = utils.isValidHex(overrides.bgSidebar) ? overrides.bgSidebar : null;
        const bgInput = utils.isValidHex(overrides.bgInput) ? overrides.bgInput : null;

        // Build theme object
        const theme = {
            // Brand colors
            '--brand-primary': primary,
            '--brand-primary-light': primaryLight,
            '--brand-primary-dark': primaryDark,
            '--brand-secondary': secondary,
            '--brand-accent': accent,

            // Semantic colors
            '--color-success': success,
            '--color-success-light': utils.lighten(success, 35),
            '--color-success-dark': utils.darken(success, 10),
            '--color-success-text': utils.darken(success, 25),

            '--color-danger': danger,
            '--color-danger-light': utils.lighten(danger, 35),
            '--color-danger-dark': utils.darken(danger, 10),
            '--color-danger-text': utils.darken(danger, 25),

            '--color-warning': warning,
            '--color-warning-light': utils.lighten(warning, 35),
            '--color-warning-dark': utils.darken(warning, 10),
            '--color-warning-text': utils.darken(warning, 25),

            '--color-info': info,
            '--color-info-light': utils.lighten(info, 35),
            '--color-info-dark': utils.darken(info, 10),
            '--color-info-text': utils.darken(info, 25),

            // Text colors
            '--text-link': primary,
            '--text-link-hover': primaryDark,

            // Button gradients
            '--gradient-primary': `linear-gradient(135deg, ${primary} 0%, ${primaryDark} 100%)`,
            '--gradient-primary-hover': `linear-gradient(135deg, ${primaryLight} 0%, ${primary} 100%)`,
            '--gradient-secondary': `linear-gradient(135deg, ${secondary} 0%, ${secondaryDark} 100%)`,
            '--gradient-success': `linear-gradient(135deg, ${success} 0%, ${utils.darken(success, 10)} 100%)`,
            '--gradient-danger': `linear-gradient(135deg, ${danger} 0%, ${utils.darken(danger, 10)} 100%)`,
            '--gradient-warning': `linear-gradient(135deg, ${warning} 0%, ${utils.darken(warning, 10)} 100%)`,
            '--gradient-info': `linear-gradient(135deg, ${info} 0%, ${utils.darken(info, 10)} 100%)`,

            // Background gradients
            '--gradient-header': `linear-gradient(135deg, ${primary} 0%, ${primaryDark} 100%)`,
            '--gradient-card-highlight': `linear-gradient(135deg, ${primary} 0%, ${secondary} 100%)`,

            // Focus and interaction states
            '--focus-ring': `0 0 0 3px ${utils.rgba(primary, 0.3)}`,
            '--focus-ring-offset': `0 0 0 2px var(--bg-card), 0 0 0 4px ${primary}`,
            '--selected-bg': utils.rgba(primary, 0.1),
            '--selected-border': primary,

            // Toggle/Switch
            '--toggle-bg-checked': primary,

            // Icon colors
            '--icon-file': secondary,

            // Button text colors (accessibility - auto-contrast)
            '--btn-primary-text': utils.getContrastColor(primary),
            '--btn-secondary-text': utils.getContrastColor(secondary),
            '--btn-success-text': utils.getContrastColor(success),
            '--btn-danger-text': utils.getContrastColor(danger),
            '--btn-warning-text': utils.getContrastColor(warning),
            '--btn-info-text': utils.getContrastColor(info),
            '--btn-accent-text': utils.getContrastColor(accent),

            // Header/gradient text (for colored backgrounds)
            '--header-text': utils.getContrastColor(primary),
        };

        // Add background colors only if explicitly set (preserves CSS defaults otherwise)
        if (bgBody) {
            theme['--bg-body'] = bgBody;
            // Auto-generate the page gradient from the background color
            const bgBodyDark = utils.darken(bgBody, 5);
            theme['--gradient-page-bg'] = `linear-gradient(135deg, ${bgBody} 0%, ${bgBodyDark} 100%)`;
            theme['--bg-card-hover'] = utils.darken(bgBody, 3);

            // Auto-detect if background is dark and set appropriate text colors
            const bgRgb = utils.hexToRgb(bgBody);
            if (bgRgb) {
                const luminance = (0.299 * bgRgb.r + 0.587 * bgRgb.g + 0.114 * bgRgb.b) / 255;
                if (luminance < 0.5) {
                    // Dark background - use light text
                    theme['--text-primary'] = '#f1f5f9';
                    theme['--text-secondary'] = '#94a3b8';
                    theme['--text-muted'] = '#64748b';
                    theme['--text-placeholder'] = '#64748b';
                    theme['--border-color'] = '#334155';
                    theme['--border-color-light'] = '#1e293b';
                }
            }
        }
        if (bgCard) {
            theme['--bg-card'] = bgCard;
            theme['--bg-card-hover'] = utils.darken(bgCard, 5);

            // Auto-detect if card background is dark and set card text colors
            const cardRgb = utils.hexToRgb(bgCard);
            if (cardRgb) {
                const cardLuminance = (0.299 * cardRgb.r + 0.587 * cardRgb.g + 0.114 * cardRgb.b) / 255;
                if (cardLuminance < 0.5) {
                    // Dark card - ensure text is readable
                    theme['--text-primary'] = '#f1f5f9';
                    theme['--text-secondary'] = '#94a3b8';
                    theme['--text-muted'] = '#64748b';
                }
            }
        }
        if (bgNavbar) theme['--bg-navbar'] = bgNavbar;
        if (bgSidebar) theme['--bg-sidebar'] = bgSidebar;
        if (bgInput) theme['--bg-input'] = bgInput;

        return theme;
    },

    /**
     * Apply theme to document
     * @param {Object} config - Brand configuration
     * @param {string} mode - 'light' or 'dark'
     * @returns {boolean} True if applied successfully
     */
    apply(config = BRAND_CONFIG, mode = null) {
        // Validate config and warn about any issues
        const validation = this.validateConfig(config);
        if (!validation.isValid) {
            console.warn('[Theme] Config validation warnings:', validation.errors);
            console.warn('[Theme] Using fallback colors for invalid values');
        }

        const theme = this.generateTheme(config);
        const root = document.documentElement;

        // Determine mode: use provided, stored, system preference, or default to light
        const resolvedMode = mode || this.currentMode || this.getSystemPreference();

        // Set data-theme attribute for CSS dark mode styles
        root.setAttribute('data-theme', resolvedMode);

        // Apply all CSS custom properties
        Object.entries(theme).forEach(([property, value]) => {
            root.style.setProperty(property, value);
        });

        // Store current config and mode for reference
        this.currentConfig = config;
        this.currentMode = resolvedMode;

        // Dispatch event for components that need to react to theme changes
        window.dispatchEvent(new CustomEvent('themechange', {
            detail: { ...config, mode: resolvedMode }
        }));

        console.log('[Theme] Applied brand theme:', config.brandName || 'Custom', `(${resolvedMode} mode)`);
        return true;
    },

    /**
     * Get system color scheme preference
     */
    getSystemPreference() {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'dark';
        }
        return 'light';
    },

    /**
     * Toggle between light and dark mode
     */
    toggleDarkMode() {
        const newMode = this.currentMode === 'dark' ? 'light' : 'dark';
        this.setMode(newMode);
        return newMode;
    },

    /**
     * Set specific mode (light/dark)
     */
    setMode(mode) {
        if (mode !== 'light' && mode !== 'dark') {
            console.warn('[Theme] Invalid mode. Use "light" or "dark"');
            return;
        }
        this.apply(this.getConfig(), mode);

        // Persist preference
        try {
            localStorage.setItem('theme-mode', mode);
        } catch (e) {
            // localStorage not available
        }
    },

    /**
     * Get current mode
     */
    getMode() {
        return this.currentMode || 'light';
    },

    /**
     * Check if dark mode is active
     */
    isDarkMode() {
        return this.currentMode === 'dark';
    },

    /**
     * Load saved mode preference
     */
    loadSavedMode() {
        try {
            return localStorage.getItem('theme-mode');
        } catch (e) {
            return null;
        }
    },

    /**
     * Get current theme configuration
     */
    getConfig() {
        return this.currentConfig || BRAND_CONFIG;
    },

    /**
     * Update a specific brand color
     * @param {string} colorKey - Color key to update (primary, secondary, accent)
     * @param {string} value - New hex color value
     * @returns {boolean} True if color was applied, false if invalid
     */
    updateColor(colorKey, value) {
        if (!this.utils.isValidHex(value)) {
            console.warn(`[Theme] Invalid hex color: ${value}`);
            return false;
        }

        const validKeys = ['primary', 'secondary', 'accent'];
        if (!validKeys.includes(colorKey)) {
            console.warn(`[Theme] Invalid color key: ${colorKey}. Valid keys: ${validKeys.join(', ')}`);
            return false;
        }

        const newConfig = { ...this.getConfig() };
        newConfig[colorKey] = value;
        this.apply(newConfig);
        return true;
    },

    /**
     * Set app background color
     * @param {string} color - Hex color for main background
     * @param {Object} options - Additional background options
     * @param {string} options.card - Card background color
     * @param {string} options.navbar - Navbar background color
     * @param {string} options.sidebar - Sidebar background color
     * @param {string} options.input - Input field background color
     * @returns {boolean} True if applied, false if invalid
     */
    setBackground(color, options = {}) {
        if (!this.utils.isValidHex(color)) {
            console.warn(`[Theme] Invalid background color: ${color}`);
            return false;
        }

        const newConfig = { ...this.getConfig() };
        newConfig.overrides = { ...newConfig.overrides, bgBody: color };

        // Apply additional background options if provided
        if (options.card && this.utils.isValidHex(options.card)) {
            newConfig.overrides.bgCard = options.card;
        }
        if (options.navbar && this.utils.isValidHex(options.navbar)) {
            newConfig.overrides.bgNavbar = options.navbar;
        }
        if (options.sidebar && this.utils.isValidHex(options.sidebar)) {
            newConfig.overrides.bgSidebar = options.sidebar;
        }
        if (options.input && this.utils.isValidHex(options.input)) {
            newConfig.overrides.bgInput = options.input;
        }

        this.apply(newConfig);
        return true;
    },

    /**
     * Reset to default theme
     */
    reset() {
        const root = document.documentElement;

        // Remove all inline style properties (restores CSS defaults)
        const theme = this.generateTheme(BRAND_CONFIG);
        Object.keys(theme).forEach(property => {
            root.style.removeProperty(property);
        });

        this.currentConfig = null;
        console.log('[Theme] Reset to CSS defaults');
    },

    /**
     * Export current theme as CSS variables
     */
    exportCSS() {
        const theme = this.generateTheme(this.getConfig());
        let css = ':root {\n';
        Object.entries(theme).forEach(([property, value]) => {
            css += `  ${property}: ${value};\n`;
        });
        css += '}\n';
        return css;
    },

    /**
     * Preset themes for quick switching
     */
    presets: {
        blue: {
            primary: '#3b82f6',
            secondary: '#8b5cf6',
            accent: '#6366f1',
            brandName: 'HyperDroid Blue'
        },
        green: {
            primary: '#10b981',
            secondary: '#14b8a6',
            accent: '#059669',
            brandName: 'HyperDroid Green'
        },
        purple: {
            primary: '#8b5cf6',
            secondary: '#a855f7',
            accent: '#7c3aed',
            brandName: 'HyperDroid Purple'
        },
        red: {
            primary: '#ef4444',
            secondary: '#f97316',
            accent: '#dc2626',
            brandName: 'HyperDroid Red'
        },
        orange: {
            primary: '#f97316',
            secondary: '#fb923c',
            accent: '#ea580c',
            brandName: 'HyperDroid Orange'
        },
        teal: {
            primary: '#14b8a6',
            secondary: '#06b6d4',
            accent: '#0d9488',
            brandName: 'HyperDroid Teal'
        },
        indigo: {
            primary: '#6366f1',
            secondary: '#818cf8',
            accent: '#4f46e5',
            brandName: 'HyperDroid Indigo'
        },
        pink: {
            primary: '#ec4899',
            secondary: '#f472b6',
            accent: '#db2777',
            brandName: 'HyperDroid Pink'
        },
        slate: {
            primary: '#475569',
            secondary: '#64748b',
            accent: '#334155',
            brandName: 'HyperDroid Slate'
        }
    },

    /**
     * Apply a preset theme
     */
    applyPreset(presetName) {
        const preset = this.presets[presetName];
        if (preset) {
            this.apply(preset);
        } else {
            console.warn(`[Theme] Preset "${presetName}" not found. Available: ${Object.keys(this.presets).join(', ')}`);
        }
    }
};

// Auto-apply theme on DOM ready with saved mode preference
function initTheme() {
    const savedMode = Theme.loadSavedMode();
    Theme.apply(BRAND_CONFIG, savedMode);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme);
} else {
    initTheme();
}

// Listen for system preference changes
if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        // Only auto-switch if user hasn't set a preference
        if (!Theme.loadSavedMode()) {
            Theme.apply(Theme.getConfig(), e.matches ? 'dark' : 'light');
        }
    });
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Theme, BRAND_CONFIG };
}
