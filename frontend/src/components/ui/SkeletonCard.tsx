import { Skeleton } from './Skeleton';

type SkeletonCardProps = {
  count?: number;
};

function SingleSkeletonCard() {
  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <Skeleton className="h-9 w-20 flex-shrink-0" />
      </div>
    </div>
  );
}

export function SkeletonCard({ count = 1 }: SkeletonCardProps) {
  return (
    <div className="grid gap-3">
      {Array.from({ length: count }, (_, i) => (
        <SingleSkeletonCard key={i} />
      ))}
    </div>
  );
}
