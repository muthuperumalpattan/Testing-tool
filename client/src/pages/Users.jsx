import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Users as UsersIcon, Shield } from 'lucide-react';
import { apiFetch } from '../api';
import { useToast } from '../components/ToastProvider';
import { ButtonSpinner, TableSkeleton } from '../components/Loading';
import EmptyState from '../components/EmptyState';

const EMPTY_FORM = { username: '', password: '', role: 'Employee' };

const Users = ({ currentUser }) => {
    const { toast, confirm } = useToast();
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);

    const isAdmin = currentUser?.role === 'Admin';

    const loadUsers = async () => {
        setLoading(true);
        try {
            const res = await apiFetch('/api/users');
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to load users');
            setUsers(Array.isArray(data) ? data : []);
        } catch (err) {
            toast.error(err.message || 'Failed to load users');
            setUsers([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadUsers();
    }, []);

    const openCreate = () => {
        if (!isAdmin) {
            toast.error('Only Admin users can create accounts');
            return;
        }
        setEditing(null);
        setForm(EMPTY_FORM);
        setShowModal(true);
    };

    const openEdit = (user) => {
        if (!isAdmin) {
            toast.error('Only Admin users can edit accounts');
            return;
        }
        setEditing(user);
        setForm({ username: user.username, password: '', role: user.role || 'Employee' });
        setShowModal(true);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!isAdmin) return;

        if (!form.username.trim()) {
            toast.error('Username is required');
            return;
        }
        if (!editing && !form.password) {
            toast.error('Password is required for new users');
            return;
        }

        setSaving(true);
        try {
            const path = editing ? `/api/users/${editing.id}` : '/api/users';
            const method = editing ? 'PUT' : 'POST';
            const body = {
                username: form.username.trim(),
                role: editing ? form.role : 'Employee',
            };
            if (form.password) body.password = form.password;

            const res = await apiFetch(path, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Failed to save user');

            toast.success(editing ? 'User updated' : 'User created');
            setShowModal(false);
            setEditing(null);
            setForm(EMPTY_FORM);
            await loadUsers();
        } catch (err) {
            toast.error(err.message || 'Failed to save user');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (user) => {
        if (!isAdmin) {
            toast.error('Only Admin users can delete accounts');
            return;
        }
        const ok = await confirm({
            title: 'Delete user?',
            message: `Delete "${user.username}" permanently? This cannot be undone.`,
            confirmText: 'Delete',
            cancelText: 'Cancel',
            danger: true,
        });
        if (!ok) return;

        try {
            const res = await apiFetch(`/api/users/${user.id}`, { method: 'DELETE' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Failed to delete user');
            toast.success('User deleted');
            await loadUsers();
        } catch (err) {
            toast.error(err.message || 'Failed to delete user');
        }
    };

    return (
        <div style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div>
                    <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <UsersIcon size={24} color="var(--primary)" /> Users
                    </h2>
                    <p style={{ color: 'var(--text-muted)' }}>
                        Manage login accounts ({isAdmin ? 'Admin can create, edit, and delete' : 'View only'})
                    </p>
                </div>
                {isAdmin && (
                    <button className="btn btn-primary" onClick={openCreate}>
                        <Plus size={18} /> New User
                    </button>
                )}
            </div>

            <div className="glass" style={{ overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.05)' }}>
                            <th style={{ padding: '1rem' }}>ID</th>
                            <th style={{ padding: '1rem' }}>Username</th>
                            <th style={{ padding: '1rem' }}>Role</th>
                            <th style={{ padding: '1rem' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && <TableSkeleton rows={5} columns={4} />}
                        {!loading && users.length === 0 && (
                            <tr>
                                <td colSpan={4}>
                                    <EmptyState
                                        icon={<UsersIcon size={40} />}
                                        title="No users found"
                                        description="There are no login accounts yet. Create a new user to give someone access to the testing tool."
                                        action={isAdmin ? (
                                            <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={openCreate}>
                                                <Plus size={18} /> New User
                                            </button>
                                        ) : null}
                                    />
                                </td>
                            </tr>
                        )}
                        {!loading && users.map((user) => (
                            <tr key={user.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                <td style={{ padding: '1rem' }}>{user.id}</td>
                                <td style={{ padding: '1rem', fontWeight: 600 }}>{user.username}</td>
                                <td style={{ padding: '1rem' }}>
                                    <span className={`badge ${user.role === 'Admin' ? 'badge-primary' : 'badge-info'}`}>
                                        <Shield size={12} style={{ marginRight: 4 }} />
                                        {user.role}
                                    </span>
                                </td>
                                <td style={{ padding: '1rem' }}>
                                    {isAdmin ? (
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            <button className="btn" style={{ background: 'var(--primary)', padding: '0.5rem' }} onClick={() => openEdit(user)}>
                                                <Pencil size={16} color="white" />
                                            </button>
                                            <button className="btn" style={{ background: 'transparent', padding: '0.5rem', color: 'var(--error)' }} onClick={() => handleDelete(user)}>
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    ) : (
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>—</span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {showModal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <form onSubmit={handleSubmit} className="glass" style={{ width: '420px', padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                        <h3>{editing ? 'Edit User' : 'Create User'}</h3>
                        <input
                            placeholder="Username"
                            value={form.username}
                            onChange={(e) => setForm({ ...form, username: e.target.value })}
                            required
                        />
                        <input
                            type="password"
                            placeholder={editing ? 'New password (leave blank to keep)' : 'Password'}
                            value={form.password}
                            onChange={(e) => setForm({ ...form, password: e.target.value })}
                            required={!editing}
                        />
                        <div className="glass" style={{ padding: '0.8rem 1rem', color: 'var(--text-muted)' }}>
                            Role: <strong style={{ color: 'var(--text-main)' }}>{editing ? form.role : 'Employee'}</strong>
                            {!editing && <div style={{ fontSize: '0.75rem', marginTop: '0.2rem' }}>New users are always created as employees.</div>}
                        </div>
                        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                            <button type="button" className="btn" style={{ flex: 1, background: 'rgba(255,255,255,0.1)' }} onClick={() => setShowModal(false)} disabled={saving}>
                                Cancel
                            </button>
                            <button type="submit" className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} disabled={saving}>
                                {saving && <ButtonSpinner />}
                                {saving ? 'Saving…' : (editing ? 'Update' : 'Create')}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
};

export default Users;
