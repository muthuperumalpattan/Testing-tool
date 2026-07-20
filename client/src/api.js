import { getApiBaseUrl } from './config';

const RETRY_STATUSES = new Set([502, 503, 504]);
const RETRY_DELAY_MS = 10000;
const MAX_ATTEMPTS = 3;

/** Fetch with retries for Render cold starts (502/503/504). */
export async function apiFetch(path, options = {}) {
    let lastError;
    const base = getApiBaseUrl();

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const res = await fetch(`${base}${path}`, options);
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
