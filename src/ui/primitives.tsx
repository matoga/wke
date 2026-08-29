/** Small shared UI building blocks. */

import React from 'react';
import { clsx } from 'clsx';

export function Card({
  title, subtitle, actions, children, className, onActivate,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  onActivate?: () => void;
}) {
  return (
    <section
      className={clsx(
        'card',
        onActivate && 'cursor-pointer transition-[border-color,box-shadow] hover:border-blue-300/70 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
        className,
      )}
      onClick={onActivate}
      onKeyDown={onActivate ? (event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onActivate();
        }
      } : undefined}
      role={onActivate ? 'button' : undefined}
      tabIndex={onActivate ? 0 : undefined}
    >
      {(title || actions) && (
        <header className="card-header">
          <div className="min-w-0">
            {title && <h2 className="card-title">{title}</h2>}
            {subtitle && <p className="card-subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Field({
  label, unit, hint, children, disabled,
}: {
  label: React.ReactNode;
  unit?: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={clsx('block', disabled && 'opacity-50')}>
      <span className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-2xs font-medium text-slate-600 dark:text-slate-300">{label}</span>
        {unit && <span className="text-2xs text-slate-500 dark:text-slate-400 font-mono">{unit}</span>}
      </span>
      {children}
      {hint && <span className="block mt-1 text-2xs text-slate-500 dark:text-slate-400">{hint}</span>}
    </label>
  );
}

/** Label / value row, monospaced and right-aligned for scanning columns. */
export function Metric({
  label, value, unit, emphasis, title,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  unit?: React.ReactNode;
  emphasis?: boolean;
  title?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]" title={title}>
      <span className="text-2xs text-slate-500 dark:text-slate-400 shrink-0">{label}</span>
      <span className="flex-1 border-b border-dotted border-slate-200 dark:border-slate-800 translate-y-[-3px]" />
      <span className={clsx(
        'font-mono tabular-nums shrink-0',
        emphasis
          ? 'text-sm font-semibold text-slate-900 dark:text-slate-50'
          : 'text-xs text-slate-700 dark:text-slate-200',
      )}>
        {value}
        {unit && <span className="ml-1 text-2xs text-slate-500 dark:text-slate-400">{unit}</span>}
      </span>
    </div>
  );
}

export function Badge({
  tone = 'info', children,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger' | 'neutral';
  children: React.ReactNode;
}) {
  const cls = {
    info: 'badge-info',
    success: 'badge-success',
    warning: 'badge-warning',
    danger: 'badge-danger',
    neutral: 'badge bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
  }[tone];
  return <span className={cls}>{children}</span>;
}

export function Callout({
  tone = 'warning', title, children,
}: {
  tone?: 'warning' | 'danger' | 'info';
  title?: React.ReactNode;
  children: React.ReactNode;
}) {
  const cls = {
    warning: 'border-orange-300/60 bg-orange-50 dark:border-orange-900/60 dark:bg-orange-950/30 text-orange-800 dark:text-orange-300',
    danger: 'border-red-300/60 bg-red-50 dark:border-red-900/60 dark:bg-red-950/30 text-red-800 dark:text-red-300',
    info: 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60 text-slate-600 dark:text-slate-300',
  }[tone];
  return (
    <div className={clsx('rounded-md border px-3 py-2 text-2xs leading-relaxed', cls)}>
      {title && <div className="font-semibold mb-0.5">{title}</div>}
      {children}
    </div>
  );
}

export function SegmentedControl<T extends string>({
  value, options, onChange, size = 'sm', className,
}: {
  value: T;
  options: Array<{ id: T; label: React.ReactNode; title?: string; disabled?: boolean }>;
  onChange: (v: T) => void;
  size?: 'sm' | 'xs';
  className?: string;
}) {
  return (
    <div className={clsx(
      'inline-flex p-0.5 rounded-md bg-slate-100 dark:bg-slate-800/80 gap-0.5',
      className,
    )} role="tablist">
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={value === o.id}
          title={o.title}
          disabled={o.disabled}
          onClick={() => onChange(o.id)}
          className={clsx(
            'rounded transition-colors font-medium whitespace-nowrap',
            size === 'xs' ? 'px-2 py-0.5 text-2xs' : 'px-2.5 py-1 text-xs',
            o.disabled && 'opacity-40 cursor-not-allowed',
            value === o.id
              ? 'bg-white dark:bg-gray-900 text-slate-900 dark:text-slate-100 shadow-sm'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function NumberInput({
  value, onChange, placeholder, step, disabled, min,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  step?: number;
  disabled?: boolean;
  min?: number;
}) {
  return (
    <input
      type="number"
      className="input font-mono tabular-nums"
      value={value}
      step={step}
      min={min}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Slider with a live monospace readout, log-spaced when `log` is set. */
export function Slider({
  label, unit, value, min, max, onChange, log, format, disabled,
}: {
  label: React.ReactNode;
  unit?: React.ReactNode;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  log?: boolean;
  format?: (v: number) => string;
  disabled?: boolean;
}) {
  const toSlider = (v: number) => log
    ? ((Math.log(v) - Math.log(min)) / (Math.log(max) - Math.log(min))) * 1000
    : ((v - min) / (max - min)) * 1000;
  const fromSlider = (s: number) => log
    ? Math.exp(Math.log(min) + (s / 1000) * (Math.log(max) - Math.log(min)))
    : min + (s / 1000) * (max - min);

  const clamped = Math.min(Math.max(value, min), max);

  return (
    <div className={clsx(disabled && 'opacity-50 pointer-events-none')}>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-2xs font-medium text-slate-600 dark:text-slate-300">{label}</span>
        <span className="font-mono tabular-nums text-2xs text-slate-700 dark:text-slate-200">
          {format ? format(value) : value.toPrecision(4)}
          {unit && <span className="ml-1 text-slate-500 dark:text-slate-400">{unit}</span>}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={1000}
        step={1}
        disabled={disabled}
        value={toSlider(clamped)}
        onChange={(e) => onChange(fromSlider(Number(e.target.value)))}
        className="w-full h-1 accent-accent-600 cursor-pointer"
      />
    </div>
  );
}
