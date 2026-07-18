const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const bcrypt = require('bcryptjs');
const axios = require('axios'); // For proxying
const { getPool, initDb } = require('./db');
const { runApiTest, runUiTest, getExecutionStatus, activeExecutions } = require('./runner');
require('dotenv').config();

const ALLOWED_ROLES = ['Admin', 'Tester', 'Employee'];

// Passwords are stored as plain text by request (readable in the DB).
async function hashPassword(plain) {
    return String(plain);
}

async function verifyPassword(plain, stored) {
    if (!stored) return false;
    // Still accept old bcrypt-hashed rows so existing accounts can log in
    if (String(stored).startsWith('$2')) {
        return bcrypt.compare(String(plain), stored);
    }
    // Trim guards against stray whitespace/newlines from manual DB edits
    return String(plain).trim() === String(stored).trim();
}

function sanitizeUser(row) {
    if (!row) return null;
    return { id: row.id, username: row.username, role: row.role };
}

const app = express();
app.set('trust proxy', 1);

// Corporate proxies / SSL inspection often break Node's cert chain checks.
// Safe for outbound fetch of public sites in this proxy use-case.
const insecureHttpsAgent = new https.Agent({ rejectUnauthorized: false });

function getPublicBaseUrl(req) {
    const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
    const host = (req.get('x-forwarded-host') || req.get('host') || `localhost:${process.env.PORT || 5000}`).split(',')[0].trim();
    return `${proto}://${host}`;
}

// ── CORS ─────────────────────────────────────────────────────────────────────
const corsOptions = {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept', 'X-Requested-With'],
    optionsSuccessStatus: 200   // Some legacy browsers choke on 204
};
app.use(cors(corsOptions));
// Handle preflight requests for ALL routes explicitly
app.options('/{*any}', cors(corsOptions)); // Express 5 wildcard syntax

// Safety-net: stamp CORS headers on EVERY response (catches cases where
// Render's proxy or an unhandled error bypasses the cors() middleware)
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Origin, Accept, X-Requested-With');
    next();
});

// Large limit: UPLOAD_FILE steps embed sample files as base64 (up to 5 MB each)
app.use(express.json({ limit: '25mb' }));
app.use('/screenshots', express.static('screenshots'));

// ── Health check (keeps Render from returning 520 on sleep wake-up) ──────────
app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

const PORT = process.env.PORT || 5000;

// Initialize DB
initDb().catch(console.error);

// Auth Routes
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body || {};
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        const result = await getPool().query('SELECT * FROM users WHERE username = $1', [username]);
        const user = result.rows[0];
        if (!user || !(await verifyPassword(password, user.password))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Convert old bcrypt-hashed rows to plain text on successful login
        if (String(user.password).startsWith('$2')) {
            await getPool().query('UPDATE users SET password = $1 WHERE id = $2', [String(password), user.id]);
        }

        res.json(sanitizeUser(user));
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed', details: error.message });
    }
});

