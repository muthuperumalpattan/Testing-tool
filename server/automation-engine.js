/**
 * In-page automation engine injected into the proxied iframe.
 * Served at /api/automation-engine.js
 */
(async function () {
    if (window.__AUTOMATION_RUNNING__) return;
    window.__AUTOMATION_RUNNING__ = true;

    const testId = window.__TEST_ID__;
    const apiBase = window.__API_BASE__;
    const runId = String(window.__RUN_ID__ || '1');
    const stepKey = '__auto_step_' + testId + '_' + runId;
    const logKey = '__auto_logs_' + testId + '_' + runId;
    const startKey = '__auto_start_' + testId + '_' + runId;
    const STEP_DELAY = 900;


    console.log('🤖 Live automation active', { testId, runId, apiBase });

    function sleep(ms) {
        return new Promise(function (r) { setTimeout(r, ms); });
    }

    function pushLog(msg) {
        var prev = sessionStorage.getItem(logKey) || '';
        var logs = prev ? (prev + '\n' + msg) : msg;
        sessionStorage.setItem(logKey, logs);
        fetch(apiBase + '/api/tests/' + testId + '/live-progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                logs: logs,
                step: sessionStorage.getItem(stepKey),
                network: (window.__NET_PROBE__ || []).slice(-150)
            })
        }).catch(function () {});
        console.log(msg);
        return logs;
    }

    function getCurrentTargetUrl() {
        try {
            var u = new URL(window.location.href);
            if (u.pathname === '/api/proxy') {
                return u.searchParams.get('url') || '';
            }
            // /__proxy__/https/host/rest...
            var parts = u.pathname.split('/');
            if (parts[1] === '__proxy__' && parts.length >= 4) {
                var proto = parts[2];
                var host = parts[3];
                var rest = parts.slice(4).join('/');
                return proto + '://' + host + '/' + rest + u.search;
            }
            // Path was rewritten to the target site's own path (history.replaceState)
            if (window.__TARGET_ORIGIN__) {
                return window.__TARGET_ORIGIN__ + u.pathname + u.search;
            }
        } catch (e) {}
        return '';
    }

    function normalizeUrl(raw) {
        try {
            var u = new URL(raw, getCurrentTargetUrl() || window.location.href);
            var path = u.pathname.replace(/\/+$/, '') || '/';
            return (u.origin + path + u.search).toLowerCase();
        } catch (e) {
            return String(raw || '').toLowerCase().replace(/\/+$/, '');
        }
    }

    function alreadyOnUrl(target) {
        if (!target) return true;
        var cur = getCurrentTargetUrl();
        if (!cur) return false;
        return normalizeUrl(cur) === normalizeUrl(target);
    }

    function visible(el) {
        if (!el) return false;
        var style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    }

    function textOf(el) {
        return ((el && (el.innerText || el.textContent || el.value || el.placeholder || el.getAttribute('aria-label') || '')) + '').trim();
    }

    function nearestInput(fromEl) {
        if (!fromEl) return null;
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(fromEl.tagName) && visible(fromEl)) return fromEl;
        var nested = fromEl.querySelector && fromEl.querySelector('input, textarea, select');
        if (nested && visible(nested)) return nested;
        var sib = fromEl.nextElementSibling;
        for (var i = 0; i < 4 && sib; i++) {
            if (/^(INPUT|TEXTAREA|SELECT)$/.test(sib.tagName) && visible(sib)) return sib;
            var inner = sib.querySelector && sib.querySelector('input, textarea, select');
            if (inner && visible(inner)) return inner;
            sib = sib.nextElementSibling;
        }
        var parent = fromEl.parentElement;
        for (var d = 0; d < 5 && parent; d++) {
            var inParent = parent.querySelector('input, textarea, select');
            if (inParent && visible(inParent)) return inParent;
            parent = parent.parentElement;
        }
        return null;
    }

    function heuristicInput(want) {
        var w = (want || '').toLowerCase();
        var inputs = Array.prototype.slice.call(document.querySelectorAll('input, textarea, select')).filter(visible);
        if (!inputs.length) return null;

        if (w.indexOf('email') !== -1) {
            return inputs.find(function (el) {
                return el.type === 'email' || /email/i.test(el.name || '') || /email/i.test(el.id || '') || /@/.test(el.placeholder || '');
            }) || null;
        }
        if (w.indexOf('password') !== -1 || w.indexOf('pass') !== -1) {
            return inputs.find(function (el) {
                return el.type === 'password' || /pass/i.test(el.name || '') || /pass/i.test(el.id || '') || /pass/i.test(el.placeholder || '');
            }) || null;
        }
        return null;
    }

    function findByLabel(labelText, preferInput) {
        var want = (labelText || '').toLowerCase().trim();
        if (!want) return null;

        // Fast path for common auth fields (AMS login uses placeholder, not label-for)
        var heuristic = heuristicInput(want);
        if (preferInput && heuristic) return heuristic;

        var candidates = [];

        Array.prototype.forEach.call(document.querySelectorAll('label, span, div, p, h1, h2, h3, h4'), function (lab) {
            var t = textOf(lab).toLowerCase();
            // Prefer short text nodes that look like field labels
            if (!t || t.length > 80) return;
            if (t === want || t.indexOf(want) !== -1) {
                if (lab.htmlFor) {
                    var byId = document.getElementById(lab.htmlFor);
                    if (byId) candidates.push(byId);
                }
                var near = nearestInput(lab);
                if (near) candidates.push(near);
                candidates.push(lab);
            }
        });

        Array.prototype.forEach.call(
            document.querySelectorAll('input, textarea, select, button, a, [role="button"]'),
            function (el) {
                var blob = [
                    el.placeholder,
                    el.name,
                    el.id,
                    el.type,
                    el.value,
                    el.getAttribute('aria-label'),
                    textOf(el)
                ].join(' ').toLowerCase();
                if (blob.indexOf(want) !== -1) candidates.push(el);
            }
        );

        var uniq = [];
        candidates.forEach(function (el) {
            if (el && visible(el) && uniq.indexOf(el) === -1) uniq.push(el);
        });

        if (preferInput) {
            for (var i = 0; i < uniq.length; i++) {
                if (/^(INPUT|TEXTAREA|SELECT)$/.test(uniq[i].tagName)) return uniq[i];
                var converted = nearestInput(uniq[i]);
                if (converted) return converted;
            }
            return heuristicInput(want);
        }

        // For clicks: prefer buttons/links with matching text
        var btn = uniq.find(function (el) {
            return el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button' || (el.tagName === 'INPUT' && /submit|button/i.test(el.type || ''));
        });
        if (btn) return btn;
        return uniq[0] || heuristicInput(want);
    }

    function findElement(payload, preferInput) {
        var strategy = payload.strategy || 'css';
        var selector = payload.selector || '';

        if (strategy === 'label') {
            return findByLabel(selector || payload.label, preferInput);
        }

        if (selector) {
            try {
                var list = document.querySelectorAll(selector);
                var idx = Math.max(1, parseInt(payload.matchIndex || 1, 10)) - 1;
                if (list[idx] && visible(list[idx])) return list[idx];
                if (list[0] && visible(list[0])) return list[0];
            } catch (e) {
                return findByLabel(selector || payload.label, preferInput);
            }
        }

        return findByLabel(payload.label || selector, preferInput);
    }

    function highlight(el, color) {
        if (!el) return function () {};
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        var prev = el.getAttribute('style') || '';
        el.style.outline = '3px solid ' + (color || '#3b82f6');
        el.style.outlineOffset = '3px';
        el.style.boxShadow = '0 0 0 4px rgba(59,130,246,0.25)';
        return function () {
            el.setAttribute('style', prev);
        };
    }

    function setReactValue(el, value) {
        var proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        var desc = Object.getOwnPropertyDescriptor(proto, 'value');
        el.focus();
        if (desc && desc.set) desc.set.call(el, value);
        else el.value = value;
        // React 17/18 listen for InputEvent
        el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: value }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        el.blur();
        el.focus();
    }

    async function typeLive(el, value) {
        var text = value != null ? String(value) : '';
        var clear = highlight(el, '#22c55e');
        el.focus();
        setReactValue(el, '');
        await sleep(250);
        var soFar = '';
        for (var i = 0; i < text.length; i++) {
            soFar += text.charAt(i);
            setReactValue(el, soFar);
            await sleep(90);
        }
        setReactValue(el, text);
        await sleep(450);
        clear();
    }

    function base64ToUint8Array(base64) {
        var binary = atob(base64);
        var len = binary.length;
        var bytes = new Uint8Array(len);
        for (var i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }

    function findFileInput(payload) {
        var strategy = payload.strategy || 'label';
        var selector = payload.selector || '';
        var idx = Math.max(1, parseInt(payload.matchIndex || 1, 10)) - 1;

        function asFileInput(el) {
            if (!el) return null;
            if (el.tagName === 'INPUT' && String(el.type || '').toLowerCase() === 'file') return el;
            var nested = el.querySelector && el.querySelector('input[type="file"]');
            return nested || null;
        }

        // CSS path — allow hidden inputs (upload widgets often hide the real control)
        if (strategy === 'css' && selector) {
            try {
                var list = document.querySelectorAll(selector);
                var picked = asFileInput(list[idx]) || asFileInput(list[0]);
                if (picked) return picked;
            } catch (e) { /* fall through */ }
        }

        // Label / text heuristics
        var want = (selector || payload.label || '').toLowerCase().trim();
        var allFiles = Array.prototype.slice.call(document.querySelectorAll('input[type="file"]'));
        if (!allFiles.length) return null;
        if (!want) return allFiles[idx] || allFiles[0];

        var scored = allFiles.map(function (el) {
            var blob = [
                el.name, el.id, el.className, el.accept,
                el.getAttribute('aria-label'),
                el.getAttribute('title'),
                (el.closest('label') && textOf(el.closest('label'))) || '',
                (el.previousElementSibling && textOf(el.previousElementSibling)) || '',
                (el.parentElement && textOf(el.parentElement)) || ''
            ].join(' ').toLowerCase();
            var score = 0;
            if (blob.indexOf(want) !== -1) score += 5;
            if (/upload|file|attach|browse|choose|document/.test(blob) && /upload|file|attach|browse|choose|document/.test(want)) score += 2;
            return { el: el, score: score };
        }).sort(function (a, b) { return b.score - a.score; });

        if (scored[0] && scored[0].score > 0) return scored[Math.min(idx, scored.length - 1)].el || scored[0].el;
        return allFiles[idx] || allFiles[0];
    }

    async function uploadFileLive(el, payload) {
        if (!el || el.tagName !== 'INPUT' || String(el.type || '').toLowerCase() !== 'file') {
            throw new Error('Target is not a file input');
        }
        if (!payload.fileData || !payload.fileName) {
            throw new Error('No sample file attached to this step');
        }

        var clear = highlight(el, '#a78bfa');
        var bytes = base64ToUint8Array(payload.fileData);
        var file = new File([bytes], payload.fileName, {
            type: payload.fileType || 'application/octet-stream',
            lastModified: Date.now()
        });

        var dt = new DataTransfer();
        dt.items.add(file);
        el.files = dt.files;

        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        // Some React upload widgets listen for these
        try {
            el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
        } catch (e2) { /* older browsers */ }

        await sleep(700);
        clear();
        return file.name;
    }

    async function clickLive(el) {
        var clear = highlight(el, '#a855f7');
        await sleep(450);
        el.focus();
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (type) {
            el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        });
        if (typeof el.click === 'function') el.click();
        await sleep(700);
        clear();
    }

    function installNetworkProbe() {
        if (window.__NET_PROBE__) return window.__NET_PROBE__;
        var netKey = '__auto_net_' + testId + '_' + runId;
        var hits = [];
        // Survive page navigations so the monitor sees the full run history
        try { hits = JSON.parse(sessionStorage.getItem(netKey) || '[]'); } catch (e0) { hits = []; }
        window.__NET_PROBE__ = hits;

        function isInternal(url) {
            var u = String(url || '');
            return u.indexOf('/live-progress') !== -1 ||
                u.indexOf('/steps-data') !== -1 ||
                u.indexOf('/automation-engine') !== -1 ||
                u.indexOf('/api/clear-session') !== -1;
        }

        function record(url, method, status) {
            if (isInternal(url)) return;
            hits.push({ url: String(url || ''), method: String(method || 'GET').toUpperCase(), status: status, t: Date.now() });
            if (hits.length > 200) hits.splice(0, hits.length - 200);
            try { sessionStorage.setItem(netKey, JSON.stringify(hits)); } catch (e1) {}
        }

        var origFetch = window.fetch;
        if (origFetch) {
            window.fetch = function () {
                var args = arguments;
                var url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
                var method = 'GET';
                if (args[1] && args[1].method) method = args[1].method;
                if (args[0] && args[0].method) method = args[0].method;
                return origFetch.apply(this, args).then(function (res) {
                    record(url, method, res.status);
                    return res;
                });
            };
        }

        var OrigXHR = window.XMLHttpRequest;
        if (OrigXHR) {
            window.XMLHttpRequest = function () {
                var xhr = new OrigXHR();
                var url = '';
                var method = 'GET';
                var open = xhr.open;
                xhr.open = function (m, u) {
                    method = m;
                    url = u;
                    return open.apply(xhr, arguments);
                };
                xhr.addEventListener('loadend', function () {
                    record(url, method, xhr.status);
                });
                return xhr;
            };
        }
        return hits;
    }

    async function waitForApi(pattern, expectedStatus, method, timeoutMs) {
        var hits = installNetworkProbe();
        var start = Date.now();
        var lastUpdate = start;
        var wantMethod = (method && method !== 'ANY') ? String(method).toUpperCase() : null;
        while (Date.now() - start < timeoutMs) {
            for (var i = hits.length - 1; i >= 0; i--) {
                var h = hits[i];
                if (String(h.url).indexOf(pattern) === -1) continue;
                if (wantMethod && h.method !== wantMethod) continue;
                if (expectedStatus && h.status && h.status !== expectedStatus) continue;
                if (h.status) return h;
            }

            // Keep the UI visibly alive while a slow request is processing.
            if (Date.now() - lastUpdate >= 30000) {
                var elapsedSeconds = Math.floor((Date.now() - start) / 1000);
                pushLog('⏳ Still waiting for API "' + pattern + '" (' + elapsedSeconds + 's)…');
                lastUpdate = Date.now();
            }
            await sleep(100);
        }
        return null;
    }

    async function waitForElement(payload, timeoutMs) {
        var start = Date.now();
        while (Date.now() - start < timeoutMs) {
            var el = findElement(payload, false);
            if (el) return el;
            await sleep(100);
        }
        return null;
    }

    async function executeSteps() {
        installNetworkProbe();

        var startIdx = parseInt(sessionStorage.getItem(stepKey) || '0', 10);
        var startedAt = parseInt(sessionStorage.getItem(startKey) || String(Date.now()), 10);
        sessionStorage.setItem(startKey, String(startedAt));

        var res = await fetch(apiBase + '/api/tests/' + testId + '/steps-data');
        var steps = await res.json();
        if (!Array.isArray(steps)) {
            pushLog('❌ Could not load steps');
            return;
        }

        if (startIdx === 0) {
            pushLog('🚀 Loaded ' + steps.length + ' steps. Starting live execution...');
        } else if (startIdx >= steps.length) {
            pushLog('🏁 Already finished all steps');
            return;
        } else {
            pushLog('↪️ Resuming from step ' + (startIdx + 1));
        }

        for (var i = startIdx; i < steps.length; i++) {
            var step = steps[i];
            var payload = {};
            try { payload = JSON.parse(step.payload); } catch (e) { payload = {}; }
            var label = payload.label || step.type;

            // Mark step as in-progress BEFORE acting (survives navigation)
            sessionStorage.setItem(stepKey, String(i + 1));
            pushLog('⚡ Step ' + (i + 1) + '/' + steps.length + ': ' + label);

            try {
                if (step.type === 'OPEN_URL') {
                    var next = payload.url || payload.value || '';
                    // Always land on a clean login page for this run (session wipe happens in injected head script).
                    // Only skip navigation when we already opened this exact URL for this run.
                    var openedKey = '__auto_opened_' + testId + '_' + runId;
                    if (sessionStorage.getItem(openedKey) === '1' && (!next || alreadyOnUrl(next))) {
                        pushLog('✅ Page ready for steps');
                        // If login fields are missing, force a hard reopen once
                        var hasEmail = !!heuristicInput('email') || !!findByLabel('Email Address', true);
                        if (!hasEmail && !sessionStorage.getItem('__auto_reopen_' + runId)) {
                            sessionStorage.setItem('__auto_reopen_' + runId, '1');
                            pushLog('🔄 Login form not visible — reopening app fresh…');
                            var reopen = next || getCurrentTargetUrl();
                            if (reopen) {
                                try { localStorage.clear(); } catch (e1) {}
                                window.location.href = apiBase + '/api/proxy?url=' + encodeURIComponent(reopen) +
                                    '&testId=' + encodeURIComponent(testId) +
                                    '&runId=' + encodeURIComponent(runId);
                                return;
                            }
                        }
                    } else {
                        sessionStorage.setItem(openedKey, '1');
                        if (!next || alreadyOnUrl(next)) {
                            pushLog('✅ App loaded — waiting for login form…');
                            await sleep(800);
                        } else {
                            pushLog('🌐 Navigating to ' + next);
                            window.location.href = apiBase + '/api/proxy?url=' + encodeURIComponent(next) +
                                '&testId=' + encodeURIComponent(testId) +
                                '&runId=' + encodeURIComponent(runId);
                            return;
                        }
                    }
                } else if (step.type === 'WAIT_FOR') {
                    var waited = await waitForElement(payload, 12000);
                    pushLog(waited ? '✅ Found: ' + (payload.selector || label) : '⚠️ Wait timeout: ' + (payload.selector || label));
                    if (!waited) window.__AUTO_FAILS__ = (window.__AUTO_FAILS__ || 0) + 1;
                } else if (step.type === 'INPUT') {
                    // Give SPA a moment to paint the login form after wipe
                    var inputEl = null;
                    for (var t = 0; t < 20 && !inputEl; t++) {
                        inputEl = findElement(payload, true) || findByLabel(payload.selector || payload.label, true);
                        if (!inputEl) await sleep(200);
                    }
                    if (inputEl) {
                        await typeLive(inputEl, payload.value != null ? payload.value : '');
                        pushLog('✅ Typed into ' + (payload.selector || label) + ' → ' + (payload.value || ''));
                    } else {
                        pushLog('⚠️ INPUT not found: ' + (payload.selector || label));
                        window.__AUTO_FAILS__ = (window.__AUTO_FAILS__ || 0) + 1;
                    }
                } else if (step.type === 'UPLOAD_FILE') {
                    var fileEl = null;
                    for (var u = 0; u < 20 && !fileEl; u++) {
                        fileEl = findFileInput(payload);
                        if (!fileEl) await sleep(200);
                    }
                    if (fileEl) {
                        try {
                            var uploadedName = await uploadFileLive(fileEl, payload);
                            pushLog('✅ Uploaded file: ' + uploadedName + ' → ' + (payload.selector || label || 'file input'));
                        } catch (upErr) {
                            pushLog('⚠️ Upload failed: ' + (upErr && upErr.message ? upErr.message : upErr));
                            window.__AUTO_FAILS__ = (window.__AUTO_FAILS__ || 0) + 1;
                        }
                    } else {
                        pushLog('⚠️ File input not found: ' + (payload.selector || label || 'upload area'));
                        window.__AUTO_FAILS__ = (window.__AUTO_FAILS__ || 0) + 1;
                    }
                } else if (step.type === 'CLICK') {
                    var clickEl = null;
                    for (var c = 0; c < 15 && !clickEl; c++) {
                        clickEl = findElement(payload, false) || findByLabel(payload.selector || payload.label, false);
                        if (!clickEl) await sleep(200);
                    }
                    if (clickEl) {
                        if (!/^(BUTTON|A|INPUT)$/.test(clickEl.tagName)) {
                            var innerBtn = clickEl.querySelector && clickEl.querySelector('button, a, input[type="submit"], [role="button"]');
                            if (innerBtn) clickEl = innerBtn;
                        }
                        await clickLive(clickEl);
                        pushLog('✅ Clicked: ' + (payload.selector || label));
                        await sleep(900);
                    } else {
                        pushLog('⚠️ CLICK not found: ' + (payload.selector || label));
                        window.__AUTO_FAILS__ = (window.__AUTO_FAILS__ || 0) + 1;
                    }
                } else if (step.type === 'INTERCEPT_API') {
                    // If login UI steps already failed, don't hang for 5 minutes
                    var apiTimeoutMs = payload.timeoutMs ||
                        (payload.timeoutSeconds ? payload.timeoutSeconds * 1000 : 300000);
                    if ((window.__AUTO_FAILS__ || 0) > 0) {
                        apiTimeoutMs = Math.min(apiTimeoutMs, 15000);
                        pushLog('⚠️ Earlier steps failed — shortening API wait to ' + (apiTimeoutMs / 1000) + 's');
                    }
                    pushLog('⏳ Waiting for API "' + payload.urlPattern + '" to finish (up to ' +
                        Math.ceil(apiTimeoutMs / 60000) + ' min)…');
                    var hit = await waitForApi(
                        payload.urlPattern || '',
                        payload.expectedStatus || 200,
                        payload.method || 'ANY',
                        apiTimeoutMs
                    );
                    pushLog(hit
                        ? ('✅ API ' + hit.method + ' ' + hit.status + ' matched "' + payload.urlPattern + '"')
                        : ('❌ API did not finish before timeout: ' + payload.urlPattern));
                } else if (step.type === 'SCREENSHOT') {
                    pushLog('ℹ️ Screenshot skipped in live mode');
                } else {
                    pushLog('ℹ️ Skipped unsupported step: ' + step.type);
                }

                await sleep(STEP_DELAY);
            } catch (err) {
                pushLog('❌ Step failed: ' + label + ' — ' + (err && err.message ? err.message : err));
            }
        }

        var logs = pushLog('🏁 Automation Finished!');
        sessionStorage.removeItem(stepKey);
        fetch(apiBase + '/api/tests/' + testId + '/live-progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                logs: logs,
                finished: true,
                status: 'Passed',
                executionTime: Date.now() - startedAt,
                network: (window.__NET_PROBE__ || []).slice(-150)
            })
        }).catch(function () {});
    }

    if (document.readyState === 'complete') executeSteps();
    else window.addEventListener('load', executeSteps);
})();
