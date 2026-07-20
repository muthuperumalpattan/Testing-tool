import { getApiBaseUrl } from './config';

const RETRY_STATUSES = new Set([502, 503, 504]);
const RETRY_DELAY_MS = 10000;
const MAX_ATTEMPTS = 3;

function joinUrl(path) {
    const base = getApiBaseUrl();
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${base}${p}`;
}

/** Full URL for any API path, e.g. apiUrl('/api/tests/1/steps') */
export function apiUrl(path) {
    return joinUrl(path);
}

/** GET + parse JSON */
export async function apiGet(path) {
    const res = await apiFetch(path);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.details || `Request failed (${res.status})`);
    return data;
}

/** Fetch with retries for Render cold starts (502/503/504). */
export async function apiFetch(path, options = {}) {
    let lastError;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const res = await fetch(joinUrl(path), options);
            if (RETRY_STATUSES.has(res.status) && attempt < MAX_ATTEMPTS) {
                await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
                continue;
            }
            return res;
        } catch (err) {
            lastError = err;
            if (attempt < MAX_ATTEMPTS) {
                await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
                continue;
            }
            throw err;
        }
    }

    throw lastError || new Error('Request failed');
}