// Public employee signup. The role is intentionally fixed server-side so a
// visitor cannot create an Admin or Tester account.
app.post('/api/signup', async (req, res) => {
    try {
        const { username, password } = req.body || {};
        const cleanUsername = String(username || '').trim();
        if (!cleanUsername || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }
        if (cleanUsername.length < 3) {
            return res.status(400).json({ error: 'Username must be at least 3 characters' });
        }
        if (String(password).length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        const hashed = await hashPassword(password);
        const result = await getPool().query(
            'INSERT INTO users (username, password, role) VALUES ($1, $2, $3) RETURNING id, username, role',
            [cleanUsername, hashed, 'Employee']
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        if (error.code === '23505') {
            return res.status(409).json({ error: 'Username already exists' });
        }
        console.error('Signup error:', error);
        res.status(500).json({ error: 'Signup failed', details: error.message });
    }
});

// Users CRUD
app.get('/api/users', async (req, res) => {
    try {
        const result = await getPool().query('SELECT id, username, role FROM users ORDER BY id ASC');
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Failed to fetch users', details: error.message });
    }
});

app.post('/api/users', async (req, res) => {
    try {
        const { username, password } = req.body || {};
        if (!username || !password) {
            return res.status(400).json({ error: 'username and password are required' });
        }

        const hashed = await hashPassword(password);
        const result = await getPool().query(
            'INSERT INTO users (username, password, role) VALUES ($1, $2, $3) RETURNING id, username, role',
            [username.trim(), hashed, 'Employee']
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        if (error.code === '23505') {
            return res.status(409).json({ error: 'Username already exists' });
        }
        console.error('Error creating user:', error);
        res.status(500).json({ error: 'Failed to create user', details: error.message });
    }
});

app.put('/api/users/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const { username, password, role } = req.body || {};
        if (!username || !role) {
            return res.status(400).json({ error: 'username and role are required' });
        }
        if (!ALLOWED_ROLES.includes(role)) {
            return res.status(400).json({ error: `role must be one of: ${ALLOWED_ROLES.join(', ')}` });
        }

        const existing = await getPool().query('SELECT * FROM users WHERE id = $1', [id]);
        if (!existing.rows[0]) return res.status(404).json({ error: 'User not found' });

        let result;
        if (password) {
            const hashed = await hashPassword(password);
            result = await getPool().query(
                'UPDATE users SET username = $1, password = $2, role = $3 WHERE id = $4 RETURNING id, username, role',
                [username.trim(), hashed, role, id]
            );
        } else {
            result = await getPool().query(
                'UPDATE users SET username = $1, role = $2 WHERE id = $3 RETURNING id, username, role',
                [username.trim(), role, id]
            );
        }
        res.json(result.rows[0]);
    } catch (error) {
        if (error.code === '23505') {
            return res.status(409).json({ error: 'Username already exists' });
        }
        console.error('Error updating user:', error);
        res.status(500).json({ error: 'Failed to update user', details: error.message });
    }
});

app.delete('/api/users/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const existing = await getPool().query('SELECT * FROM users WHERE id = $1', [id]);
        const user = existing.rows[0];
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (user.role === 'Admin') {
            const adminCount = await getPool().query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'Admin'");
            if (adminCount.rows[0].count <= 1) {
                return res.status(400).json({ error: 'Cannot delete the last Admin user' });
            }
        }

        await getPool().query('DELETE FROM users WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ error: 'Failed to delete user', details: error.message });
    }
});

// Project Routes (user-scoped: Admin sees all, others see only their own
// plus legacy projects created before ownership existed)
app.get('/api/projects', async (req, res) => {
    try {
        const role = String(req.query.role || '');
        const userId = Number.parseInt(req.query.userId, 10);
        const hasUser = Number.isInteger(userId);
        let result;
        if (role === 'Admin' || !hasUser) {
            result = await getPool().query('SELECT * FROM projects ORDER BY id DESC');
        } else {
            result = await getPool().query(
                'SELECT * FROM projects WHERE "ownerId" = $1 OR "ownerId" IS NULL ORDER BY id DESC',
                [userId]
            );
        }
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching projects:', error);
        res.status(500).json({ error: 'Failed to fetch projects', details: error.message });
    }
});

app.post('/api/projects', async (req, res) => {
    try {
        const { name, websiteUrl, apiBaseUrl, description, ownerId } = req.body;
        const result = await getPool().query(
            'INSERT INTO projects (name, "websiteUrl", "apiBaseUrl", description, "ownerId") VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [name, websiteUrl, apiBaseUrl, description, ownerId || null]
        );
        res.json({ id: result.rows[0].id });
    } catch (error) {
        console.error('Error creating project:', error);
        res.status(500).json({ error: 'Failed to create project', details: error.message });
    }
});

