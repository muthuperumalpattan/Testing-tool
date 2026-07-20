import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PlayCircle, Play, Terminal, Layout, Clock, CheckCircle2, XCircle, Search, Filter } from 'lucide-react';
import { apiFetch, apiUrl } from '../api';

const TestRunner = () => {
    const [projects, setProjects] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [runningTestId, setRunningTestId] = useState(null);
    const [testStats, setTestStats] = useState({});
    const navigate = useNavigate();

    useEffect(() => {
        // Fetch all projects and their tests
        fetch(apiUrl('/api/projects'))
            .then(res => res.json())
            .then(async (fetchedProjects) => {
                const projectsWithTests = await Promise.all(fetchedProjects.map(async (p) => {
                    const testsRes2 = await fetch(apiUrl(`/api/projects/${p.id}/tests`));
                    const tests = await testsRes2.json();
                    return { ...p, tests };
                }));
                setProjects(projectsWithTests);
            });
    }, []);

    const handleRunTest = async (testId) => {
        setRunningTestId(testId);
        try {
            const res = await apiFetch(`/api/tests/${testId}/run`, { method: 'POST' });
            const result = await res.json();
            setTestStats(prev => ({ ...prev, [testId]: result.status }));
        } catch (err) {
            console.error(err);
        }
        setRunningTestId(null);
    };

    const filteredProjects = projects.map(p => ({
        ...p,
        tests: p.tests.filter(t => t.name.toLowerCase().includes(searchTerm.toLowerCase()))
    })).filter(p => p.tests.length > 0);

    return (
        <div style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div>
                    <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <PlayCircle size={24} color="var(--primary)" /> Test Runner
                    </h2>
                    <p style={{ color: 'var(--text-muted)' }}>Quickly execute tests across all your projects</p>
                </div>
                <div style={{ position: 'relative', width: '300px' }}>
                    <Search size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input 
                        placeholder="Search tests..." 
                        style={{ paddingLeft: '3rem', width: '100%' }}
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
                {filteredProjects.length === 0 ? (
                    <div className="glass" style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        <Search size={48} style={{ marginBottom: '1rem', opacity: 0.2 }} />
                        <p>No tests found matching your search.</p>
                    </div>
                ) : filteredProjects.map(project => (
                    <div key={project.id}>
                        <h3 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{ width: '8px', height: '24px', background: 'var(--primary)', borderRadius: '4px' }}></div>
                            {project.name}
                        </h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '1rem' }}>
                            {project.tests.map(test => (
                                <div key={test.id} className="glass card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                        <div style={{ 
                                            width: '40px', 
                                            height: '40px', 
                                            borderRadius: '12px', 
                                            background: test.type === 'API' ? 'rgba(99, 102, 241, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center'
                                        }}>
                                            {test.type === 'API' ? <Terminal size={20} color="var(--primary)" /> : <Layout size={20} color="#10b981" />}
                                        </div>
                                        <div>
                                            <div style={{ fontWeight: '600' }}>{test.name}</div>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                                {test.status === 'Published' ? (
                                                    <span style={{ color: 'var(--success)' }}>● Published</span>
                                                ) : (
                                                    <span>○ Draft</span>
                                                )}
                                                <span>•</span>
                                                <span>Last Status: </span>
                                                <span style={{ 
                                                    color: (testStats[test.id] || test.lastStatus) === 'Passed' ? 'var(--success)' : 
                                                           (testStats[test.id] || test.lastStatus) === 'Failed' ? 'var(--error)' : 'var(--text-muted)'
                                                }}>
                                                    {testStats[test.id] || test.lastStatus || 'Never Run'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <button 
                                            className="btn btn-primary" 
                                            style={{ padding: '0.5rem 1rem' }}
                                            onClick={() => handleRunTest(test.id)}
                                            disabled={runningTestId === test.id}
                                        >
                                            {runningTestId === test.id ? <Clock size={16} className="spin" /> : <Play size={16} />}
                                            {runningTestId === test.id ? 'Running' : 'Run'}
                                        </button>
                                        <button 
                                            className="btn" 
                                            style={{ background: 'transparent', padding: '0.5rem' }}
                                            onClick={() => navigate(`/tests/${test.id}/builder`)}
                                        >
                                            Details
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default TestRunner;
