import type { LucideIcon } from 'lucide-react';

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
};

export function EmptyState({ icon: Icon, title, subtitle }: EmptyStateProps) {
  return (
    <div className="rounded-2xl border bg-white px-4 py-10 shadow-sm">
      <div className="flex flex-col items-center gap-2 text-center">
        <Icon size={32} className="text-gray-300" />
        <p className="text-sm font-medium text-gray-500">{title}</p>
        {subtitle ? <p className="text-xs text-gray-400">{subtitle}</p> : null}
      </div>
    </div>
  );
}
