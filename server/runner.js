const { getPool } = require('./db');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// Crucial for Render: Ensure Puppeteer looks for Chrome in the local project folder
process.env.PUPPETEER_CACHE_DIR = path.join(__dirname, '.cache', 'puppeteer');

const activeExecutions = new Map();

// Ensure screenshots directory exists
if (!fs.existsSync('./screenshots')) {
    fs.mkdirSync('./screenshots');
}

function getExecutionStatus(testCaseId) {
    const exec = activeExecutions.get(String(testCaseId));
    if (!exec) return null;
    return {
        ...exec,
        snapshots: (exec.snapshots || []).slice(-1),
        liveView: exec.liveView
    };
}

async function runApiTest(testCaseId) {
    const stepsRes = await getPool().query('SELECT * FROM test_steps WHERE "testCaseId" = $1 ORDER BY "stepOrder" ASC', [testCaseId]);
    const steps = stepsRes.rows;
    const startTime = Date.now();
    let logs = ['🚀 Initializing...'];
    const pushLogs = (msg) => {
        logs.push(msg);
        const current = activeExecutions.get(String(testCaseId)) || {};
        activeExecutions.set(String(testCaseId), { ...current, logs: logs.join('\n') });
    };
    let status = 'Passed';
    let lastResponse = null;

    try {
        for (const step of steps) {
            const payload = JSON.parse(step.payload);
            pushLogs(`Executing Step ${step.stepOrder}: ${step.type}`);

            if (['GET', 'POST', 'PUT', 'DELETE'].includes(step.type)) {
                let headers = payload.headers || {};
                if (payload.headersText) {
                    try {
                        headers = { ...headers, ...JSON.parse(payload.headersText) };
                    } catch (e) {
                        pushLogs(`Warning: Invalid headers JSON: ${e.message}`);
                    }
                }

                const options = {
                    method: step.type,
                    headers: headers,
                };
                if (payload.body && step.type !== 'GET') {
                    options.body = typeof payload.body === 'string' ? payload.body : JSON.stringify(payload.body);
                }

                const response = await fetch(payload.url, options);
                let data = {};
                try {
                    data = await response.json();
                } catch (e) {
                    pushLogs(`Note: Response body is not JSON`);
                }

                lastResponse = {
                    status: response.status,
                    data: data,
                    time: Date.now() - startTime
                };
                
                pushLogs(`Response Status: ${response.status} (${response.statusText})`);

                const expectedStatus = payload.expectedStatus || 200;
                if (response.status !== expectedStatus) {
                    throw new Error(`API Request Failed: Expected ${expectedStatus}, but got ${response.status} ${response.statusText}`);
                }
            } else if (step.type === 'VALIDATE_STATUS') {
                const expectedStatus = payload.expectedStatus || 200;
                if (lastResponse.status !== expectedStatus) {
                    throw new Error(`Status validation failed: Expected ${expectedStatus}, but got ${lastResponse.status}`);
                }
                pushLogs(`Status validation passed: ${expectedStatus}`);
            } else if (step.type === 'VALIDATE_JSON') {
                const { field, expectedValue } = payload;
                if (lastResponse.data[field] !== expectedValue) {
                    throw new Error(`JSON validation failed: Expected "${field}" to be "${expectedValue}", but got "${lastResponse.data[field]}"`);
                }
                pushLogs(`JSON validation passed: ${field} = ${expectedValue}`);
            }
        }
    } catch (error) {
        status = 'Failed';
        pushLogs(`❌ FATAL ERROR: ${error.message}`);
    }

    const executionTime = Date.now() - startTime;
    const result = { status, executionTime, logs: logs.join('\n') };
    await getPool().query(`
        INSERT INTO test_results ("testCaseId", status, "responseData", log, "executionTime")
        VALUES ($1, $2, $3, $4, $5)
    `, [testCaseId, status, JSON.stringify(lastResponse), logs.join('\n'), executionTime]);

    activeExecutions.set(String(testCaseId), { ...result, finished: true });
    return result;
}

