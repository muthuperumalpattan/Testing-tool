const PRODUCTION_API = 'https://ams-jcwq.onrender.com';

function normalizeBase(url) {
    const base = String(url || '').replace(/\/$/, '');
    // Never use the Netlify frontend as API host (proxy breaks uploads → 500)
    if (!base || base.includes('netlify.app')) return '';
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
