/** Animated shimmer progress bar shown while agent is working. */
export default function WorkingBar() {
  return (
    <div
      className="h-0.5 w-full overflow-hidden rounded-full"
      style={{ background: 'var(--pc-border)' }}
    >
      <div
        className="h-full rounded-full"
        style={{
          background: 'linear-gradient(90deg, var(--pc-accent) 0%, var(--pc-accent-light) 50%, var(--pc-accent) 100%)',
          backgroundSize: '200% 100%',
          animation: 'shimmer 1.5s linear infinite',
          width: '100%',
        }}
      />
    </div>
  );
}
