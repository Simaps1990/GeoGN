import type { ReactNode } from 'react';

type PageHeadingProps = {
  title: string;
  subtitle?: string;
  action?: ReactNode;
};

export function PageHeading({ title, subtitle, action }: PageHeadingProps) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p> : null}
      </div>
      {action ? <div className="flex-shrink-0">{action}</div> : null}
    </div>
  );
}
