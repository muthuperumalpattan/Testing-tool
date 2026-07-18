import React from 'react';

// Centered empty-data placeholder: circled icon + title + muted description
const EmptyState = ({ icon, title, description, action }) => (
    <div className="empty-state">
        <div className="empty-state-icon">{icon}</div>
        <h3 className="empty-state-title">{title}</h3>
        {description && <p className="empty-state-desc">{description}</p>}
        {action}
    </div>
);

export default EmptyState;
