import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Plus, Play, Edit3, Trash2, ArrowLeft, Terminal, Layout, FlaskConical } from 'lucide-react';
import { apiFetch, apiGet, apiUrl } from '../api';
import { useToast } from '../components/ToastProvider';
import SelectControl from '../components/SelectControl';
import { ButtonSpinner, TableSkeleton } from '../components/Loading';
import EmptyState from '../components/EmptyState';

const EMPTY_FORM = { name: '', type: 'UI' };

const Tests = () => {
    const { projectId } = useParams();
    const [tests, setTests] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editing, setEditing] = useState(null);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const navigate = useNavigate();
    const { toast, confirm } = useToast();

    const openBuilder = (testId) => navigate(`/tests/${testId}/builder`);

    const loadTests = () => {
        setLoading(true);
        apiGet(`/api/projects/${projectId}/tests`)
            .then((data) => {
                if (Array.isArray(data)) setTests(data);
                else {
                    toast.error(data?.error || 'Failed to load tests');
                    setTests([]);
                }
            })
            .catch(() => {
                toast.error('Failed to load tests');
                setTests([]);
            })
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        loadTests();
    }, [projectId]);

    const openCreate = () => {
        setEditing(null);
        setForm(EMPTY_FORM);
        setShowModal(true);
    };

    const openEdit = (e, test) => {
        e.stopPropagation();
        setEditing(test);
        setForm({ name: test.name || '', type: test.type || 'UI' });
        setShowModal(true);
    };

    const closeModal = () => {
        if (saving) return;
        setShowModal(false);
        setEditing(null);
        setForm(EMPTY_FORM);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.name.trim()) {
            toast.error('Test name is required');
            return;
        }

        setSaving(true);
        try {
            if (editing) {
                const res = await apiFetch(`/api/tests/${editing.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: form.name.trim(), type: form.type }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || 'Failed to update test');
                toast.success('Test updated');
                closeModal();
                loadTests();
            } else {
                const res = await apiFetch('/api/tests', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: form.name.trim(),
                        type: form.type,
                        projectId: parseInt(projectId, 10),
                    }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || 'Failed to create test');
                toast.success('Test case created');
                setShowModal(false);
                setForm(EMPTY_FORM);
                openBuilder(data.id);
            }
        } catch (err) {
            toast.error(err.message || (editing ? 'Failed to update test' : 'Failed to create test'));
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (e, test) => {
        e.stopPropagation();
        const ok = await confirm({
            title: 'Delete test?',
            message: `Delete "${test.name}" along with its steps and run history? This cannot be undone.`,
            confirmText: 'Delete',
            cancelText: 'Cancel',
            danger: true,
        });
        if (!ok) return;

        try {
            const res = await apiFetch(`/api/tests/${test.id}`, { method: 'DELETE' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Failed to delete test');
            toast.success('Test deleted');
            loadTests();
        } catch (err) {
            toast.error(err.message || 'Failed to delete test');
        }
    };

    return (
        <div style={{ padding: '2rem' }}>
            <button className="btn btn-back" style={{ marginBottom: '1rem' }} onClick={() => navigate('/projects')}>
                <ArrowLeft size={18} color="#fff" /> Back to Projects
            </button>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div>
                    <h2>Test Cases</h2>
                    <p style={{ color: 'var(--text-muted)' }}>Create and manage UI and API tests</p>
                </div>
                <button className="btn btn-primary" onClick={openCreate}><Plus size={18} /> New Test Case</button>
            </div>

            <div className="glass" style={{ overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.05)' }}>
                            <th style={{ padding: '1rem' }}>Test Name</th>
                            <th style={{ padding: '1rem' }}>Type</th>
                            <th style={{ padding: '1rem' }}>Status</th>
                            <th style={{ padding: '1rem' }}>Last Result</th>
                            <th style={{ padding: '1rem' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && <TableSkeleton rows={5} columns={5} />}
                        {!loading && tests.map(test => (
                            <tr
                                key={test.id}
                                style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                                onClick={() => openBuilder(test.id)}
                                title="Open Test Builder"
                            >
                                <td style={{ padding: '1rem' }}>
                                    <div style={{ fontWeight: '600', color: 'var(--primary)' }}>{test.name}</div>
                                </td>
                                <td style={{ padding: '1rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        {test.type === 'API' ? <Terminal size={14} color="var(--primary)" /> : <Layout size={14} color="#10b981" />}
                                        {test.type}
                                    </div>
                                </td>
                                <td style={{ padding: '1rem' }}>
                                    <span className={`badge ${test.status === 'Published' ? 'badge-success' : 'badge-info'}`} style={{ fontSize: '0.75rem' }}>
                                        {test.status || 'Draft'}
                                    </span>
                                </td>
                                <td style={{ padding: '1rem' }}>
                                    {test.lastStatus ? (
                                        <span className={`badge ${test.lastStatus === 'Passed' ? 'badge-success' : 'badge-error'}`}>
                                            {test.lastStatus}
                                        </span>
                                    ) : (
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Not run</span>
                                    )}
                                </td>
                                <td style={{ padding: '1rem' }} onClick={(e) => e.stopPropagation()}>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <button
                                            className="btn"
                                            style={{ background: 'var(--primary)', padding: '0.5rem' }}
                                            title="Edit test"
                                            onClick={(e) => openEdit(e, test)}
                                        >
                                            <Edit3 size={16} color="white" />
                                        </button>
                                        <button
                                            className="btn"
                                            style={{ background: 'var(--success)', padding: '0.5rem' }}
                                            title="Open Test Builder"
                                            onClick={() => openBuilder(test.id)}
                                        >
                                            <Play size={16} color="white" />
                                        </button>
                                        <button
                                            className="btn"
                                            style={{ background: 'transparent', padding: '0.5rem', color: 'var(--error)' }}
                                            title="Delete test"
                                            onClick={(e) => handleDelete(e, test)}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {!loading && tests.length === 0 && (
                            <tr>
                                <td colSpan={5}>
                                    <EmptyState
                                        icon={<FlaskConical size={40} />}
                                        title="No test cases found"
                                        description="This project does not contain any test cases yet. Create a new test case to start automating your UI or API checks."
                                        action={(
                                            <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={openCreate}>
                                                <Plus size={18} /> New Test Case
                                            </button>
                                        )}
                                    />
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {showModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <form onSubmit={handleSubmit} className="glass" style={{ width: '400px', padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                        <h3>{editing ? 'Edit Test Case' : 'Create New Test Case'}</h3>
                        <input
                            placeholder="Test Name"
                            value={form.name}
                            onChange={e => setForm({ ...form, name: e.target.value })}
                            required
                        />
                        <SelectControl
                            value={form.type}
                            onChange={(value) => setForm({ ...form, type: value })}
                            options={[
                                { value: 'UI', label: 'Web UI Test' },
                                { value: 'API', label: 'API Test' },
                            ]}
                            placeholder="Select test type"
                        />
                        <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                            <button type="button" className="btn" style={{ flex: 1, background: 'rgba(255,255,255,0.1)' }} onClick={closeModal} disabled={saving}>Cancel</button>
                            <button type="submit" className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} disabled={saving}>
                                {saving && <ButtonSpinner />}
                                {saving
                                    ? (editing ? 'Saving…' : 'Creating…')
                                    : (editing ? 'Save Changes' : 'Continue')}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
};

export default Tests;
