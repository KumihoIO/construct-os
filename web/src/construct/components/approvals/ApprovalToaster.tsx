import { Link } from 'react-router-dom';
import { X, ShieldAlert } from 'lucide-react';
import { usePendingApprovals } from '@/contexts/PendingApprovalsContext';

export default function ApprovalToaster() {
  const { toasts, dismissToast } = usePendingApprovals();

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed top-4 right-4 z-50 flex w-[min(22rem,90vw)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.toastId}
          className="construct-panel pointer-events-auto flex gap-3 p-3 shadow-lg"
          style={{
            borderColor: 'var(--construct-signal-live)',
            background: 'var(--construct-surface-raised, var(--construct-surface))',
          }}
          role="alert"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--construct-signal-live)' }} />
          <div className="min-w-0 flex-1">
            <div className="construct-kicker text-[10px]">Approval needed</div>
            <div className="mt-0.5 truncate text-sm font-medium">
              {t.workflowName || t.title}
            </div>
            {t.message ? (
              <p className="mt-1 line-clamp-2 text-xs" style={{ color: 'var(--construct-text-secondary)' }}>
                {t.message}
              </p>
            ) : null}
            <div className="mt-2 flex items-center gap-2">
              <Link
                to={`/runs?run=${encodeURIComponent(t.runId)}`}
                className="construct-button px-2 py-1 text-xs"
                onClick={() => dismissToast(t.toastId)}
              >
                Review
              </Link>
              <button
                type="button"
                className="text-xs underline-offset-2 hover:underline"
                style={{ color: 'var(--construct-text-secondary)' }}
                onClick={() => dismissToast(t.toastId)}
              >
                Dismiss
              </button>
            </div>
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismissToast(t.toastId)}
            className="self-start text-[var(--construct-text-secondary)] hover:text-[var(--construct-text)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
