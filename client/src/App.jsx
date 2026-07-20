import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, NavLink, Link, useNavigate } from 'react-router-dom';
import { LayoutDashboard, FolderKanban, LogOut, Activity, CheckCircle2, Users as UsersIcon, UserPlus } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

import Projects from './pages/Projects';
import Tests from './pages/Tests';
import TestBuilder from './pages/TestBuilder';
import Users from './pages/Users';
import config from './config';
import { apiFetch } from './api';
import { useToast } from './components/ToastProvider';
import { ButtonSpinner, DashboardSkeleton } from './components/Loading';

const Sidebar = ({ user, logout }) => (
  <aside className="glass" style={{ width: '260px', height: '100vh', padding: '2rem', display: 'flex', flexDirection: 'column', gap: '2rem', position: 'fixed', zIndex: 20 }}>
    <div style={{ fontSize: '1.5rem', fontWeight: '800', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <Activity size={32} /> NoCodeTest
    </div>

    <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
      <NavLink
        to="/"
        end
        className={({ isActive }) => `btn ${isActive ? 'nav-link-active' : ''}`}
        style={{ justifyContent: 'flex-start', background: 'transparent', color: 'var(--text-main)' }}
      >
        <LayoutDashboard size={20} /> Dashboard
      </NavLink>
      <NavLink
        to="/projects"
        className={({ isActive }) => `btn ${isActive ? 'nav-link-active' : ''}`}
        style={{ justifyContent: 'flex-start', background: 'transparent', color: 'var(--text-main)' }}
      >
        <FolderKanban size={20} /> Projects
      </NavLink>
      <NavLink
        to="/users"
        className={({ isActive }) => `btn ${isActive ? 'nav-link-active' : ''}`}
        style={{ justifyContent: 'flex-start', background: 'transparent', color: 'var(--text-main)' }}
      >
        <UsersIcon size={20} /> Users
      </NavLink>
    </nav>

    <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontWeight: '600' }}>{user.username}</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{user.role}</div>
      </div>
      <button onClick={logout} className="btn" style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--error)', width: '100%' }}>
        <LogOut size={18} /> Logout
      </button>
    </div>
  </aside>
);

const LoginPage = ({ setAuth }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await apiFetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Invalid credentials');

      localStorage.setItem('user', JSON.stringify(data));
      setAuth(data);
      toast.success(`Welcome, ${data.username}`);
      navigate('/');
    } catch (err) {
      const msg = String(err?.message || '');
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        toast.error('Server is waking up — wait 30 seconds and try again.');
      } else {
        toast.error(err.message || 'Invalid credentials');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <form onSubmit={handleLogin} className="glass" style={{ width: '400px', padding: '3rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <div style={{ textAlign: 'center' }}>
          <Activity size={48} color="var(--primary)" style={{ marginBottom: '1rem' }} />
          <h2>Welcome Back</h2>
          <p style={{ color: 'var(--text-muted)' }}>Login to manage your tests</p>
        </div>
        <input type="text" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} required />
        <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required />
        <button type="submit" className="btn btn-primary" style={{ justifyContent: 'center' }} disabled={loading}>
          {loading && <ButtonSpinner />}
          {loading ? 'Signing in…' : 'Sign In'}
        </button>
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          New employee?{' '}
          <Link to="/signup" style={{ color: 'var(--primary)', fontWeight: 700 }}>
            Create an account
          </Link>
        </div>
      </form>
    </div>
  );
};

