import React from 'react';

// Small circular spinner for inside buttons
export const ButtonSpinner = ({ size = 16 }) => (
    <span
        className="btn-spinner"
        style={{ width: size, height: size }}
        aria-hidden="true"
    />
);

// Basic shimmer block
export const Skeleton = ({ width = '100%', height = 16, radius = 8, style = {} }) => (
    <span
        className="skeleton"
        style={{ width, height, borderRadius: radius, display: 'block', ...style }}
    />
);

// Skeleton for a table (header row + N shimmer rows)
export const TableSkeleton = ({ rows = 5, columns = 4 }) => (
    <>
        {Array.from({ length: rows }).map((_, r) => (
            <tr key={r} style={{ borderBottom: '1px solid var(--border)' }}>
                {Array.from({ length: columns }).map((__, c) => (
                    <td key={c} style={{ padding: '1rem' }}>
                        <Skeleton height={14} width={c === 0 ? '70%' : '55%'} />
                    </td>
                ))}
            </tr>
        ))}
    </>
);

// Skeleton for a grid of cards (Projects page)
export const CardGridSkeleton = ({ cards = 6 }) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.5rem' }}>
        {Array.from({ length: cards }).map((_, i) => (
            <div key={i} className="glass card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <Skeleton width={48} height={48} radius={10} />
                <Skeleton width="60%" height={20} />
                <Skeleton width="90%" height={12} />
                <Skeleton width="75%" height={12} />
                <Skeleton height={42} radius={8} style={{ marginTop: '0.5rem' }} />
            </div>
        ))}
    </div>
);

// Skeleton for the dashboard layout (stat cards + chart + activity)
export const DashboardSkeleton = () => (
    <div style={{ padding: '2rem' }}>
        <div className="dashboard-grid">
            {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="glass card">
                    <Skeleton width="55%" height={12} />
                    <Skeleton width="40%" height={30} style={{ marginTop: '0.75rem' }} />
                </div>
            ))}
        </div>
        <div className="glass card" style={{ marginTop: '2rem', height: '300px' }}>
            <Skeleton width="30%" height={20} />
            <Skeleton height={200} radius={12} style={{ marginTop: '1.5rem' }} />
        </div>
        <div className="glass card" style={{ marginTop: '2rem' }}>
            <Skeleton width="25%" height={20} />
            <Skeleton height={54} radius={10} style={{ marginTop: '1rem' }} />
        </div>
    </div>
);

// Skeleton for the test builder layout (header + left controls + step list)
export const BuilderSkeleton = () => (
    <div className="builder-page">
        <div className="builder-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem' }}>
                <Skeleton width={38} height={38} radius="50%" />
                <Skeleton width={200} height={26} />
            </div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
                <Skeleton width={110} height={40} radius={8} />
                <Skeleton width={95} height={40} radius={8} />
                <Skeleton width={120} height={40} radius={8} />
            </div>
        </div>
        <div className="builder-body">
            <div className="builder-side">
                <Skeleton width="60%" height={18} />
                {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} height={38} radius={8} style={{ marginTop: '0.6rem' }} />
                ))}
            </div>
            <div className="builder-main">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="step-card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                        <Skeleton width="35%" height={16} />
                        <Skeleton height={44} radius={8} style={{ marginTop: '0.9rem' }} />
                    </div>
                ))}
            </div>
        </div>
    </div>
);
