const getApiBaseUrl = () => {
    // 1. Check for manual override (Local Bridge)
    const override = localStorage.getItem('API_URL_OVERRIDE');
    if (override) return override;

    // 2. Local dev → direct backend
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return 'http://localhost:5000';
    }
    // 3. Production frontend (Netlify) → same origin; netlify.toml proxies /api/* to backend
    return window.location.origin;
};

const config = {
    API_BASE_URL: getApiBaseUrl()
};

export default config;
