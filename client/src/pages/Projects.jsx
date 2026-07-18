import React, { useState, useEffect } from 'react';
import { Plus, Globe, Link2, ChevronRight, Edit3, Trash2, ArrowLeft, FolderKanban } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import config from '../config';
import { useToast } from '../components/ToastProvider';
import { ButtonSpinner, CardGridSkeleton } from '../components/Loading';
import EmptyState from '../components/EmptyState';

const EMPTY_FORM = { name: '', websiteUrl: '', apiBaseUrl: '', description: '' };

const getCurrentUser = () => {
    try {
        return JSON.parse(localStorage.getItem('user')) || null;
    } catch {
        return null;
    }
};

const Projects = () => {
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editing, setEditing] = useState(null);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const navigate = useNavigate();
    const { toast, confirm } = useToast();

    const loadProjects = () => {
        setLoading(true);
        const user = getCurrentUser();
        const query = user?.id != null
            ? `?userId=${encodeURIComponent(user.id)}&role=${encodeURIComponent(user.role || '')}`
            : '';
        fetch(`${config.API_BASE_URL}/api/projects${query}`)
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) {
                    setProjects(data);
                } else {
                    console.error('API Error:', data);
                    toast.error(data?.error || 'Failed to load projects');
                    setProjects([]);
                }
            })
            .catch(error => {
                console.error('Fetch Error:', error);
                toast.error('Failed to load projects');
                setProjects([]);
            })
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        loadProjects();
    }, []);

    const openCreate = () => {
        setEditing(null);
        setForm(EMPTY_FORM);
        setShowModal(true);
    };

    const openEdit = (project) => {
        setEditing(project);
        setForm({
            name: project.name || '',
            websiteUrl: project.websiteUrl || '',
            apiBaseUrl: project.apiBaseUrl || '',
            description: project.description || '',
        });
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
            toast.error('Project name is required');
            return;
        }

        setSaving(true);
        try {
            const url = editing
                ? `${config.API_BASE_URL}/api/projects/${editing.id}`
                : `${config.API_BASE_URL}/api/projects`;
            const method = editing ? 'PUT' : 'POST';
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: form.name.trim(),
                    websiteUrl: form.websiteUrl.trim(),
                    apiBaseUrl: form.apiBaseUrl.trim(),
                    description: form.description.trim(),
                    ownerId: getCurrentUser()?.id || null,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || (editing ? 'Failed to update project' : 'Failed to create project'));

            if (editing) {
                toast.success('Project updated');
                closeModal();
                loadProjects();
            } else {
                toast.success('Project created');
                setShowModal(false);
                setForm(EMPTY_FORM);
                navigate(`/projects/${data.id}/tests`);
            }
        } catch (err) {
            toast.error(err.message || (editing ? 'Failed to update project' : 'Failed to create project'));
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteClick = async (project) => {
        const ok = await confirm({
            title: 'Delete project?',
            message: `Delete "${project.name}" along with all its tests, steps, and run history? This cannot be undone.`,
            confirmText: 'Delete',
            cancelText: 'Cancel',
            danger: true,
        });
        if (!ok) return;

        try {
            const res = await fetch(`${config.API_BASE_URL}/api/projects/${project.id}`, { method: 'DELETE' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Failed to delete project');
            toast.success('Project deleted');
            loadProjects();
        } catch (err) {
            toast.error(err.message || 'Failed to delete project');
        }
    };

    return (
        <div style={{ padding: '2rem' }}>
            <button className="btn btn-back" style={{ marginBottom: '1rem' }} onClick={() => navigate('/')}>
                <ArrowLeft size={18} color="#fff" /> Back to Dashboard
            </button>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div>
                    <h2>Projects</h2>
                    <p style={{ color: 'var(--text-muted)' }}>Manage your testing environments</p>
                </div>
                <button className="btn btn-primary" onClick={openCreate}><Plus size={18} /> New Project</button>
            </div>

            {loading && <CardGridSkeleton cards={6} />}

            {!loading && projects.length === 0 && (
                <div className="glass">
                    <EmptyState
                        icon={<FolderKanban size={40} />}
                        title="No projects found"
                        description="You don't have any projects yet. Create a new project to start building and running tests for your website or API."
                        action={(
                            <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={openCreate}>
                                <Plus size={18} /> New Project
                            </button>
                        )}
                    />
                </div>
            )}

            {!loading && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.5rem' }}>
                {projects.map(project => (
                    <div key={project.id} className="glass card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ background: 'var(--primary)', padding: '0.75rem', borderRadius: '10px' }}>
                                <Globe size={24} color="white" />
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button
                                    className="btn"
                                    style={{ background: 'transparent', padding: '0.5rem', color: '#fff' }}
                                    title="Edit project"
                                    onClick={() => openEdit(project)}
                                >
                                    <Edit3 size={16} />
                                </button>
                                <button className="btn" style={{ background: 'transparent', padding: '0.5rem', color: 'var(--error)' }} onClick={() => handleDeleteClick(project)}>
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>
                        <div>
                            <h3 style={{ marginBottom: '0.25rem' }}>{project.name}</h3>
                            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>{project.description}</p>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.875rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)' }}>
                                <Globe size={14} /> {project.websiteUrl}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)' }}>
                                <Link2 size={14} /> {project.apiBaseUrl}
                            </div>
                        </div>
                        <button
                            className="btn btn-primary"
                            style={{ marginTop: '1rem', width: '100%', justifyContent: 'center' }}
                            onClick={() => navigate(`/projects/${project.id}/tests`)}
                        >
                            View Tests <ChevronRight size={16} />
                        </button>
                    </div>
                ))}
            </div>
            )}

            {showModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <form onSubmit={handleSubmit} className="glass" style={{ width: '500px', padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                        <h3>{editing ? 'Edit Project' : 'Create New Project'}</h3>
                        <input placeholder="Project Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
                        <input placeholder="Website URL (e.g. https://google.com)" value={form.websiteUrl} onChange={e => setForm({ ...form, websiteUrl: e.target.value })} required />
                        <input placeholder="API Base URL (e.g. https://api.example.com)" value={form.apiBaseUrl} onChange={e => setForm({ ...form, apiBaseUrl: e.target.value })} required />
                        <textarea placeholder="Description" rows="3" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
                        <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                            <button type="button" className="btn" style={{ flex: 1, background: 'rgba(255,255,255,0.1)' }} onClick={closeModal} disabled={saving}>Cancel</button>
                            <button type="submit" className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} disabled={saving}>
                                {saving && <ButtonSpinner />}
                                {saving ? (editing ? 'Saving…' : 'Creating…') : (editing ? 'Save Changes' : 'Create Project')}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
};

export default Projects;
