import React from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';

export const Logo = ({ suffix }) => (
  <div className="flex items-center gap-2.5">
    <div className="size-8 rounded-[10px] bg-brand grid place-items-center shadow-[var(--shadow-pop)]">
      <svg viewBox="0 0 32 32" className="size-5" aria-hidden="true">
        <path d="M10 6h7.5a4.5 4.5 0 0 1 1.7 8.66A4.75 4.75 0 0 1 17.75 24H10z" fill="white" />
      </svg>
    </div>
    <span className="text-[17px] font-semibold tracking-tight text-ink">Bookly</span>
    {suffix && <span className="pill bg-muted text-ink-2 border border-line">{suffix}</span>}
  </div>
);

const initialsOf = (name = '') => name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || '?';

// Stable hue per name so each person keeps the same avatar colour.
const hueOf = (name = '') => [...name].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 360, 7);

export const Avatar = ({ name, src, size = 'size-10', className = '' }) => {
  if (src) {
    return <img src={src} alt="" referrerPolicy="no-referrer" className={`${size} rounded-full object-cover ${className}`} />;
  }
  const hue = hueOf(name);
  return (
    <div
      aria-hidden="true"
      className={`${size} rounded-full grid place-items-center font-semibold text-white shrink-0 ${className}`}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 75% 62%), hsl(${(hue + 40) % 360} 70% 50%))` }}
    >
      <span className="text-[0.8em]">{initialsOf(name)}</span>
    </div>
  );
};

const BANNER_TONES = {
  error: { box: 'bg-danger-soft text-danger', Icon: AlertCircle },
  success: { box: 'bg-success-soft text-success', Icon: CheckCircle2 },
  warn: { box: 'bg-warn-soft text-warn', Icon: AlertCircle }
};

export const Banner = ({ tone = 'error', children, onDismiss, className = '' }) => {
  const { box, Icon } = BANNER_TONES[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-3 rounded-2xl px-4 py-3 text-sm font-medium animate-rise ${box} ${className}`}>
      <Icon size={18} className="mt-0.5 shrink-0" />
      <div className="flex-1">{children}</div>
      {onDismiss && (
        <button onClick={onDismiss} aria-label="Dismiss" className="opacity-70 hover:opacity-100">
          <X size={16} />
        </button>
      )}
    </div>
  );
};

export const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden="true">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.77.42 3.45 1.18 4.94l3.66-2.84z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.96 10.96 0 0 0 12 1 11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
  </svg>
);