const SignupPage = () => {
  const [form, setForm] = useState({ username: '', password: '', confirmPassword: '' });
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSignup = async (event) => {
    event.preventDefault();
    if (form.password !== form.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const res = await apiFetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: form.username, password: form.password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Unable to create account');

      toast.success('Employee account created. You can sign in now.');
      navigate('/login');
    } catch (err) {
      toast.error(err.message || 'Unable to create account');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <form onSubmit={handleSignup} className="glass" style={{ width: '430px', padding: '3rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div style={{ textAlign: 'center' }}>
          <UserPlus size={48} color="var(--primary)" style={{ marginBottom: '1rem' }} />
          <h2>Employee Sign Up</h2>
          <p style={{ color: 'var(--text-muted)' }}>Create an employee account</p>
        </div>
        <input
          type="text"
          placeholder="Username"
          autoComplete="username"
          value={form.username}
          onChange={(event) => setForm({ ...form, username: event.target.value })}
          minLength={3}
          required
        />
        <input
          type="password"
          placeholder="Password"
          autoComplete="new-password"
          value={form.password}
          onChange={(event) => setForm({ ...form, password: event.target.value })}
          minLength={6}
          required
        />
        <input
          type="password"
          placeholder="Confirm password"
          autoComplete="new-password"
          value={form.confirmPassword}
          onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })}
          minLength={6}
          required
        />
        <div className="glass" style={{ padding: '0.75rem 1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          Account role: <strong style={{ color: 'var(--text-main)' }}>Employee</strong>
        </div>
        <button type="submit" className="btn btn-primary" style={{ justifyContent: 'center' }} disabled={loading}>
          {loading && <ButtonSpinner />}
          {loading ? 'Creating account…' : 'Create Employee Account'}
        </button>
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          Already registered?{' '}
          <Link to="/login" style={{ color: 'var(--primary)', fontWeight: 700 }}>
            Sign in
          </Link>
        </div>
      </form>
    </div>
  );
};

const Dashboard = () => {
  const [stats, setStats] = useState({
    totalProjects: 0,
    totalTests: 0,
    passedTests: 0,
    failedTests: 0,
    apiSuccessRate: 0,
    lastRun: 'Never'
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let user = null;
    try { user = JSON.parse(localStorage.getItem('user')); } catch { /* ignore */ }
    const query = user?.id != null
      ? `?userId=${encodeURIComponent(user.id)}&role=${encodeURIComponent(user.role || '')}`
      : '';
    fetch(`${config.API_BASE_URL}/api/stats${query}`)
      .then(res => res.json())
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const chartData = [
    { name: 'Mon', tests: 40 },
    { name: 'Tue', tests: 30 },
    { name: 'Wed', tests: 65 },
    { name: 'Thu', tests: 50 },
    { name: 'Fri', tests: 80 },
    { name: 'Sat', tests: 45 },
    { name: 'Sun', tests: 90 },
  ];

  if (loading) {
    return <DashboardSkeleton />;
  }

  return (
    <div style={{ padding: '2rem' }}>
      <div className="dashboard-grid">
        <div className="glass card">
          <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Total Projects</div>
          <div style={{ fontSize: '2rem', fontWeight: '800' }}>{stats.totalProjects}</div>
        </div>
        <div className="glass card">
          <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Success Rate</div>
          <div style={{ fontSize: '2rem', fontWeight: '800', color: 'var(--success)' }}>{stats.apiSuccessRate}%</div>
        </div>
        <div className="glass card">
          <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Tests Passed</div>
          <div style={{ fontSize: '2rem', fontWeight: '800', color: 'var(--success)' }}>{stats.passedTests}</div>
        </div>
        <div className="glass card">
          <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Tests Failed</div>
          <div style={{ fontSize: '2rem', fontWeight: '800', color: 'var(--error)' }}>{stats.failedTests}</div>
        </div>
      </div>

      <div className="glass card" style={{ marginTop: '2rem', height: '300px' }}>
        <h3 style={{ marginBottom: '1.5rem' }}>Execution Trends</h3>
        <ResponsiveContainer width="100%" height="80%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="colorTests" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="name" stroke="var(--text-muted)" />
            <YAxis stroke="var(--text-muted)" />
            <Tooltip />
            <Area type="monotone" dataKey="tests" stroke="var(--primary)" fillOpacity={1} fill="url(#colorTests)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="glass card" style={{ marginTop: '2rem' }}>
        <h3>Recent Activity</h3>
        <div style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem 0', borderBottom: '1px solid var(--border)' }}>
            <div className="badge badge-success"><CheckCircle2 size={14} /></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: '600' }}>Last run</div>
              <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                {stats.lastRun === 'Never' ? 'No runs yet' : String(stats.lastRun)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const App = () => {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('user'));
    } catch {
      return null;
    }
  });
  const { confirm } = useToast();

  const logout = async () => {
    const ok = await confirm({
      title: 'Log out?',
      message: 'You will need to sign in again to continue.',
      confirmText: 'Log out',
      cancelText: 'Cancel',
      danger: true,
    });
    if (!ok) return;
    localStorage.removeItem('user');
    setUser(null);
  };

  if (!user) {
    return (
      <Router>
        <Routes>
          <Route path="/login" element={<LoginPage setAuth={setUser} />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="*" element={<Navigate to="/login" />} />
        </Routes>
      </Router>
    );
  }

  return (
    <Router>
      <div style={{ display: 'flex' }}>
        <Sidebar user={user} logout={logout} />
        <main style={{ flex: 1, marginLeft: '260px', minHeight: '100vh' }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:projectId/tests" element={<Tests />} />
            <Route path="/tests/:testId/builder" element={<TestBuilder />} />
            <Route path="/users" element={<Users currentUser={user} />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
};

export default App;
