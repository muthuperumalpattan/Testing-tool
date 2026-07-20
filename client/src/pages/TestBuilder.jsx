import React, { useState, useEffect, useRef, memo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Save, Play, Plus, Trash2, ArrowLeft, Terminal, Layout, MoveUp, MoveDown, CheckCircle, Activity, GripVertical, Upload } from 'lucide-react';
import { apiFetch, apiGet, apiUrl } from '../api';
import { useToast } from '../components/ToastProvider';
import SelectControl from '../components/SelectControl';
import { ButtonSpinner, BuilderSkeleton } from '../components/Loading';
import EmptyState from '../components/EmptyState';

const LiveBrowserFrame = memo(function LiveBrowserFrame({ src, frameKey }) {
    if (!src) {
        return (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', color: 'var(--text-muted)' }}>
                <div className="spin" style={{ width: '38px', height: '38px', border: '4px solid rgba(99,102,241,0.25)', borderTopColor: 'var(--primary)', borderRadius: '50%' }}></div>
                <div style={{ fontSize: '0.85rem' }}>Loading test browser…</div>
            </div>
        );
    }
    return (
        <iframe
            key={frameKey}
            title="Test Browser"
            src={src}
            style={{ flex: 1, width: '100%', border: 'none', background: '#fff' }}
            allow="fullscreen; clipboard-read; clipboard-write"
            referrerPolicy="no-referrer-when-downgrade"
        />
    );
});