app.put('/api/projects/:id', async (req, res) => {
    try {
        const { name, websiteUrl, apiBaseUrl, description } = req.body;
        if (!name || !String(name).trim()) {
            return res.status(400).json({ error: 'Project name is required' });
        }
        const result = await getPool().query(
            `UPDATE projects
             SET name = $1, "websiteUrl" = $2, "apiBaseUrl" = $3, description = $4
             WHERE id = $5
             RETURNING *`,
            [String(name).trim(), websiteUrl || '', apiBaseUrl || '', description || '', req.params.id]
        );
        if (!result.rows[0]) return res.status(404).json({ error: 'Project not found' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating project:', error);
        res.status(500).json({ error: 'Failed to update project', details: error.message });
    }
});

// Test Case Routes
app.get('/api/projects/:id/tests', async (req, res) => {
    const result = await getPool().query(`
        SELECT tc.*, 
               (SELECT status FROM test_results WHERE "testCaseId" = tc.id ORDER BY "createdAt" DESC LIMIT 1) as "lastStatus"
        FROM test_cases tc 
        WHERE tc."projectId" = $1
    `, [req.params.id]);
    res.json(result.rows);
});

app.post('/api/tests', async (req, res) => {
    const { projectId, type, name } = req.body;
    const result = await getPool().query(
        'INSERT INTO test_cases ("projectId", type, name) VALUES ($1, $2, $3) RETURNING id',
        [projectId, type, name]
    );
    res.json({ id: result.rows[0].id });
});

app.put('/api/tests/:id', async (req, res) => {
    try {
        const { name, type } = req.body;
        if (!name || !String(name).trim()) {
            return res.status(400).json({ error: 'Test name is required' });
        }
        const allowedTypes = ['UI', 'API'];
        const nextType = allowedTypes.includes(type) ? type : 'UI';
        const result = await getPool().query(
            `UPDATE test_cases
             SET name = $1, type = $2
             WHERE id = $3
             RETURNING *`,
            [String(name).trim(), nextType, req.params.id]
        );
        if (!result.rows[0]) return res.status(404).json({ error: 'Test not found' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating test:', error);
        res.status(500).json({ error: 'Failed to update test', details: error.message });
    }
});

app.delete('/api/tests/:id', async (req, res) => {
    const client = await getPool().connect();
    try {
        await client.query('BEGIN');
        // No ON DELETE CASCADE on the FKs — remove children first
        await client.query('DELETE FROM test_results WHERE "testCaseId" = $1', [req.params.id]);
        await client.query('DELETE FROM test_steps WHERE "testCaseId" = $1', [req.params.id]);
        const result = await client.query('DELETE FROM test_cases WHERE id = $1 RETURNING id', [req.params.id]);
        await client.query('COMMIT');
        if (!result.rows[0]) return res.status(404).json({ error: 'Test not found' });
        res.json({ success: true });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error deleting test:', error);
        res.status(500).json({ error: 'Failed to delete test', details: error.message });
    } finally {
        client.release();
    }
});

app.delete('/api/projects/:id', async (req, res) => {
    const client = await getPool().connect();
    try {
        await client.query('BEGIN');
        await client.query(
            'DELETE FROM test_results WHERE "testCaseId" IN (SELECT id FROM test_cases WHERE "projectId" = $1)',
            [req.params.id]
        );
        await client.query(
            'DELETE FROM test_steps WHERE "testCaseId" IN (SELECT id FROM test_cases WHERE "projectId" = $1)',
            [req.params.id]
        );
        await client.query('DELETE FROM test_cases WHERE "projectId" = $1', [req.params.id]);
        const result = await client.query('DELETE FROM projects WHERE id = $1 RETURNING id', [req.params.id]);
        await client.query('COMMIT');
        if (!result.rows[0]) return res.status(404).json({ error: 'Project not found' });
        res.json({ success: true });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error deleting project:', error);
        res.status(500).json({ error: 'Failed to delete project', details: error.message });
    } finally {
        client.release();
    }
});

app.get('/api/tests/:id/steps', async (req, res) => {
    const result = await getPool().query('SELECT * FROM test_steps WHERE "testCaseId" = $1 ORDER BY "stepOrder" ASC', [req.params.id]);
    res.json(result.rows);
});

app.get('/api/tests/:id', async (req, res) => {
    const result = await getPool().query(`
        SELECT tc.*, p."apiBaseUrl", p."websiteUrl"
        FROM test_cases tc
        JOIN projects p ON tc."projectId" = p.id
        WHERE tc.id = $1
    `, [req.params.id]);
    res.json(result.rows[0]);
});

app.patch('/api/tests/:id/status', async (req, res) => {
    const { status } = req.body;
    await getPool().query('UPDATE test_cases SET status = $1 WHERE id = $2', [status, req.params.id]);
    res.json({ success: true });
});

app.post('/api/tests/:id/steps', async (req, res) => {
    const { steps } = req.body; // Array of steps
    await getPool().query('DELETE FROM test_steps WHERE "testCaseId" = $1', [req.params.id]);
    
    for (let i = 0; i < steps.length; i++) {
        await getPool().query(
            'INSERT INTO test_steps ("testCaseId", "stepOrder", type, payload) VALUES ($1, $2, $3, $4)',
            [req.params.id, i + 1, steps[i].type, JSON.stringify(steps[i].payload)]
        );
    }
    res.json({ success: true });
});

// Execution Routes
app.post('/api/tests/:id/run', async (req, res) => {
    try {
        const result = await getPool().query('SELECT * FROM test_cases WHERE id = $1', [req.params.id]);
        const test = result.rows[0];
        if (!test) return res.status(404).json({ error: 'Test not found' });

        const mode = req.body?.mode || 'puppeteer';
        const stepsRes = await getPool().query('SELECT type FROM test_steps WHERE "testCaseId" = $1', [req.params.id]);
        const uiStepTypes = ['OPEN_URL', 'CLICK', 'INPUT', 'WAIT_FOR', 'INTERCEPT_API', 'SCREENSHOT'];
        const hasUiSteps = stepsRes.rows.some(s => uiStepTypes.includes(s.type));

        // Live in-app iframe mode: skip Puppeteer (avoids double-run, blink, and long waits)
        if (mode === 'live' && (test.type === 'UI' || hasUiSteps)) {
            activeExecutions.set(String(test.id), {
                logs: '🚀 Live browser mode — running steps in the panel…',
                snapshots: [],
                finished: false,
                mode: 'live'
            });
            return res.json({ message: 'Live execution started', mode: 'live' });
        }

        if (test.type === 'UI' || hasUiSteps) {
            runUiTest(test.id).catch(e => console.error('BG Run UI Error:', e));
        } else {
            runApiTest(test.id).catch(e => console.error('BG Run API Error:', e));
        }
        res.json({ message: 'Execution started' });
    } catch (error) {
        console.error('Execution Error:', error);
        res.status(500).json({ error: 'Internal Server Error during execution', details: error.message });
    }
});

// Progress updates from the in-page automation engine
app.post('/api/tests/:id/live-progress', async (req, res) => {
    const id = String(req.params.id);
    const { logs, finished, status, step, network } = req.body || {};
    const current = activeExecutions.get(id) || { logs: '', snapshots: [] };
    const nextLogs = logs != null ? logs : current.logs;
    activeExecutions.set(id, {
        ...current,
        logs: nextLogs,
        networkHistory: Array.isArray(network) && network.length ? network : current.networkHistory,
        step: step ?? current.step,
        finished: !!finished,
        status: status || current.status || (finished ? 'Passed' : undefined),
        mode: 'live'
    });

    if (finished) {
        try {
            await getPool().query(`
                INSERT INTO test_results ("testCaseId", status, "responseData", log, "executionTime")
                VALUES ($1, $2, $3, $4, $5)
            `, [req.params.id, status || 'Passed', JSON.stringify({ mode: 'live', networkHistory: Array.isArray(network) ? network : [] }), nextLogs || '', req.body.executionTime || 0]);
        } catch (e) {
            console.error('live-progress save error:', e.message);
        }
    }

    res.json({ ok: true });
});

app.get('/api/tests/:id/run-status', (req, res) => {
    const status = getExecutionStatus(req.params.id);
    // Use 200 always — HTTP 102 is non-standard and causes Render's proxy to
    // return a 520 error with no CORS headers, breaking the frontend poll.
    if (!status) return res.status(200).json({ waiting: true });
    res.json(status);
});

app.get('/api/tests/:id/results', async (req, res) => {
    const result = await getPool().query('SELECT * FROM test_results WHERE "testCaseId" = $1 ORDER BY "createdAt" DESC', [req.params.id]);
    res.json(result.rows);
});

app.get('/api/results', async (req, res) => {
    const result = await getPool().query(`
        SELECT tr.*, tc.name as "testName", p.name as "projectName"
        FROM test_results tr
        JOIN test_cases tc ON tr."testCaseId" = tc.id
        JOIN projects p ON tc."projectId" = p.id
        ORDER BY tr."createdAt" DESC
        LIMIT 100
    `);
    res.json(result.rows);
});

// Stats Route (user-scoped like projects)
app.get('/api/stats', async (req, res) => {
    try {
        const role = String(req.query.role || '');
        const userId = Number.parseInt(req.query.userId, 10);
        const scoped = Number.isInteger(userId) && role !== 'Admin';
        // Non-admins: only their projects (legacy NULL-owner ones included)
        const projectFilter = 'WHERE "ownerId" = $1 OR "ownerId" IS NULL';
        const params = scoped ? [userId] : [];

        const projectsCount = await getPool().query(
            `SELECT COUNT(*) as count FROM projects ${scoped ? projectFilter : ''}`,
            params
        );
        const testsCount = await getPool().query(
            `SELECT COUNT(*) as count FROM test_cases tc
             JOIN projects p ON tc."projectId" = p.id
             ${scoped ? 'WHERE p."ownerId" = $1 OR p."ownerId" IS NULL' : ''}`,
            params
        );
        const resultBase = `
            FROM test_results tr
            JOIN test_cases tc ON tr."testCaseId" = tc.id
            JOIN projects p ON tc."projectId" = p.id
        `;
        const scopedAnd = scoped ? 'AND (p."ownerId" = $1 OR p."ownerId" IS NULL)' : '';
        const passedRes = await getPool().query(
            `SELECT COUNT(*) as count ${resultBase} WHERE tr.status = 'Passed' ${scopedAnd}`,
            params
        );
        const failedRes = await getPool().query(
            `SELECT COUNT(*) as count ${resultBase} WHERE tr.status = 'Failed' ${scopedAnd}`,
            params
        );
        const lastRunRes = await getPool().query(
            `SELECT tr."createdAt" ${resultBase} ${scoped ? 'WHERE p."ownerId" = $1 OR p."ownerId" IS NULL' : ''}
             ORDER BY tr."createdAt" DESC LIMIT 1`,
            params
        );

        const totalProjects = parseInt(projectsCount.rows[0].count);
        const totalTests = parseInt(testsCount.rows[0].count);
        const passedTests = parseInt(passedRes.rows[0].count);
        const failedTests = parseInt(failedRes.rows[0].count);

        res.json({
            totalProjects,
            totalTests,
            passedTests,
            failedTests,
            lastRun: lastRunRes.rows[0] ? lastRunRes.rows[0].createdAt : 'Never',
            apiSuccessRate: totalTests > 0 ? Math.round((passedTests / (passedTests + failedTests || 1)) * 100) : 0
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch stats', details: error.message });
    }
});

// --- PROXY RUNNER SYSTEM (in-app iframe for local + Netlify) ---
// Remembered so the referer-based asset fallback still works after the iframe's
// visible path is rewritten to the target site's path (history.replaceState).
let lastProxyTargetOrigin = null;
// Mirror target origin under /__proxy__/https/host/... so SPA modules load same-origin
// (direct Netlify assets fail CORS inside our iframe → blank white page).
function siteMirrorBase(apiBase, targetOrigin) {
    const u = new URL(targetOrigin);
    return `${apiBase}/__proxy__/${u.protocol.replace(':', '')}/${u.host}`;
}

function toMirrorUrl(apiBase, absoluteUrl) {
    const u = new URL(absoluteUrl);
    return `${apiBase}/__proxy__/${u.protocol.replace(':', '')}/${u.host}${u.pathname}${u.search}`;
}

function rewriteHtmlForMirror(html, targetUrl, apiBase, testId, runId) {
    const target = new URL(targetUrl);
    const targetOrigin = target.origin;
    const mirrorBase = siteMirrorBase(apiBase, targetOrigin) + '/';
    const safeRunId = String(runId || Date.now()).replace(/"/g, '');
    const safeTestId = String(testId || '').replace(/"/g, '');
    // SPA routers read location.pathname — it must match the target site's path
    // (e.g. /sign-in), not our proxy path (/api/proxy), or the app renders its 404 page.
    const safeTargetPath = (target.pathname + target.search).replace(/"/g, '\\"');

    // Wipe previous login tokens BEFORE the target app boots, so each Run starts on the login page
    const scriptInjection = `
            <script>
                (function () {
                    function clearSiteAuth() {
                        try { localStorage.clear(); } catch (e1) {}
                        try {
                            document.cookie.split(";").forEach(function (c) {
                                var n = c.split("=")[0].trim();
                                if (!n) return;
                                document.cookie = n + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/";
                                document.cookie = n + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=" + location.hostname;
                            });
                        } catch (e2) {}
                        try {
                            if (window.indexedDB && indexedDB.databases) {
                                indexedDB.databases().then(function (dbs) {
                                    (dbs || []).forEach(function (db) {
                                        if (db && db.name) indexedDB.deleteDatabase(db.name);
                                    });
                                });
                            }
                        } catch (e3) {}
                    }
                    try {
                        var wipeKey = "__auto_wipe_${safeTestId}_${safeRunId}";
                        var keep = {};
                        for (var i = 0; i < sessionStorage.length; i++) {
                            var k = sessionStorage.key(i);
                            if (k && k.indexOf("__auto_") === 0) keep[k] = sessionStorage.getItem(k);
                        }
                        // Always clear app auth when this run has not wiped yet
                        if (!sessionStorage.getItem(wipeKey)) {
                            clearSiteAuth();
                            try { sessionStorage.clear(); } catch (e4) {}
                            Object.keys(keep).forEach(function (k) { sessionStorage.setItem(k, keep[k]); });
                            sessionStorage.setItem(wipeKey, "1");
                        }
                    } catch (e) {
                        try { localStorage.clear(); } catch (e5) {}
                    }
                    window.__TEST_ID__ = "${safeTestId}";
                    window.__API_BASE__ = "${apiBase}";
                    window.__RUN_ID__ = "${safeRunId}";
                    window.__TARGET_ORIGIN__ = "${targetOrigin}";
                    window.__CLEAR_SITE_AUTH__ = clearSiteAuth;
                    // SPA routers match on location.pathname — swap our proxy path
                    // (/api/proxy) for the target site's real path so the app
                    // renders the right page instead of its 404 screen.
                    try { history.replaceState(null, "", "${safeTargetPath}"); } catch (e6) {}
                })();
            </script>
            <script src="${apiBase}/api/automation-engine.js"></script>
        `;

    if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${mirrorBase}">${scriptInjection}`);
    } else {
        html = `<base href="${mirrorBase}">${scriptInjection}` + html;
    }

    html = html.replace(/\s(src|href)=["']([^"']+)["']/gi, (match, attr, val) => {
        if (!val || /^(data:|javascript:|mailto:|#)/i.test(val)) return match;
        if (val.includes('/api/automation-engine') || val.includes('/__proxy__/')) return match;
        try {
            const abs = new URL(val, targetOrigin.endsWith('/') ? targetOrigin : targetOrigin + '/');
            if (abs.origin !== new URL(targetOrigin).origin) return match;
            return ` ${attr}="${toMirrorUrl(apiBase, abs.href)}"`;
        } catch {
            return match;
        }
    });

    html = html.replace(/crossorigin(?:="[^"]*")?/gi, '');
    html = html.replace(/integrity(?:="[^"]*")?/gi, '');
    html = html.replace(/<meta[^>]+http-equiv=["']?X-Frame-Options["']?[^>]*>/gi, '');
    html = html.replace(/if\s*\(\s*(?:window\.)?top\s*!==\s*(?:window\.)?(?:self|window)\s*\)[^;{]*[{;]/gi, '');

    return html;
}

async function fetchTargetBuffer(targetUrl, req) {
    return axios.get(targetUrl, {
        responseType: 'arraybuffer',
        validateStatus: () => true,
        httpsAgent: insecureHttpsAgent,
        timeout: 20000,
        maxRedirects: 5,
        headers: {
            'User-Agent': req.get('User-Agent') || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept: req.get('Accept') || '*/*'
        }
    });
}

app.get('/api/clear-session', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "frame-ancestors *");
    res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Loading…</title>
<style>
  body { margin:0; font-family:'Inter',system-ui,sans-serif; background:#0b1220; color:#e2e8f0;
         min-height:100vh; display:flex; align-items:center; justify-content:center; }
  .box { text-align:center; }
  .spinner { width:44px; height:44px; margin:0 auto 1.1rem; border-radius:50%;
             border:4px solid rgba(99,102,241,0.25); border-top-color:#6366f1;
             animation:spin 0.8s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
  h2 { font-size:1rem; font-weight:600; margin:0 0 0.3rem; }
  p { font-size:0.8rem; color:#94a3b8; margin:0; }
</style>
</head>
<body>
<div class="box">
  <div class="spinner"></div>
  <h2>Preparing test session…</h2>
  <p>Clearing previous login data and loading the page.</p>
</div>
<script>
(function () {
  try { localStorage.clear(); } catch (e) {}
  try { sessionStorage.clear(); } catch (e) {}
  try {
    document.cookie.split(";").forEach(function (c) {
      var n = c.split("=")[0].trim();
      if (!n) return;
      document.cookie = n + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/";
    });
  } catch (e) {}
  try {
    if (indexedDB && indexedDB.databases) {
      indexedDB.databases().then(function (dbs) {
        (dbs || []).forEach(function (db) {
          if (db && db.name) indexedDB.deleteDatabase(db.name);
        });
      });
    }
  } catch (e) {}
})();
</script>
</body></html>`);
});

app.get('/api/proxy', async (req, res) => {
    const { url, testId, runId } = req.query;
    if (!url) return res.status(400).send('URL is required');

    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Cache-Control': 'no-cache'
            },
            timeout: 15000,
            httpsAgent: insecureHttpsAgent,
            maxRedirects: 5,
            validateStatus: () => true,
            responseType: 'text'
        });

        if (response.status >= 400 && !String(response.data || '').includes('<')) {
            return res.status(502).send(
                `Proxy Error: Target site returned ${response.status} for ${url}. ` +
                `Check that the website URL in your project/test is correct and publicly reachable.`
            );
        }

        lastProxyTargetOrigin = new URL(url).origin;
        const apiBase = getPublicBaseUrl(req);
        let html = typeof response.data === 'string' ? response.data : String(response.data);
        html = rewriteHtmlForMirror(html, url, apiBase, testId, runId || Date.now());

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Security-Policy', "frame-ancestors *");
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.removeHeader('X-Frame-Options');
        res.send(html);
    } catch (error) {
        console.error('Proxy Error:', error.message);
        res.status(500).send(`Proxy Error: ${error.message}`);
    }
});

// Same-origin mirror for SPA JS/CSS/chunks (fixes blank iframe)
app.get('/__proxy__/:proto/:host/{*assetPath}', async (req, res) => {
    try {
        const proto = req.params.proto === 'http' ? 'http' : 'https';
        const host = req.params.host;
        const assetPath = req.params.assetPath || '';
        const pathPart = Array.isArray(assetPath) ? assetPath.join('/') : String(assetPath);
        const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        const targetUrl = `${proto}://${host}/${pathPart}${qs}`;
        lastProxyTargetOrigin = `${proto}://${host}`;

        const response = await fetchTargetBuffer(targetUrl, req);
        const contentType = response.headers['content-type'] || 'application/octet-stream';
        res.status(response.status);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=60');

        if (contentType.includes('text/html')) {
            const apiBase = getPublicBaseUrl(req);
            const html = rewriteHtmlForMirror(
                Buffer.from(response.data).toString('utf8'),
                targetUrl,
                apiBase,
                req.query.testId
            );
            return res.send(html);
        }

        return res.send(Buffer.from(response.data));
    } catch (err) {
        console.error('Mirror proxy error:', err.message);
        res.status(502).send(`Mirror Error: ${err.message}`);
    }
});

app.get('/api/automation-engine.js', (req, res) => {
    res.set('Content-Type', 'application/javascript; charset=utf-8');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.sendFile(path.join(__dirname, 'automation-engine.js'));
});

// Helper for proxy to get steps directly
app.get('/api/tests/:id/steps-data', async (req, res) => {
    try {
        const stepsRes = await getPool().query('SELECT * FROM test_steps WHERE "testCaseId" = $1 ORDER BY "stepOrder" ASC', [req.params.id]);
        res.json(stepsRes.rows);
    } catch (error) {
        console.error('steps-data error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Fallback: absolute paths like /assets/... from mirrored pages (referer-based)
app.get('/{*path}', async (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/__proxy__/')) return next();

    const referer = req.get('referer');
    if (!referer) return next();

    try {
        const refererUrl = new URL(referer);
        let targetOrigin = null;

        if (refererUrl.pathname === '/api/proxy') {
            const targetSiteUrl = refererUrl.searchParams.get('url');
            if (targetSiteUrl) targetOrigin = new URL(targetSiteUrl).origin;
        } else if (refererUrl.pathname.startsWith('/__proxy__/')) {
            const parts = refererUrl.pathname.split('/');
            // /__proxy__/https/host/...
            if (parts.length >= 4) targetOrigin = `${parts[2]}://${parts[3]}`;
        } else if (refererUrl.host === req.get('host') && lastProxyTargetOrigin) {
            // Iframe path was rewritten to the target site's own path (e.g. /sign-in),
            // so the referer no longer reveals the target — use the remembered origin.
            targetOrigin = lastProxyTargetOrigin;
        }

        if (targetOrigin) {
            const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
            const assetUrl = `${targetOrigin}${req.path}${qs}`;
            const response = await fetchTargetBuffer(assetUrl, req);
            if (response.headers['content-type']) {
                res.set('Content-Type', response.headers['content-type']);
            }
            res.set('Access-Control-Allow-Origin', '*');
            return res.status(response.status).send(Buffer.from(response.data));
        }
    } catch (err) {
        console.error('Smart Proxy Error on ' + req.path + ':', err.message);
    }

    next();
});

// Global Error Handler (ensure CORS headers even on error)
app.use((err, req, res, next) => {
    console.error('Unhandled Server Error:', err);
    res.header("Access-Control-Allow-Origin", "*");
    res.status(500).json({
        error: 'Internal Server Error',
        details: err.message,
        path: req.path
    });
});

// ── Global crash guards (prevents 520 errors on Render) ──────────────────────
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception (server kept alive):', err);
});
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection (server kept alive):', reason);
});

app.listen(PORT, () => {
    console.log(`Server is live on port ${PORT}`);
});
