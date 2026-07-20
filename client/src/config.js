const PRODUCTION_API = 'https://ams-jcwq.onrender.com';

export function getApiBaseUrl() {
    const override = localStorage.getItem('API_URL_OVERRIDE');
    if (override) return override.replace(/\/$/, '');

    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return 'http://localhost:5000';
    }

    const fromEnv = import.meta.env.VITE_API_BASE_URL;
    if (fromEnv) return String(fromEnv).replace(/\/$/, '');

    // Direct to Render — Netlify /api proxy breaks large uploads (6 MB+ → 500)
    return PRODUCTION_API;
}

const config = {
    get API_BASE_URL() {
        return getApiBaseUrl();
    },
};

export default config;
