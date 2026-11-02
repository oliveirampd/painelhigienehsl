import type { ReactNode } from "react";
export const createFileRoute = () => (options: { component: () => ReactNode }) => options;
export function Link({
  to,
  children,
  className,
}: {
  to: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a href={to} className={className}>
      {children}
    </a>
  );
}
