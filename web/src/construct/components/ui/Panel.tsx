import type { ReactNode } from 'react';

export default function Panel({
  children,
  className = '',
  variant = 'primary',
}: {
  children: ReactNode;
  className?: string;
  variant?: 'primary' | 'secondary' | 'utility';
}) {
  return (
    <section className={`construct-panel ${className}`.trim()} data-variant={variant}>
      {children}
    </section>
  );
}
