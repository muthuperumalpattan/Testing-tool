import { useNavigate } from 'react-router-dom';
import { History as HistoryIcon, Clock, CheckCircle2, XCircle, ArrowLeft, ExternalLink, Filter } from 'lucide-react';
import { apiUrl } from '../api';

const History = () => {
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        fetch(apiUrl('/api/results'))
            .then(res => res.json())
            .then(data => {
                setResults(data);
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setLoading(false);
            });
    }, []);

    const formatDate = (dateString) => {
        return new Date(dateString).toLocaleString();
    };

    return (
        <div style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div>
                    <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <HistoryIcon size={24} color="var(--primary)" /> Execution History
                    </h2>
                    <p style={{ color: 'var(--text-muted)' }}>Global audit log of all test executions</p>
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <button className="btn" style={{ background: 'rgba(255,255,255,0.05)' }}><Filter size={18} /> Filters</button>
                    <button className="btn btn-primary" onClick={() => window.location.reload()}>Refresh</button>
                </div>
            </div>

            {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
                    <div className="spin" style={{ width: '40px', height: '40px', border: '4px solid var(--primary)', borderTopColor: 'transparent', borderRadius: '50%' }}></div>
                </div>
            ) : results.length === 0 ? (
                <div className="glass" style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <HistoryIcon size={48} style={{ marginBottom: '1rem', opacity: 0.2 }} />
                    <p>No execution history found. Run some tests to see results here.</p>
                </div>
            ) : (
                <div className="glass" style={{ overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.05)' }}>
                                <th style={{ padding: '1rem' }}>Project / Test Case</th>
                                <th style={{ padding: '1rem' }}>Status</th>
                                <th style={{ padding: '1rem' }}>Duration</th>
                                <th style={{ padding: '1rem' }}>Executed At</th>
                                <th style={{ padding: '1rem' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {results.map((result) => (
                                <tr key={result.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                    <td style={{ padding: '1rem' }}>
                                        <div style={{ fontWeight: '600' }}>{result.projectName}</div>
                                        <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>{result.testName}</div>
                                    </td>
                                    <td style={{ padding: '1rem' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            {result.status === 'Passed' ? (
                                                <CheckCircle2 size={16} color="var(--success)" />
                                            ) : (
                                                <XCircle size={16} color="var(--error)" />
                                            )}
                                            <span className={`badge ${result.status === 'Passed' ? 'badge-success' : 'badge-error'}`}>
                                                {result.status}
                                            </span>
                                        </div>
                                    </td>
                                    <td style={{ padding: '1rem' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
                                            <Clock size={14} /> {result.executionTime}ms
                                        </div>
                                    </td>
                                    <td style={{ padding: '1rem', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                                        {formatDate(result.createdAt)}
                                    </td>
                                    <td style={{ padding: '1rem' }}>
                                        <button 
                                            className="btn" 
                                            style={{ background: 'transparent', padding: '0.5rem' }}
                                            onClick={() => navigate(`/tests/${result.testCaseId}/builder`)}
                                        >
                                            <ExternalLink size={16} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default History;
