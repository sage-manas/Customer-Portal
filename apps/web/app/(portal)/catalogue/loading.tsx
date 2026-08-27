import { Skeleton } from "@cc/ui";

export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Loading catalogue…</span>
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-[68px] w-full rounded-md" />
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-52 w-full rounded-md" />
        ))}
      </section>
    </div>
  );
}
