'use client';

import React, { useState } from 'react';
import { EyeIcon, EyeOffIcon } from './AuthIcons';

interface PasswordInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  required?: boolean;
}

/** 40px password input with an accessible show/hide toggle. */
export default function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  placeholder,
  disabled,
  invalid,
  describedBy,
  required,
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="au-input-wrap">
      <input
        id={id}
        name={id}
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rd-input au-input"
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        required={required}
        spellCheck={false}
        autoCapitalize="none"
      />
      <button
        type="button"
        className="au-reveal"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        aria-controls={id}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}
