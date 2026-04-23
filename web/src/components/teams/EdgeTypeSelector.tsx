import { type TeamEdgeType, EDGE_TYPES, getEdgeStyle, getEdgeLabel, getEdgeBadgeColors } from './graphHelpers';

export default function EdgeTypeSelector({
  position,
  onSelect,
  onCancel,
}: {
  position: { x: number; y: number };
  onSelect: (type: TeamEdgeType) => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50"
      onClick={onCancel}
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
      role="button"
      tabIndex={-1}
      aria-label="Cancel edge type selection"
    >
      <div
        className="absolute surface-panel p-2 rounded-xl shadow-2xl animate-fade-in"
        style={{ left: position.x, top: position.y, minWidth: 180 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-xs font-semibold uppercase tracking-wider mb-2 px-2 pt-1" style={{ color: 'var(--pc-text-muted)' }}>
          Relationship Type
        </div>
        {EDGE_TYPES.map((type) => {
          const style = getEdgeStyle(type);
          const badge = getEdgeBadgeColors(type);
          return (
            <button
              key={type}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-[var(--pc-hover)]"
              style={{ color: badge.text }}
              onClick={() => onSelect(type)}
            >
              <span
                className="w-3 h-0.5 rounded-full"
                style={{
                  background: style.stroke,
                  ...(style.strokeDasharray ? { borderTop: `2px dashed ${style.stroke}`, background: 'transparent', height: 0 } : {}),
                }}
              />
              {getEdgeLabel(type)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
