import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

let toastId = 0;

export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([]);
    const [confirmState, setConfirmState] = useState(null);

    const removeToast = useCallback((id) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    const pushToast = useCallback((type, message, duration = 3200) => {
        const id = ++toastId;
        setToasts((prev) => [...prev, { id, type, message }]);
        if (duration > 0) {
            setTimeout(() => removeToast(id), duration);
        }
        return id;
    }, [removeToast]);

    const toast = useMemo(() => ({
        success: (message, duration) => pushToast('success', message, duration),
        error: (message, duration) => pushToast('error', message, duration),
        info: (message, duration) => pushToast('info', message, duration),
    }), [pushToast]);

    const confirm = useCallback((options = {}) => {
        const {
            title = 'Confirm',
            message = 'Are you sure?',
            confirmText = 'Confirm',
            cancelText = 'Cancel',
            danger = false,
        } = options;

        return new Promise((resolve) => {
            setConfirmState({
                title,
                message,
                confirmText,
                cancelText,
                danger,
                resolve: (value) => {
                    setConfirmState(null);
                    resolve(value);
                },
            });
        });
    }, []);

    const value = useMemo(() => ({ toast, confirm }), [toast, confirm]);

    return (
        <ToastContext.Provider value={value}>
            {children}

            <div className="toast-viewport" aria-live="polite">
                {toasts.map((t) => (
                    <div key={t.id} className={`toast toast-${t.type}`}>
                        <span className="toast-icon">
                            {t.type === 'success' && <CheckCircle2 size={18} />}
                            {t.type === 'error' && <XCircle size={18} />}
                            {t.type === 'info' && <Info size={18} />}
                        </span>
                        <div className="toast-message">{t.message}</div>
                        <button type="button" className="toast-close" onClick={() => removeToast(t.id)} aria-label="Dismiss">
                            <X size={14} />
                        </button>
                    </div>
                ))}
            </div>

            {confirmState && (
                <div className="confirm-overlay">
                    <div className="confirm-dialog glass">
                        <h3>{confirmState.title}</h3>
                        <p>{confirmState.message}</p>
                        <div className="confirm-actions">
                            <button
                                type="button"
                                className="btn"
                                style={{ background: 'rgba(255,255,255,0.08)', color: '#fff' }}
                                onClick={() => confirmState.resolve(false)}
                            >
                                {confirmState.cancelText}
                            </button>
                            <button
                                type="button"
                                className={`btn ${confirmState.danger ? 'btn-danger' : 'btn-primary'}`}
                                onClick={() => confirmState.resolve(true)}
                            >
                                {confirmState.confirmText}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </ToastContext.Provider>
    );
}

export function useToast() {
    const ctx = useContext(ToastContext);
    if (!ctx) {
        throw new Error('useToast must be used within ToastProvider');
    }
    return ctx;
}
