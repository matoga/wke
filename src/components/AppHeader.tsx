import { useEffect, useState } from 'react';
import { Segmented } from '../ui/primitives';
import { NORM_MODES } from '../ui/norm';
import type { NormMode } from '../ui/norm';
import { load, save } from '../state/storage';

type Theme = 'auto' | 'light' | 'dark';
const isTheme = (v: unknown): v is Theme => v === 'auto' || v === 'light' || v === 'dark';

export function AppHeader({ norm, onNorm }: { norm: NormMode; onNorm: (m: NormMode) => void }) {
  const [theme, setTheme] = useState<Theme>(() => load('theme', 'auto', isTheme));
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    save('theme', theme);
  }, [theme]);

  return (
    <header className="top">
      <div className="top-text">
        <h1>Bose Gas Kinetics</h1>
        <p className="lede">
          Solve the isotropic <b>wave kinetic equation</b> of a three-dimensional Bose gas from any momentum spectrum, and
          compare the bare equation with <b>loop-renormalised</b> kinetics: one loop, bubble chains and large N. Every
          number is computed in your browser.
        </p>
      </div>
      <div className="toolbar">
        <Segmented<NormMode> ariaLabel="Spectrum normalisation" value={norm} onChange={onNorm}
          options={NORM_MODES.map((m) => ({ id: m.id, label: m.label, title: m.title }))} />
        <Segmented<Theme> ariaLabel="Colour theme" value={theme} onChange={setTheme}
          options={[{ id: 'auto', label: 'Auto' }, { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }]} />
      </div>
    </header>
  );
}
