import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

const SelectControl = ({
    value,
    onChange,
    options = [],
    placeholder = 'Select',
    disabled = false,
    width = '100%',
    name,
    ariaLabel,
}) => {
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);
    const listId = useId();
    const selected = options.find((option) => String(option.value) === String(value));

    useEffect(() => {
        const closeOnOutsideClick = (event) => {
            if (!rootRef.current?.contains(event.target)) setOpen(false);
        };
        document.addEventListener('mousedown', closeOnOutsideClick);
        return () => document.removeEventListener('mousedown', closeOnOutsideClick);
    }, []);

    const choose = (option) => {
        onChange?.(option.value);
        setOpen(false);
    };

    const handleKeyDown = (event) => {
        if (disabled) return;
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen((current) => !current);
        } else if (event.key === 'Escape') {
            setOpen(false);
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const currentIndex = Math.max(0, options.findIndex((option) => String(option.value) === String(value)));
            const delta = event.key === 'ArrowDown' ? 1 : -1;
            const nextIndex = Math.min(options.length - 1, Math.max(0, currentIndex + delta));
            if (options[nextIndex]) choose(options[nextIndex]);
        }
    };

    return (
        <div className="select-control" ref={rootRef} style={{ width }}>
            {name && <input type="hidden" name={name} value={value ?? ''} />}
            <button
                type="button"
                className={`select-trigger ${open ? 'select-trigger-open' : ''}`}
                aria-label={ariaLabel || placeholder}
                aria-expanded={open}
                aria-controls={listId}
                disabled={disabled}
                onClick={() => setOpen((current) => !current)}
                onKeyDown={handleKeyDown}
            >
                <span className={selected ? 'select-value' : 'select-placeholder'}>
                    {selected?.label || placeholder}
                </span>
                <ChevronDown size={18} className={`select-chevron ${open ? 'select-chevron-open' : ''}`} />
            </button>

            {open && (
                <div id={listId} className="select-options" role="listbox">
                    {options.map((option) => {
                        const active = String(option.value) === String(value);
                        return (
                            <button
                                type="button"
                                role="option"
                                aria-selected={active}
                                key={option.value}
                                className={`select-option ${active ? 'select-option-active' : ''}`}
                                onClick={() => choose(option)}
                            >
                                <span className="select-radio">
                                    {active && <span className="select-radio-dot" />}
                                </span>
                                <span className="select-option-label">{option.label}</span>
                                {active && <Check size={16} className="select-option-check" />}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default SelectControl;
