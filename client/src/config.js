const PRODUCTION_API = 'https://ams-jcwq.onrender.com';

const getApiBaseUrl = () => {
    // 1. Manual override (local bridge / debugging)
    const override = localStorage.getItem('API_URL_OVERRIDE');
    if (override) return override.replace(/\/$/, '');

    // 2. Local dev → direct backend
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return 'http://localhost:5000';
    }

    // 3. Netlify env (optional): VITE_API_BASE_URL=https://ams-jcwq.onrender.com
    const fromEnv = import.meta.env.VITE_API_BASE_URL;
    if (fromEnv) return String(fromEnv).replace(/\/$/, '');

    // 4. Production — call Render directly (Netlify /api proxy times out → 504 on cold start)
    return PRODUCTION_API;
};

const config = {
    API_BASE_URL: getApiBaseUrl()
};

export default config;
