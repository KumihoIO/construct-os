import type { TeamDefinition } from '@/types/api';

export default function DeleteConfirm({
  team,
  onClose,
  onConfirm,
  deleting,
}: {
  team: TeamDefinition;
  onClose: () => void;
  onConfirm: () => void;
  deleting: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Confirm Delete"
    >
      <div className="surface-panel w-full max-w-sm p-6 animate-fade-in-scale" style={{ margin: '1rem' }}>
        <h3 className="text-base font-semibold mb-2" style={{ color: 'var(--pc-text-primary)' }}>
          Delete Team
        </h3>
        <p className="text-sm mb-6" style={{ color: 'var(--pc-text-muted)' }}>
          Are you sure you want to delete <strong style={{ color: 'var(--pc-text-primary)' }}>{team.name}</strong>? This action cannot be undone.
        </p>
        <div className="flex items-center justify-end gap-3">
          <button className="btn-secondary px-4 py-2 text-sm" onClick={onClose}>Cancel</button>
          <button className="btn-danger px-4 py-2 text-sm font-semibold" onClick={onConfirm} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
