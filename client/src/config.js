// Default backend when VITE_API_BASE_URL is not set (production fallback)
const PRODUCTION_API = 'https://ams-jcwq.onrender.com';

/**
 * Normalize API base URL from env / override.
 * Accepts https://host or https://host/api — paths in this app always start with /api/...
 */
function normalizeBase(url) {
    let base = String(url || '').trim().replace(/\/+$/, '');
    if (!base || base.includes('netlify.app')) return '';
    if (base.endsWith('/api')) base = base.slice(0, -4);
    return base;
}

export function getApiBaseUrl() {
    const override = normalizeBase(localStorage.getItem('API_URL_OVERRIDE'));
    if (override) return override;

    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return 'http://localhost:5000';
    }

    const fromEnv = normalizeBase(import.meta.env.VITE_API_BASE_URL);
    if (fromEnv) return fromEnv;

    return PRODUCTION_API;
}

const config = {
    get API_BASE_URL() {
        return getApiBaseUrl();
    },
};

export default config;
