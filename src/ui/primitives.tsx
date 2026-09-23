/** Small presentational building blocks shared by the cards. */

import type { ReactNode } from 'react';

export function Card({ title, label, actions, children, className, ariaLabel }: {
  title?: ReactNode;
  label?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <section className={`card ${className ?? ''}`} aria-label={ariaLabel}>
      {(title || label || actions) && (
        <div className="card-head">
          <div>
            {label && <div className="label">{label}</div>}
            {title && <h2 className="card-title">{title}</h2>}
          </div>
          {actions && <div className="toolbar">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Segmented<T extends string>({ value, options, onChange, ariaLabel }: {
  value: T;
  options: Array<{ id: T; label: ReactNode; title?: string; disabled?: boolean }>;
  onChange: (id: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="seg" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={o.id === value}
          title={o.title}
          disabled={o.disabled}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export type Tone = 'ok' | 'warn' | 'bad' | 'info';

export function Badge({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return <span className={`badge ${tone}`} title={title}>{children}</span>;
}

export function Field({ label, unit, children }: { label: ReactNode; unit?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
      {unit && <span className="unit">{unit}</span>}
    </label>
  );
}

/** Numeric input that keeps the user's text while editing. */
export function NumberInput({ value, onChange, invalid, step, min, max, placeholder, ariaLabel }: {
  value: number | null;
  onChange: (v: number | null) => void;
  invalid?: boolean;
  step?: number | string;
  min?: number;
  max?: number;
  placeholder?: string;
  ariaLabel?: string;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step={step ?? 'any'}
      min={min}
      max={max}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      value={value ?? ''}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw.trim() === '') { onChange(null); return; }
        const v = Number(raw);
        onChange(Number.isFinite(v) ? v : null);
      }}
    />
  );
}

export function Status({ state, children }: { state: 'idle' | 'running' | 'done' | 'error'; children: ReactNode }) {
  return (
    <div className={`status ${state}`} role="status" aria-live="polite">
      <span className="dot" aria-hidden="true" />
      {children}
    </div>
  );
}

export function LegendItem({ color, dashed, label, onClick, active, selected }: {
  color: string;
  dashed?: boolean;
  label: ReactNode;
  onClick?: () => void;
  active?: boolean;
  selected?: boolean;
}) {
  const cls = `${active === false ? 'off' : ''} ${selected ? 'sel' : ''}`;
  const content = (
    <>
      <span className={`sw ${dashed ? 'dash' : ''}`} style={{ ['--c' as string]: color }} />
      {label}
    </>
  );
  return onClick
    ? <button type="button" className={cls} onClick={onClick} aria-pressed={selected}>{content}</button>
    : <span className={`item ${cls}`}>{content}</span>;
}