const TestBuilder = () => {
    const { testId } = useParams();
    const navigate = useNavigate();
    const { toast, confirm } = useToast();
    const [test, setTest] = useState(null);
    const [steps, setSteps] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState(null);
    const [browserUrl, setBrowserUrl] = useState(null);
    const [liveOpen, setLiveOpen] = useState(false);
    const [iframeKey, setIframeKey] = useState(0);
    const browserUrlRef = useRef(null);

    const parseStepsFromApi = (stepsData) => (stepsData || []).map((s, index) => {
        try {
            const payload = typeof s.payload === 'string' ? JSON.parse(s.payload) : (s.payload || {});
            return { type: s.type, payload };
        } catch (err) {
            console.error(`Step ${index + 1} parse error:`, err);
            return {
                type: s.type || 'WAIT_FOR',
                payload: { label: `Step ${index + 1} (reload issue)`, selector: '', _parseError: true },
            };
        }
    });

    const reloadStepsFromServer = async () => {
        const stepsData = await apiGet(`/api/tests/${testId}/steps`);
        setSteps(parseStepsFromApi(stepsData));
        setDirty(false);
        return stepsData;
    };

    useEffect(() => {
        setLoading(true);
        setDirty(false);
        Promise.all([
            apiGet(`/api/tests/${testId}/steps`),
            apiGet(`/api/tests/${testId}`),
        ])
            .then(([stepsData, testData]) => {
                setSteps(parseStepsFromApi(stepsData));
                setTest(testData);
                setDirty(false);
            })
            .catch((err) => {
                console.error(err);
                toast.error('Failed to load test details');
            })
            .finally(() => setLoading(false));
    }, [testId]);

    const markDirty = () => setDirty(true);

    const addStep = (type) => {
        const newStep = {
            type,
            payload: type === 'OPEN_URL' ? { url: test?.websiteUrl || '', value: '', label: '' } :
                type === 'API_REQUEST' ? { method: 'GET', url: '', headers: {}, body: '' } :
                type === 'CLICK' ? { selector: '', strategy: 'css', matchIndex: 1 } :
                    type === 'INPUT' ? { selector: '', value: '', strategy: 'css', matchIndex: 1 } :
                    type === 'UPLOAD_FILE' ? { selector: '', strategy: 'label', matchIndex: 1, fileName: '', fileType: '', fileData: '' } :
                        type === 'WAIT_FOR' ? { selector: '', strategy: 'css', matchIndex: 1 } :
                            type === 'VALIDATE_STATUS' ? { expectedStatus: 200 } :
                                type === 'INTERCEPT_API' ? { urlPattern: '', expectedStatus: 200, method: 'ANY' } :
                                    { value: '' }
        };
        setSteps([...steps, newStep]);
        markDirty();
    };

    const handleSampleFile = (index, file) => {
        if (!file) {
            updateStep(index, { fileName: '', fileType: '', fileData: '', fileSize: 0 });
            return;
        }
        const maxBytes = 5 * 1024 * 1024; // 5 MB
        if (file.size > maxBytes) {
            toast.error('Sample file must be 5 MB or smaller');
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result || '');
            const base64 = result.includes(',') ? result.split(',')[1] : result;
            updateStep(index, {
                fileName: file.name,
                fileType: file.type || 'application/octet-stream',
                fileData: base64,
                fileSize: file.size,
            });
        };
        reader.onerror = () => toast.error('Failed to read the selected file');
        reader.readAsDataURL(file);
    };

    const updateStep = (index, payload) => {
        const newSteps = [...steps];
        newSteps[index].payload = { ...newSteps[index].payload, ...payload };
        setSteps(newSteps);
        markDirty();
    };

    const moveStep = (index, direction) => {
        if (direction === 'up' && index > 0) {
            const newSteps = [...steps];
            [newSteps[index], newSteps[index - 1]] = [newSteps[index - 1], newSteps[index]];
            setSteps(newSteps);
            markDirty();
        } else if (direction === 'down' && index < steps.length - 1) {
            const newSteps = [...steps];
            [newSteps[index], newSteps[index + 1]] = [newSteps[index + 1], newSteps[index]];
            setSteps(newSteps);
            markDirty();
        }
    };

    const removeStep = (index) => {
        setSteps(steps.filter((_, i) => i !== index));
        markDirty();
    };

    // Drag & drop reordering
    const [dragIndex, setDragIndex] = useState(null);
    const [dragOverIndex, setDragOverIndex] = useState(null);
    const [dragArmedIndex, setDragArmedIndex] = useState(null);

    const resetDrag = () => {
        setDragIndex(null);
        setDragOverIndex(null);
        setDragArmedIndex(null);
    };

    const handleDrop = (targetIndex) => {
        if (dragIndex === null || dragIndex === targetIndex) {
            resetDrag();
            return;
        }
        const newSteps = [...steps];
        const [moved] = newSteps.splice(dragIndex, 1);
        newSteps.splice(targetIndex, 0, moved);
        setSteps(newSteps);
        markDirty();
        resetDrag();
    };

    const saveTest = async (quiet = false) => {
        setSaving(true);
        try {
            const res = await apiFetch(`/api/tests/${testId}/steps`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ steps })
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || data.details || 'Failed to save steps');
            }
            const saved = await res.json().catch(() => ({}));
            setDirty(false);
            if (!quiet) toast.success(`Test saved (${saved.count ?? steps.length} steps)`);
            return true;
        } catch (err) {
            toast.error(err.message || 'Failed to save test');
            try {
                await reloadStepsFromServer();
            } catch {
                /* keep local steps if reload fails */
            }
            return false;
        } finally {
            setSaving(false);
        }
    };

    const resolveStartUrl = () => {
        const openStep = steps.find((s) => s.type === 'OPEN_URL');
        const stepUrl = openStep?.payload?.url || openStep?.payload?.value || '';
        return (stepUrl || test?.websiteUrl || '').trim();
    };

    const setStatus = async (status) => {
        const res = await apiFetch(`/api/tests/${testId}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        if (!res.ok) throw new Error(`Failed to set status to ${status}`);
        setTest((prev) => ({ ...prev, status }));
    };

    const publishTest = async () => {
        const isPublished = test?.status === 'Published';
        if (isPublished) {
            const ok = await confirm({
                title: 'Unpublish test?',
                message: 'This will move the test back to Draft.',
                confirmText: 'Unpublish',
                cancelText: 'Cancel',
                danger: true,
            });
            if (!ok) return;
            setPublishing(true);
            try {
                await setStatus('Draft');
                toast.success('Test unpublished (Draft)');
            } catch (err) {
                toast.error(err.message || 'Failed to unpublish');
            } finally {
                setPublishing(false);
            }
            return;
        }

        setPublishing(true);
        try {
            const saved = await saveTest(true);
            if (!saved) return;
            await setStatus('Published');
            toast.success('Test published successfully');
        } catch (err) {
            toast.error(err.message || 'Failed to publish');
        } finally {
            setPublishing(false);
        }
    };

    const handleBack = async () => {
        if (dirty) {
            const ok = await confirm({
                title: 'Leave without saving?',
                message: 'You have unsaved changes. Leave this page and discard them?',
                confirmText: 'Leave',
                cancelText: 'Stay',
                danger: true,
            });
            if (!ok) return;
        }
        if (test?.projectId) navigate(`/projects/${test.projectId}/tests`);
        else navigate('/projects');
    };

    useEffect(() => {
        if (!running) return;

        let cancelled = false;
        let consecutiveErrors = 0;
        const MAX_ERRORS = 5;
        const BASE_INTERVAL = 600; // avoid hammering React re-renders (was causing iframe flicker)
        const MAX_INTERVAL = 5000;

        const poll = async () => {
            if (cancelled) return;

            try {
                const res = await apiFetch(`/api/tests/${testId}/run-status`, {
                    signal: AbortSignal.timeout(15000)
                });

                if (!res.ok) {
                    consecutiveErrors++;
                    console.warn(`Poll got ${res.status} (${consecutiveErrors}/${MAX_ERRORS})`);
                } else {
                    consecutiveErrors = 0;
                    const data = await res.json();
                    if (data && !data.waiting) {
                        if (data.finished) {
                            // Keep the live browser open so the user can review the final screen
                            setRunning(false);
                            setResult({ ...data, isLive: false });
                            return;
                        } else if (data.logs !== undefined || data.snapshots !== undefined || data.liveView !== undefined || data.networkHistory !== undefined) {
                            setResult(prev => {
                                const nextLogs = data.logs ?? prev?.logs ?? '';
                                const nextNet = Array.isArray(data.networkHistory) ? data.networkHistory : (prev?.networkHistory ?? []);
                                if (prev?.logs === nextLogs && prev?.isLive &&
                                    (prev?.networkHistory?.length || 0) === nextNet.length) return prev;
                                return {
                                    ...prev,
                                    logs: nextLogs,
                                    networkHistory: nextNet,
                                    snapshots: data.snapshots ?? prev?.snapshots ?? [],
                                    liveView: data.liveView ?? prev?.liveView,
                                    isLive: true
                                };
                            });
                        }
                    }
                }
            } catch (err) {
                consecutiveErrors++;
                console.error(`Poll error (${consecutiveErrors}/${MAX_ERRORS}):`, err.message);
            }

            if (consecutiveErrors >= MAX_ERRORS) {
                console.error('Too many poll failures — stopping. Check Render logs.');
                setRunning(false);
                setResult(prev => ({
                    ...prev,
                    logs: (prev?.logs || '') + '\n❌ Lost connection to server after multiple retries. Check Render dashboard.',
                    finished: true,
                    status: 'Failed'
                }));
                return;
            }

            const delay = Math.min(BASE_INTERVAL * (consecutiveErrors + 1), MAX_INTERVAL);
            if (!cancelled) setTimeout(poll, delay);
        };

        const initialTimer = setTimeout(poll, BASE_INTERVAL);

        return () => {
            cancelled = true;
            clearTimeout(initialTimer);
        };
    }, [running, testId]);

    const closeLiveSession = async () => {
        setRunning(false);
        try {
            await apiFetch(`/api/tests/${testId}/stop-live`, { method: 'POST' });
        } catch (_) { /* ignore */ }
        try {
            const iframe = document.querySelector('iframe[title="Test Browser"]');
            iframe?.contentWindow?.postMessage('CLEAR_TEST_SESSION', '*');
        } catch (_) { /* cross-origin safe */ }
        await new Promise((r) => setTimeout(r, 300));
        setIframeKey(Date.now());
        setBrowserUrl(apiUrl(`/api/clear-session?full=1&t=${Date.now()}`));
        await new Promise((r) => setTimeout(r, 1000));
        setBrowserUrl('about:blank');
        await new Promise((r) => setTimeout(r, 150));
        setLiveOpen(false);
        setBrowserUrl(null);
        browserUrlRef.current = null;
        setResult(null);
    };

    const handleRun = async () => {
        const startUrl = resolveStartUrl();
        if (!startUrl) {
            toast.error('Please add an Open URL step (or set the project website URL) before running.');
            return;
        }

        try {
            await apiFetch(`/api/tests/${testId}/stop-live`, { method: 'POST' });
        } catch (_) { /* ignore */ }

        const runId = Date.now();
        setIframeKey(runId);
        setRunning(true);
        setLiveOpen(true);
        setResult({ logs: '🚀 Starting fresh test run…', networkHistory: [], isLive: true, finished: false });

        try {
            setBrowserUrl(apiUrl(`/api/clear-session?full=1&t=${runId}`));
            await new Promise((r) => setTimeout(r, 600));

            const saved = await saveTest(true);
            if (!saved) {
                setRunning(false);
                return;
            }

            const proxyUrl = apiUrl(`/api/proxy?url=${encodeURIComponent(startUrl)}&testId=${testId}&runId=${runId}&fresh=1`);
            browserUrlRef.current = proxyUrl;
            setBrowserUrl(proxyUrl);
            setTest((prev) => prev ? { ...prev, websiteUrl: startUrl } : prev);

            await apiFetch(`/api/tests/${testId}/run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: 'live' })
            });
        } catch (err) {
            console.error('Run error:', err);
            setResult({
                logs: `❌ Execution failed to start: ${err.message}`,
                finished: true,
                status: 'Failed'
            });
            await closeLiveSession();
        }
    };

    const actions = [
        {
            group: 'UI Actions', items: [
                { id: 'OPEN_URL', label: 'Open URL', icon: <Layout size={14} /> },
                { id: 'CLICK', label: 'Click Element', icon: <Layout size={14} /> },
                { id: 'INPUT', label: 'Enter Text', icon: <Layout size={14} /> },
                { id: 'UPLOAD_FILE', label: 'Upload File', icon: <Upload size={14} /> },
                { id: 'WAIT_FOR', label: 'Wait for Element', icon: <Layout size={14} /> },
                { id: 'INTERCEPT_API', label: 'Intercept API', icon: <Activity size={14} /> },
                { id: 'SCREENSHOT', label: 'Take Screenshot', icon: <Layout size={14} /> }
            ]
        },
        {
            group: 'API Actions', items: [
                { id: 'GET', label: 'GET Request', icon: <Terminal size={14} /> },
                { id: 'POST', label: 'POST Request', icon: <Terminal size={14} /> },
                { id: 'VALIDATE_STATUS', label: 'Validate Status', icon: <CheckCircle size={14} /> },
                { id: 'VALIDATE_JSON', label: 'Validate JSON', icon: <CheckCircle size={14} /> }
            ]
        }
    ];

    if (loading) {
        return <BuilderSkeleton />;
    }

    return (
        <div className="builder-page">
            {/* Top bar: back on the left, actions right-aligned */}
            <div className="builder-header">
                <div className="builder-header-left">
                    <button className="lb-back" onClick={handleBack} title="Back to tests">
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <h2>Test Builder</h2>
                        <div className="builder-header-sub">
                            <span className={`badge ${test?.status === 'Published' ? 'badge-success' : 'badge-primary'}`} style={{ fontSize: '0.7rem' }}>
                                {test?.status || 'Draft'}
                            </span>
                            {dirty && <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>Unsaved</span>}
                            <span>{test?.name}</span>
                        </div>
                    </div>
                </div>
                <div className="builder-actions">
                    <button
                        className={`lb-btn ${test?.status === 'Published' ? 'lb-btn-outline' : 'lb-btn-accent'}`}
                        onClick={publishTest}
                        disabled={publishing || saving}
                    >
                        {publishing ? <ButtonSpinner /> : <CheckCircle size={17} />}
                        {publishing ? 'Updating…' : (test?.status === 'Published' ? 'Unpublish' : 'Publish')}
                    </button>
                    <button
                        className="lb-btn lb-btn-outline"
                        onClick={() => saveTest(false)}
                        disabled={saving || publishing}
                    >
                        {saving ? <ButtonSpinner /> : <Save size={17} />} {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button className="lb-btn lb-btn-primary" onClick={handleRun} disabled={running || saving}>
                        {running ? <ButtonSpinner size={17} /> : <Play size={17} />}
                        {running ? 'Running...' : 'Run Test'}
                    </button>
                </div>
            </div>

            <div className="builder-body">
                {/* Left controls */}
                <aside className="builder-side">
                    <h3>Available Actions</h3>
                    {actions.map(group => (
                        <div key={group.group}>
                            <div className="builder-side-group">{group.group}</div>
                            {group.items.map(action => (
                                <button key={action.id} className="lb-action" onClick={() => addStep(action.id)}>
                                    {action.icon} {action.label}
                                </button>
                            ))}
                        </div>
                    ))}
                </aside>

                {/* Right: steps with drag & drop */}
                <div className="builder-main">
                    {steps.length === 0 && (
                        <div className="builder-empty">
                            <EmptyState
                                icon={<Plus size={40} />}
                                title="No steps added yet"
                                description="This test does not contain any steps yet. Choose an action from the left panel to start building your test flow."
                            />
                        </div>
                    )}
                    {steps.map((step, index) => (
                        <div
                            key={index}
                            className={`step-card${dragIndex === index ? ' dragging' : ''}${dragOverIndex === index && dragIndex !== index ? ' drag-over' : ''}`}
                            draggable={dragArmedIndex === index}
                            onDragStart={(e) => {
                                setDragIndex(index);
                                e.dataTransfer.effectAllowed = 'move';
                            }}
                            onDragEnd={resetDrag}
                            onDragOver={(e) => {
                                e.preventDefault();
                                e.dataTransfer.dropEffect = 'move';
                                if (dragOverIndex !== index) setDragOverIndex(index);
                            }}
                            onDrop={(e) => {
                                e.preventDefault();
                                handleDrop(index);
                            }}
                        >
                            <button
                                className="step-grip"
                                title="Drag to reorder"
                                onMouseDown={() => setDragArmedIndex(index)}
                                onMouseUp={() => setDragArmedIndex(null)}
                            >
                                <GripVertical size={18} />
                            </button>
                            <div className="step-num">{index + 1}</div>
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                    <div className="step-type">{step.type.replace('_', ' ')}</div>
                                    <input
                                        placeholder="Add a label for this step (e.g. 'Enter Email')"
                                        style={{ flex: 1, height: '34px', fontSize: '0.875rem' }}
                                        value={step.payload.label || ''}
                                        onChange={e => updateStep(index, { label: e.target.value })}
                                    />
                                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                                        <button
                                            onClick={() => moveStep(index, 'up')}
                                            disabled={index === 0}
                                            style={{ background: 'transparent', border: 'none', color: 'var(--lb-muted)', cursor: index === 0 ? 'not-allowed' : 'pointer', padding: '4px' }}
                                        >
                                            <MoveUp size={16} />
                                        </button>
                                        <button
                                            onClick={() => moveStep(index, 'down')}
                                            disabled={index === steps.length - 1}
                                            style={{ background: 'transparent', border: 'none', color: 'var(--lb-muted)', cursor: index === steps.length - 1 ? 'not-allowed' : 'pointer', padding: '4px' }}
                                        >
                                            <MoveDown size={16} />
                                        </button>
                                        <button
                                            onClick={() => removeStep(index)}
                                            style={{ background: 'transparent', border: 'none', color: 'var(--error)', cursor: 'pointer', padding: '4px' }}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                                    {step.type === 'OPEN_URL' && <input placeholder="URL" value={step.payload.url || ''} onChange={e => updateStep(index, { url: e.target.value })} />}
                                    {['CLICK', 'WAIT_FOR'].includes(step.type) && (
                                        <>
                                            <SelectControl
                                                width="160px"
                                                value={step.payload.strategy || 'css'}
                                                onChange={(value) => updateStep(index, { strategy: value })}
                                                options={[
                                                    { value: 'css', label: 'CSS Selector' },
                                                    { value: 'label', label: 'Label Text' },
                                                ]}
                                                placeholder="Selector type"
                                            />
                                            <input
                                                placeholder={step.payload.strategy === 'label' ? "Label Text (e.g. 'Sign In')" : "Selector (e.g. .btn-primary)"}
                                                value={step.payload.selector || ''}
                                                onChange={e => updateStep(index, { selector: e.target.value })}
                                            />
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>M.Index:</span>
                                                <input
                                                    type="number"
                                                    style={{ width: '60px' }}
                                                    value={step.payload.matchIndex || 1}
                                                    onChange={e => updateStep(index, { matchIndex: parseInt(e.target.value) || 1 })}
                                                />
                                            </div>
                                        </>
                                    )}
                                    {step.type === 'INPUT' && (
                                        <>
                                            <SelectControl
                                                width="160px"
                                                value={step.payload.strategy || 'css'}
                                                onChange={(value) => updateStep(index, { strategy: value })}
                                                options={[
                                                    { value: 'css', label: 'CSS Selector' },
                                                    { value: 'label', label: 'Label Text' },
                                                ]}
                                                placeholder="Selector type"
                                            />
                                            <input
                                                placeholder={step.payload.strategy === 'label' ? "Label Text (e.g. 'Email')" : "Selector (e.g. [name='email'])"}
                                                value={step.payload.selector || ''}
                                                onChange={e => updateStep(index, { selector: e.target.value })}
                                            />
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>M.Index:</span>
                                                <input
                                                    type="number"
                                                    style={{ width: '60px' }}
                                                    value={step.payload.matchIndex || 1}
                                                    onChange={e => updateStep(index, { matchIndex: parseInt(e.target.value) || 1 })}
                                                />
                                            </div>
                                            <input placeholder="Value to enter" value={step.payload.value || ''} onChange={e => updateStep(index, { value: e.target.value })} />
                                        </>
                                    )}
                                    {step.type === 'UPLOAD_FILE' && (
                                        <>
                                            <SelectControl
                                                width="160px"
                                                value={step.payload.strategy || 'label'}
                                                onChange={(value) => updateStep(index, { strategy: value })}
                                                options={[
                                                    { value: 'css', label: 'CSS Selector' },
                                                    { value: 'label', label: 'Label Text' },
                                                ]}
                                                placeholder="Selector type"
                                            />
                                            <input
                                                placeholder={step.payload.strategy === 'label' ? "Label text (e.g. 'Upload', 'Choose file')" : "Selector (e.g. input[type='file'])"}
                                                value={step.payload.selector || ''}
                                                onChange={e => updateStep(index, { selector: e.target.value })}
                                            />
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>M.Index:</span>
                                                <input
                                                    type="number"
                                                    style={{ width: '60px' }}
                                                    value={step.payload.matchIndex || 1}
                                                    onChange={e => updateStep(index, { matchIndex: parseInt(e.target.value) || 1 })}
                                                />
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', gridColumn: '1 / -1' }}>
                                                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Sample file to upload</label>
                                                <input
                                                    type="file"
                                                    onChange={(e) => handleSampleFile(index, e.target.files?.[0] || null)}
                                                />
                                                {step.payload.fileName ? (
                                                    <div style={{ fontSize: '0.8rem', color: 'var(--success)' }}>
                                                        Selected: {step.payload.fileName}
                                                        {step.payload.fileSize ? ` (${Math.round(step.payload.fileSize / 1024)} KB)` : ''}
                                                    </div>
                                                ) : (
                                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                                        Pick a sample file (max 5 MB). It is stored with the test and used during the live run.
                                                    </div>
                                                )}
                                            </div>
                                        </>
                                    )}
                                    {['GET', 'POST', 'PUT', 'DELETE'].includes(step.type) && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%' }}>
                                            <input
                                                placeholder="Full API URL (e.g. https://api.example.com/data/1)"
                                                value={step.payload.url || ''}
                                                onChange={e => updateStep(index, { url: e.target.value })}
                                            />
                                            <div style={{ display: 'flex', gap: '1rem' }}>
                                                <input
                                                    type="number"
                                                    placeholder="Expected Status (e.g. 200)"
                                                    style={{ width: '200px' }}
                                                    value={step.payload.expectedStatus || ''}
                                                    onChange={e => updateStep(index, { expectedStatus: parseInt(e.target.value) })}
                                                />
                                                <input
                                                    placeholder="Headers (JSON format)"
                                                    style={{ flex: 1 }}
                                                    value={step.payload.headersText || ''}
                                                    onChange={e => updateStep(index, { headersText: e.target.value })}
                                                />
                                            </div>
                                        </div>
                                    )}
                                    {step.type === 'VALIDATE_STATUS' && <input type="number" placeholder="Expected Status" value={step.payload.expectedStatus || ''} onChange={e => updateStep(index, { expectedStatus: parseInt(e.target.value) })} />}
                                    {step.type === 'INTERCEPT_API' && (
                                        <>
                                            <input
                                                placeholder="URL contains (e.g. /api/workflow/)"
                                                style={{ flex: 1 }}
                                                value={step.payload.urlPattern || ''}
                                                onChange={e => updateStep(index, { urlPattern: e.target.value })}
                                            />
                                            <SelectControl
                                                width="130px"
                                                value={step.payload.method || 'ANY'}
                                                onChange={(value) => updateStep(index, { method: value })}
                                                options={[
                                                    { value: 'ANY', label: 'ANY' },
                                                    { value: 'GET', label: 'GET' },
                                                    { value: 'POST', label: 'POST' },
                                                    { value: 'PUT', label: 'PUT' },
                                                    { value: 'DELETE', label: 'DELETE' },
                                                ]}
                                                placeholder="Method"
                                            />
                                            <input
                                                type="number"
                                                placeholder="Expected Status"
                                                style={{ width: '120px' }}
                                                value={step.payload.expectedStatus || ''}
                                                onChange={e => updateStep(index, { expectedStatus: parseInt(e.target.value) })}
                                            />
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}

                {liveOpen && (
                    <div style={{ position: 'fixed', inset: 0, background: '#0b1220', zIndex: 2000, display: 'flex', flexDirection: 'column' }}>
                        {/* Full-page monitor header */}
                        <div style={{ background: 'rgba(255,255,255,0.05)', padding: '0.6rem 1.25rem', display: 'flex', alignItems: 'center', gap: '1rem', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ff5f56' }}></div>
                                <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ffbd2e' }}></div>
                                <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#27c93f' }}></div>
                            </div>
                            <div style={{ flex: 1, background: 'rgba(0,0,0,0.3)', padding: '0.35rem 1rem', borderRadius: '6px', fontSize: '0.875rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', minWidth: 0 }}>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {localStorage.getItem('API_URL_OVERRIDE') ? '🏠 Home Desktop Monitor' : (window.location.hostname === 'localhost' ? '🏠 Local Automation Monitor' : '☁️ Live Cloud Monitor')} 
                                    - Test #{testId} — {resolveStartUrl() || test?.websiteUrl || '—'}
                                </span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                                    {running ? (
                                        <>
                                            <div className="spin" style={{ width: '10px', height: '10px', border: '2px solid var(--primary)', borderTopColor: 'transparent', borderRadius: '50%' }}></div>
                                            <span style={{ fontSize: '0.75rem' }}>EXECUTING...</span>
                                        </>
                                    ) : (
                                        <span style={{ fontSize: '0.75rem', color: 'var(--success)' }}>FINISHED — review the page, then close</span>
                                    )}
                                </div>
                            </div>
                            <button
                                className="btn"
                                style={{ background: 'var(--error)', color: '#fff', padding: '0.5rem 1.1rem', flexShrink: 0 }}
                                onClick={closeLiveSession}
                            >
                                {running ? 'Stop Session' : 'Close Browser'}
                            </button>
                        </div>

                        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: '#000' }}>
                            {/* Live proxied browser — fills the whole left area */}
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid rgba(255,255,255,0.1)', minWidth: 0 }}>
                                <LiveBrowserFrame src={browserUrl} frameKey={iframeKey} />
                            </div>

                            {/* Execution Logs — compact right panel */}
                            <div style={{ width: '320px', flexShrink: 0, padding: '1rem', overflowY: 'auto', background: '#0b1220' }}>
                                <div style={{ marginBottom: '1rem', padding: '0.75rem', background: running ? 'rgba(59, 130, 246, 0.1)' : 'rgba(16, 185, 129, 0.1)', border: running ? '1px solid rgba(59, 130, 246, 0.2)' : '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                    {running ? (
                                        <div className="spin" style={{ width: '20px', height: '20px', border: '3px solid var(--primary)', borderTopColor: 'transparent', borderRadius: '50%', flexShrink: 0 }}></div>
                                    ) : (
                                        <CheckCircle size={20} color="var(--success)" style={{ flexShrink: 0 }} />
                                    )}
                                    <div>
                                        <div style={{ fontWeight: 'bold', fontSize: '0.85rem', color: running ? 'var(--primary)' : 'var(--success)' }}>
                                            {running ? 'Live run in progress' : 'Run finished'}
                                        </div>
                                        <div style={{ fontSize: '0.72rem', opacity: 0.7 }}>
                                            {running ? 'Watch typing & clicks on the left.' : 'Close when you are done reviewing.'}
                                        </div>
                                    </div>
                                </div>

                                <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>Execution Logs</h3>
                                <div style={{ fontFamily: 'monospace', fontSize: '0.78rem', lineHeight: '1.45', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                    {result?.logs ? result.logs.split('\n').map((log, i) => (
                                        <div key={i} style={{ marginBottom: '0.45rem', borderLeft: '2px solid var(--primary)', paddingLeft: '0.6rem', color: 'rgba(255,255,255,0.9)' }}>{log}</div>
                                    )) : (
                                        <div style={{ color: 'var(--primary)' }}>_ [WAITING...]</div>
                                    )}
                                </div>

                                {(() => {
                                    const assetRe = /\.(js|mjs|css|png|jpe?g|gif|svg|ico|woff2?|ttf|map)(\?|$)/i;
                                    const base = (test?.apiBaseUrl || '').trim();
                                    const all = (result?.networkHistory || []).filter((c) => !assetRe.test(String(c.url || '')));
                                    const matched = base ? all.filter((c) => String(c.url || '').toLowerCase().includes(base.toLowerCase())) : all;
                                    const calls = matched.length > 0 ? matched : all;
                                    if (calls.length === 0) return null;

                                    const methodColor = (m) =>
                                        m === 'GET' ? '#38bdf8' : m === 'POST' ? '#a78bfa' : m === 'DELETE' ? '#f87171' : '#fbbf24';
                                    const statusColor = (s) =>
                                        !s ? '#fbbf24' : s >= 400 ? '#f87171' : '#34d399';

                                    return (
                                        <div style={{ marginTop: '1.5rem' }}>
                                            <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <Activity size={14} color="var(--primary)" /> API Calls
                                                <span style={{ background: 'rgba(99,102,241,0.2)', color: 'var(--primary)', borderRadius: '999px', padding: '0.05rem 0.5rem', fontSize: '0.7rem', letterSpacing: 0 }}>{calls.length}</span>
                                            </h3>

                                            {base && (
                                                <div style={{ marginBottom: '0.75rem', padding: '0.55rem 0.7rem', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: '8px' }}>
                                                    <div style={{ fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Base API URL</div>
                                                    <div style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: '#c7d2fe', wordBreak: 'break-all' }}>{base}</div>
                                                </div>
                                            )}

                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                                                {calls.map((c, i) => {
                                                    let path = c.url;
                                                    try { path = new URL(c.url, window.location.origin).pathname; } catch (e) { /* keep raw */ }
                                                    return (
                                                        <div key={i} title={c.url} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.45rem 0.6rem', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '8px' }}>
                                                            <span style={{ fontSize: '0.62rem', fontWeight: 700, color: methodColor(c.method), width: '44px', flexShrink: 0 }}>{c.method}</span>
                                                            <span style={{ flex: 1, fontSize: '0.7rem', fontFamily: 'monospace', color: 'rgba(255,255,255,0.85)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{path}</span>
                                                            <span style={{ fontSize: '0.68rem', fontWeight: 700, color: statusColor(c.status), display: 'flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0 }}>
                                                                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: statusColor(c.status), boxShadow: `0 0 6px ${statusColor(c.status)}` }}></span>
                                                                {c.status || '…'}
                                                            </span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>
                    </div>
                )}

                {result && (
                    <div className="glass card" style={{ marginTop: '2rem', borderLeft: `4px solid ${result.status === 'Passed' ? 'var(--success)' : 'var(--error)'}` }}>
                        <h3>Test Results</h3>
                        <div style={{ display: 'flex', gap: '2rem', margin: '1rem 0' }}>
                            <div>Status: <span className={`badge ${result.status === 'Passed' ? 'badge-success' : 'badge-error'}`}>{result.status}</span></div>
                            <div>Duration: {result.executionTime}ms</div>
                        </div>

                        {result.snapshots && result.snapshots.length > 0 && (
                            <div style={{ marginBottom: '2rem' }}>
                                <h4 style={{ marginBottom: '1rem' }}>Visual Step Snapshots</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
                                    {result.snapshots.map((snap, i) => (
                                        <div key={i} className="glass" style={{ padding: '0.5rem', borderRadius: '8px' }}>
                                            <div style={{ fontSize: '0.75rem', marginBottom: '0.5rem', fontWeight: 'bold' }}>Step {snap.stepOrder}: {snap.label}</div>
                                            <img 
                                                src={apiUrl(`/screenshots/${snap.fileName}`)} 
                                                alt={snap.label} 
                                                style={{ width: '100%', borderRadius: '4px', cursor: 'pointer' }}
                                                onClick={() => window.open(apiUrl(`/screenshots/${snap.fileName}`), '_blank')}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1.5rem', borderRadius: '12px', fontSize: '0.875rem', fontFamily: 'monospace', whiteSpace: 'pre-wrap', maxHeight: '400px', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.05)' }}>
                            {result.logs}
                        </div>

                        {result.networkHistory && result.networkHistory.length > 0 && (
                            <div style={{ marginTop: '2rem' }}>
                                <h4 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <Activity size={18} color="var(--primary)" /> Detailed Network Logs
                                </h4>
                                <div className="glass" style={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                        <thead>
                                            <tr style={{ background: 'rgba(255,255,255,0.1)', borderBottom: '2px solid var(--primary)' }}>
                                                <th style={{ padding: '1rem', textAlign: 'left', width: '80px', color: '#fff', fontWeight: 'bold' }}>Method</th>
                                                <th style={{ padding: '1rem', textAlign: 'left', color: '#fff', fontWeight: 'bold' }}>URL / Endpoint</th>
                                                <th style={{ padding: '1rem', textAlign: 'left', width: '100px', color: '#fff', fontWeight: 'bold' }}>Status</th>
                                                <th style={{ padding: '1rem', textAlign: 'center', width: '120px', color: '#fff', fontWeight: 'bold' }}>Payload</th>
                                                <th style={{ padding: '1rem', textAlign: 'center', width: '120px', color: '#fff', fontWeight: 'bold' }}>Response</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {result.networkHistory
                                                .filter(item => !test?.apiBaseUrl || item.url.toLowerCase().includes(test.apiBaseUrl.toLowerCase()))
                                                .map((item, i) => (
                                                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', verticalAlign: 'middle', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                                                        <td style={{ padding: '0.75rem 1rem' }}>
                                                            <span className={`badge ${item.method === 'POST' ? 'badge-primary' : item.method === 'GET' ? 'badge-info' : 'badge-warning'}`} style={{ fontSize: '0.7rem', width: '55px', textAlign: 'center', border: '1px solid rgba(255,255,255,0.1)' }}>{item.method}</span>
                                                        </td>
                                                        <td style={{ padding: '0.75rem 1rem' }}>
                                                            <div style={{ fontSize: '0.85rem', fontWeight: '600', color: '#fff', marginBottom: '2px' }}>
                                                                {(() => {
                                                                    try { return new URL(item.url).pathname; }
                                                                    catch (e) { return item.url; }
                                                                })()}
                                                            </div>
                                                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis' }} title={item.url}>
                                                                {item.url}
                                                            </div>
                                                        </td>
                                                        <td style={{ padding: '0.75rem 1rem' }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: item.status >= 400 ? '#ff4b2b' : '#00f2fe', boxShadow: `0 0 10px ${item.status >= 400 ? '#ff4b2b' : '#00f2fe'}` }}></div>
                                                                <span style={{ color: item.status >= 400 ? '#ff4b2b' : '#00f2fe', fontWeight: '800', fontSize: '1rem' }}>{item.status}</span>
                                                            </div>
                                                        </td>
                                                        <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                                                            {item.payload ? (
                                                                <button className="btn" style={{ padding: '0.4rem 0.75rem', fontSize: '0.75rem', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)' }} onClick={() => toast.info(typeof item.payload === 'string' ? item.payload : JSON.stringify(item.payload, null, 2), 8000)}>View Data</button>
                                                            ) : <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>None</span>}
                                                        </td>
                                                        <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                                                            {item.responseBody ? (
                                                                <button className="btn btn-primary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.75rem', boxShadow: '0 4px 15px rgba(0,0,0,0.3)' }} onClick={() => toast.info(typeof item.responseBody === 'string' ? item.responseBody : JSON.stringify(item.responseBody, null, 2), 8000)}>View Body</button>
                                                            ) : <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>No Data</span>}
                                                        </td>
                                                    </tr>
                                                ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>
                )}
                </div>
            </div>
        </div>
    );
};

export default TestBuilder;