async function runUiTest(testCaseId) {
    activeExecutions.set(String(testCaseId), { logs: '🚀 Initializing...', snapshots: [] });
    const stepsRes = await getPool().query('SELECT * FROM test_steps WHERE "testCaseId" = $1 ORDER BY "stepOrder" ASC', [testCaseId]);
    const steps = stepsRes.rows;
    const startTime = Date.now();
    let logs = ['🚀 Initializing...'];
    let status = 'Passed';

    // Helper to push logs live to the polling Map
    const pushLogs = (msg) => {
        logs.push(msg);
        const current = activeExecutions.get(testCaseId) || {};
        activeExecutions.set(testCaseId, { ...current, logs: logs.join('\n') });
    };

    let browser = null;
    let page = null;
    const networkHistory = [];
    const requestMap = new Map();
    const stepScreenshots = [];
    let pendingRequests = 0;
    const UI_TIMEOUT = 60000;

    const waitForNetworkIdle = async (timeout = 5000) => {
        const start = Date.now();
        while (pendingRequests > 0 && Date.now() - start < timeout) {
            await new Promise(r => setTimeout(r, 100));
        }
    };

    try {
        // Multi-Path Detection Strategy
        const possiblePaths = [
            process.env.CHROME_PATH,
            process.env.CHROME_BIN,
            '/usr/bin/google-chrome',
            '/usr/bin/chromium-browser',
            '/opt/render/project/.render/chrome/opt/google/chrome/google-chrome',
            path.join(__dirname, '.cache', 'puppeteer', 'chrome', 'linux-134.0.6998.35', 'chrome-linux64', 'chrome') // Guess at bundled path
        ].filter(p => !!p);

        const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
        let launchOptions = {
            headless: isProduction ? 'new' : false, // Headful locally for visual feedback
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--no-first-run',
                '--no-zygote',
                '--disable-extensions',
                '--disable-background-networking',
                '--disable-default-apps',
                '--disable-sync',
                '--disable-translate',
                '--hide-scrollbars',
                '--metrics-recording-only',
                '--mute-audio',
                '--safebrowsing-disable-auto-update',
                '--window-size=1280,720',
                '--js-flags=--max-old-space-size=256' // Cap JS heap to 256MB
            ],
            cacheDirectory: path.join(__dirname, '.cache', 'puppeteer')
        };
        // NOTE: --single-process is intentionally EXCLUDED — it causes Chrome to crash on Linux

        // 1. Try any path that actually exists on disk
        let foundPath = false;
        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                launchOptions.executablePath = p;
                pushLogs(`✅ Found browser at: ${p}`);
                foundPath = true;
                break;
            }
        }

        if (!foundPath) {
            pushLogs(`⚠️ No pre-installed browser found. Using default bundled launch...`);
        } else {
            pushLogs(`✅ Browser binary verified at: ${launchOptions.executablePath}`);
        }

        try {
            pushLogs(`🔄 Launching Browser (Headless: ${launchOptions.headless}, Env: ${isProduction ? 'Cloud/Render' : 'Local'})...`);
            browser = await puppeteer.launch(launchOptions);
        } catch (err) {
            pushLogs(`❌ Primary launch failed: ${err.message}`);
            if (launchOptions.executablePath) {
                pushLogs(`🔄 Retrying with fallback bundled Chromium...`);
                delete launchOptions.executablePath;
                browser = await puppeteer.launch(launchOptions);
            } else {
                throw err;
            }
        }
        
        pushLogs(`🚀 Chrome launched successfully!`);
        page = await browser.newPage();
        pushLogs(`📄 New page created. Setting up interception...`);
        await page.setViewport({ width: 1280, height: 720 });
        await page.setRequestInterception(true);

        // Phase 14, 15 & 17: Network History & Detailed Debugging

        page.on('request', (req) => {
            const method = req.method();
            if (method === 'OPTIONS') {
                req.continue();
                return;
            }
            const entry = { 
                url: req.url(), 
                method, 
                status: 'pending', 
                startTime: Date.now(),
                payload: req.postData() || '',
                headers: req.headers(),
                resourceType: req.resourceType()
            };
            networkHistory.push(entry);
            requestMap.set(req, entry);
            pendingRequests++;
            req.continue();
        });

        page.on('response', async (res) => {
            const entry = requestMap.get(res.request());
            if (entry) {
                entry.status = res.status();
                entry.endTime = Date.now();
                entry.duration = entry.endTime - entry.startTime;
                entry.responseHeaders = res.headers();
                try {
                    const contentType = res.headers()['content-type'] || '';
                    if (contentType.includes('application/json')) {
                        const json = await res.json();
                        entry.responseBody = JSON.stringify(json, null, 2);
                    } else if (contentType.includes('text/')) {
                        entry.responseBody = await res.text();
                    }
                } catch (e) {
                    entry.responseBody = '[Body not captured]';
                }
                entry.res = res;
                pendingRequests--;
            }
        });

        page.on('requestfailed', (req) => {
            const entry = requestMap.get(req);
            if (entry) {
                entry.status = 'failed';
                pendingRequests--;
            }
        });


        // Helper to find element by label text or attributes, returns specific index
        const getElementByLabel = async (labelText, index = 1) => {
            pushLogs(`⏳ Searching for "${labelText}" (Index: ${index})...`);
            const startTime = Date.now();
            while (Date.now() - startTime < UI_TIMEOUT) {
                const elHandle = await page.evaluateHandle((text, i) => {
                    const textLower = text.toLowerCase().trim();
                    const allInputs = Array.from(document.querySelectorAll('input, button, select, textarea, a, [role="button"]'));
                    let candidates = [];

                    // --- PRIORITY 1: Explicit Links & Exact Text ---
                    // 1a. Labels with for/id or child inputs
                    const labels = Array.from(document.querySelectorAll('label'));
                    labels.forEach(l => {
                        const lText = (l.innerText || '').toLowerCase().trim();
                        if (lText === textLower) {
                            if (l.htmlFor) {
                                const el = document.getElementById(l.htmlFor);
                                if (el) candidates.push({ el, priority: 1, type: 'label-for-exact' });
                            }
                            const child = l.querySelector('input, select, textarea, button');
                            if (child) candidates.push({ el: child, priority: 1, type: 'label-child-exact' });
                        }
                    });

                    // 1b. Direct attribute/text matches (Placeholder, Name, InnerText, Value)
                    allInputs.forEach(input => {
                        const p = (input.placeholder || '').toLowerCase().trim();
                        const a = (input.getAttribute('aria-label') || '').toLowerCase().trim();
                        const n = (input.name || '').toLowerCase().trim();
                        const v = (input.value || '').toLowerCase().trim();
                        const it = (input.innerText || '').toLowerCase().trim();
                        
                        // Exact matches for attributes or inner text
                        if (p === textLower || a === textLower || n === textLower || v === textLower || it === textLower) {
                            candidates.push({ el: input, priority: 2, type: 'direct-exact' });
                        }
                    });

                    // --- PRIORITY 2: Fuzzy Matches & Visual Neighbors ---
                    // 2a. Sibling Search (Label followed by Input)
                    labels.forEach(l => {
                        const lText = (l.innerText || '').toLowerCase().trim();
                        if (lText.includes(textLower)) {
                            let next = l.nextElementSibling;
                            for (let j = 0; j < 2 && next; j++) {
                                if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(next.tagName)) {
                                    candidates.push({ el: next, priority: 3, type: 'sibling' });
                                }
                                const nested = next.querySelector('input, select, textarea, button');
                                if (nested) candidates.push({ el: nested, priority: 3, type: 'sibling-nested' });
                                next = next.nextElementSibling;
                            }
                        }
                    });

                    // 2b. Same immediate parent
                    labels.forEach(l => {
                        const lText = (l.innerText || '').toLowerCase().trim();
                        if (lText.includes(textLower) && l.parentElement) {
                            const inParent = l.parentElement.querySelector('input, select, textarea, button');
                            if (inParent) candidates.push({ el: inParent, priority: 4, type: 'container' });
                        }
                    });

                    // 2c. Fuzzy Attribute/Text matches
                    allInputs.forEach(input => {
                        if ((input.placeholder || '').toLowerCase().includes(textLower) ||
                            (input.getAttribute('aria-label') || '').toLowerCase().includes(textLower) ||
                            (input.innerText || '').toLowerCase().includes(textLower) ||
                            (input.value || '').toLowerCase().includes(textLower)) {
                            candidates.push({ el: input, priority: 5, type: 'direct-fuzzy' });
                        }
                    });
                    
                    // Filter for visibility and uniqueness, sorted by priority
                    const visibleCandidates = candidates
                        .filter(c => {
                            const rect = c.el.getBoundingClientRect();
                            return rect.width > 0 && rect.height > 0;
                        })
                        .sort((a, b) => a.priority - b.priority);

                    const seen = new Set();
                    const unique = [];
                    for (const c of visibleCandidates) {
                        if (!seen.has(c.el)) {
                            seen.add(c.el);
                            unique.push(c.el);
                        }
                    }

                    return unique[i - 1] || null;
                }, labelText, index);

                const el = elHandle.asElement();
                if (el) return elHandle;
                
                await new Promise(r => setTimeout(r, 500)); // Poll every 500ms
            }
            
            // If we reach here, we timed out
            const pageContext = await page.evaluate(() => {
                const items = Array.from(document.querySelectorAll('label, input, button, a'))
                    .map(el => (el.innerText || el.placeholder || el.name || el.value || '').trim())
                    .filter(t => !!t && t.length < 50)
                    .slice(0, 20);
                return items.join(', ');
            });
            pushLogs(`❌ Timeout: Could not find "${labelText}". Found: [${pageContext}]`);
            throw new Error(`Timeout waiting for label/input "${labelText}" at index ${index} within ${UI_TIMEOUT/1000}s`);
        };

        // --- NEW: High-Frequency Live Visual Feed ---
        let liveFeedTimer = null;
        const startLiveFeed = () => {
            const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
            if (!isProduction) return; // Keep local headful clean

            liveFeedTimer = setInterval(async () => {
                if (!page || page.isClosed()) return;
                try {
                    const base64 = await page.screenshot({
                        type: 'jpeg',
                        quality: 10, // Ultra-low quality for max speed
                        encoding: 'base64',
                        clip: { x: 0, y: 0, width: 800, height: 600 } // Smaller dimensions
                    });
                    const current = activeExecutions.get(String(testCaseId)) || {};
                    activeExecutions.set(String(testCaseId), { ...current, liveView: base64 });
                } catch (e) {
                    // Silently fail to avoid polluting logs
                }
            }, 200); // 200ms interval (5 FPS) for ultra-speed feed
        };
        const stopLiveFeed = () => {
            if (liveFeedTimer) clearInterval(liveFeedTimer);
        };

        const capture = async (stepOrder, label) => {
            // Static snapshots disabled to favor high-frequency live feed
            return;
        };

        startLiveFeed();
        for (const step of steps) {
            // Stability delay (Ultra-Speed: 100ms)
            await new Promise(r => setTimeout(r, 100));
            const payload = JSON.parse(step.payload);
            const label = payload.label || step.type;
            const strategy = payload.strategy || 'css';
            const mIndex = payload.matchIndex || 1;
            pushLogs(`Step ${step.stepOrder}: ${label} (Index: ${mIndex})`);

            if (step.type === 'OPEN_URL') {
                const response = await page.goto(payload.url, { waitUntil: 'networkidle2', timeout: 30000 });
                if (response && !response.ok()) {
                    throw new Error(`Failed to load page: ${payload.url} (Status: ${response.status()})`);
                }
                pushLogs(`Page loaded: ${payload.url}`);
                await capture(step.stepOrder, label);
            } else if (['GET', 'POST', 'PUT', 'DELETE'].includes(step.type)) {
                let headers = payload.headers || {};
                if (payload.headersText) {
                    try { headers = { ...headers, ...JSON.parse(payload.headersText) }; } catch (e) {}
                }
                const res = await fetch(payload.url, { method: step.type, headers, body: payload.body ? JSON.stringify(payload.body) : undefined });
                pushLogs(`API ${step.type} called: ${payload.url} (Status: ${res.status})`);
                if (payload.expectedStatus && res.status !== payload.expectedStatus) {
                    throw new Error(`API Step Failed: Expected ${payload.expectedStatus}, got ${res.status}`);
                }
            } else if (step.type === 'INTERCEPT_API') {
                const pattern = payload.urlPattern.toLowerCase();
                pushLogs(`Searching history for background API call matching: "${payload.urlPattern}" (Case-Insensitive)`);
                
                let response = null;
                const checkHistory = () => {
                    for (const item of networkHistory) {
                        const urlMatch = item.url.toLowerCase().includes(pattern);
                        const methodMatch = payload.method === 'ANY' ? item.method !== 'OPTIONS' : item.method === payload.method;
                        if (urlMatch && methodMatch && item.res) {
                            return item.res;
                        }
                    }
                    return null;
                };

                // 1. Search history first
                response = checkHistory();
                if (response) {
                    pushLogs(`[History] Found matching call: ${response.url()}`);
                }

                // 2. If not found, wait live
                if (!response) {
                    pushLogs(`Not found in history. Waiting live for: "${payload.urlPattern}"...`);
                    try {
                        response = await page.waitForResponse(
                            res => {
                                const urlMatch = res.url().toLowerCase().includes(pattern);
                                const methodMatch = payload.method === 'ANY' ? res.request().method() !== 'OPTIONS' : res.request().method() === payload.method;
                                return urlMatch && methodMatch;
                            },
                            { timeout: 60000 }
                        );
                    } catch (e) {
                        // On timeout, log the network snapshot to help the user
                        pushLogs(`❌ INTERCEPTION TIMEOUT (60s): Could not find "${payload.urlPattern}"`);
                        pushLogs(`--- NETWORK SNAPSHOT (Last 15 calls) ---`);
                        const snapshot = networkHistory.slice(-15).reverse();
                        snapshot.forEach(item => {
                            pushLogs(`[${item.method}] ${item.url} (Status: ${item.status})`);
                        });
                        pushLogs(`------------------------------------------`);
                        throw new Error(`Interception Timed Out. See log above for seen URLs.`);
                    }
                }
                
                const method = response.request().method();
                let responseBody = '';
                const status = response.status();
                pushLogs(`Intercepted ${method} Request: ${response.url()} (Status: ${status})`);

                if (status === 204 || status === 304) {
                    responseBody = '[No Content]';
                } else {
                    try {
                        const contentType = response.headers()['content-type'] || '';
                        if (contentType.includes('application/json')) {
                            const json = await response.json();
                            responseBody = JSON.stringify(json, null, 2);
                        } else {
                            responseBody = await response.text();
                        }
                    } catch (e) {
                        responseBody = `[Could not parse response content: ${e.message}]`;
                    }
                }

                pushLogs(`Response Data:\n${responseBody}`);

                if (payload.expectedStatus && response.status() !== payload.expectedStatus) {
                    throw new Error(`Intercepted API Step Failed: Expected ${payload.expectedStatus}, got ${response.status()}`);
                }
            } else if (step.type === 'CLICK') {
                if (strategy === 'label') {
                    const elHandle = await getElementByLabel(payload.selector, mIndex);
                    const el = elHandle.asElement();
                    if (el) {
                        await el.scrollIntoView();
                        await el.click();
                        pushLogs(`Clicked element ${mIndex} with label: "${payload.selector}"`);
                    } else {
                        throw new Error(`Could not find or click element ${mIndex} with label "${payload.selector}"`);
                    }
                } else {
                    try {
                        await page.waitForSelector(payload.selector, { visible: true, timeout: UI_TIMEOUT });
                    } catch (e) {
                        const suggestions = await page.evaluate((target) => {
                            const targetClean = target.replace('.', '').toLowerCase();
                            const all = Array.from(document.querySelectorAll('*'));
                            const classes = new Set();
                            all.forEach(el => el.classList.forEach(c => classes.add(c)));
                            const classList = Array.from(classes);
                            
                            // Find classes containing the target string (typo detection)
                            const similar = classList.filter(c => 
                                c.toLowerCase().includes(targetClean) || 
                                targetClean.includes(c.toLowerCase())
                            );
                            return similar.slice(0, 10);
                        }, payload.selector);

                        pushLogs(`❌ Selector Error: Could not find "${payload.selector}" within ${UI_TIMEOUT/1000}s.`);
                        if (suggestions.length > 0) {
                            pushLogs(`💡 Did you mean one of these? : ${suggestions.join(', ')}`);
                        } else {
                            pushLogs(`💡 Tip: Make sure the element is not inside an iframe and the class name is correct.`);
                        }
                        throw new Error(`Waiting for selector "${payload.selector}" failed. Check for typos.`);
                    }
                    const elements = await page.$$(payload.selector);
                    if (elements[mIndex - 1]) {
                        await elements[mIndex - 1].scrollIntoView();
                        await elements[mIndex - 1].click();
                        pushLogs(`Clicked element ${mIndex} matching selector: ${payload.selector}`);
                    } else {
                        throw new Error(`Could not find element at index ${mIndex} for selector: ${payload.selector}`);
                    }
                }
                await capture(step.stepOrder, label);
            } else if (step.type === 'INPUT') {
                if (strategy === 'label') {
                    const elHandle = await getElementByLabel(payload.selector, mIndex);
                    const el = elHandle.asElement();
                    if (el) {
                        await el.scrollIntoView();
                        await el.focus();
                        await page.keyboard.down('Control');
                        await page.keyboard.press('A');
                        await page.keyboard.up('Control');
                        await page.keyboard.press('Backspace');
                        await page.keyboard.type(payload.value);
                        pushLogs(`Entered text into element ${mIndex} with label "${payload.selector}": ${payload.value}`);
                    } else {
                        throw new Error(`Could not find input field ${mIndex} with label "${payload.selector}"`);
                    }
                } else {
                    try {
                        await page.waitForSelector(payload.selector, { visible: true, timeout: UI_TIMEOUT });
                    } catch (e) {
                        const suggestions = await page.evaluate((target) => {
                            const targetClean = target.replace('.', '').toLowerCase();
                            const all = Array.from(document.querySelectorAll('*'));
                            const classes = new Set();
                            all.forEach(el => el.classList.forEach(c => classes.add(c)));
                            const classList = Array.from(classes);
                            const similar = classList.filter(c => 
                                c.toLowerCase().includes(targetClean) || 
                                targetClean.includes(c.toLowerCase())
                            );
                            return similar.slice(0, 10);
                        }, payload.selector);
                        pushLogs(`❌ Input Error: Could not find "${payload.selector}" within ${UI_TIMEOUT/1000}s.`);
                        if (suggestions.length > 0) {
                            pushLogs(`💡 Did you mean one of these? : ${suggestions.join(', ')}`);
                        }
                        throw new Error(`Waiting for selector "${payload.selector}" failed.`);
                    }
                    const elements = await page.$$(payload.selector);
                    if (elements[mIndex - 1]) {
                        await elements[mIndex - 1].scrollIntoView();
                        await elements[mIndex - 1].click({ clickCount: 3 }); 
                        await page.keyboard.press('Backspace');
                        await elements[mIndex - 1].type(payload.value);
                        pushLogs(`Entered text into element ${mIndex} matching selector: ${payload.selector}`);
                    } else {
                        throw new Error(`Could not find element at index ${mIndex} for selector: ${payload.selector}`);
                    }
                }
                await capture(step.stepOrder, label);
            } else if (step.type === 'WAIT_FOR') {
                if (strategy === 'label') {
                    const elHandle = await getElementByLabel(payload.selector, mIndex);
                    if (!elHandle.asElement()) throw new Error(`Timeout waiting for label "${payload.selector}" at index ${mIndex}`);
                } else {
                    try {
                        await page.waitForSelector(payload.selector, { visible: true, timeout: UI_TIMEOUT });
                    } catch (e) {
                        const suggestions = await page.evaluate((target) => {
                            const targetClean = target.replace('.', '').toLowerCase();
                            const all = Array.from(document.querySelectorAll('*'));
                            const classes = new Set();
                            all.forEach(el => el.classList.forEach(c => classes.add(c)));
                            const classList = Array.from(classes);
                            const similar = classList.filter(c => 
                                c.toLowerCase().includes(targetClean) || 
                                targetClean.includes(c.toLowerCase())
                            );
                            return similar.slice(0, 10);
                        }, payload.selector);
                        pushLogs(`❌ Wait Error: Could not find "${payload.selector}" within ${UI_TIMEOUT/1000}s.`);
                        if (suggestions.length > 0) {
                            pushLogs(`💡 Did you mean one of these? : ${suggestions.join(', ')}`);
                        }
                        throw new Error(`Waiting for selector "${payload.selector}" failed.`);
                    }
                    const elements = await page.$$(payload.selector);
                    if (!elements[mIndex - 1]) throw new Error(`Timeout waiting for selector "${payload.selector}" at index ${mIndex}`);
                }
                pushLogs(`Successfully waited for element ${mIndex} matching: ${payload.selector}`);
                await capture(step.stepOrder, label);
            } else if (step.type === 'SCREENSHOT') {
                pushLogs(`Step ${step.stepOrder}: Skipping screenshot (Disabled by user preference)`);
            }
            
            // Artificial delay to make it more "visual" in logs (Ultra-Speed: 100ms)
            await new Promise(r => setTimeout(r, 100));
        }
    } catch (error) {
        status = 'Failed';
        pushLogs(`Error: ${error.message}`);
    } finally {
        // NOTE: Do NOT delete from activeExecutions here — the polling client reads
        // it via /run-status until we overwrite it with finished:true below.
        // Ensure all background APIs are captured before closing the browser
        if (page) {
            try { await waitForNetworkIdle(5000); } catch (_) {}
            await new Promise(r => setTimeout(r, 500));
        }
        stopLiveFeed();
        try { if (browser) await browser.close(); } catch (_) {}
    }

    const executionTime = Date.now() - startTime;
    const cleanHistory = networkHistory.map(item => {
        const { res, ...rest } = item;
        return rest;
    });

    await getPool().query(`
        INSERT INTO test_results ("testCaseId", status, log, "executionTime", "responseData")
        VALUES ($1, $2, $3, $4, $5)
    `, [testCaseId, status, logs.join('\n'), executionTime, JSON.stringify({ networkHistory: cleanHistory, snapshots: stepScreenshots })]);

    const finalResult = { status, executionTime, logs: logs.join('\n'), networkHistory: cleanHistory, snapshots: stepScreenshots, finished: true };
    activeExecutions.set(String(testCaseId), finalResult);
    return finalResult;
}

module.exports = { runApiTest, runUiTest, getExecutionStatus, activeExecutions };
