import { AlertTriangle, CheckCircle2, PauseCircle, PlayCircle, XCircle } from 'lucide-react';

export default function StatusPill({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const config = (() => {
    switch (normalized) {
      case 'running':
        return { icon: PlayCircle, color: 'var(--construct-signal-live)', bg: 'var(--construct-signal-live-soft)' };
      case 'completed':
      case 'success':
        return {
          icon: CheckCircle2,
          color: 'var(--construct-status-success)',
          bg: 'color-mix(in srgb, var(--construct-status-success) 12%, transparent)',
        };
      case 'failed':
        return {
          icon: XCircle,
          color: 'var(--construct-status-danger)',
          bg: 'color-mix(in srgb, var(--construct-status-danger) 12%, transparent)',
        };
      case 'paused':
      case 'blocked':
        return {
          icon: PauseCircle,
          color: 'var(--construct-status-warning)',
          bg: 'color-mix(in srgb, var(--construct-status-warning) 12%, transparent)',
        };
      default:
        return {
          icon: AlertTriangle,
          color: 'var(--construct-text-muted)',
          bg: 'color-mix(in srgb, var(--construct-text-muted) 10%, transparent)',
        };
    }
  })();

  const Icon = config.icon;

  return (
    <span
      className="construct-status-pill"
      style={{ color: config.color, background: config.bg, borderColor: 'transparent' }}
    >
      <Icon className="h-3.5 w-3.5" />
      {status}
    </span>
  );
}
