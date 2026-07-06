import { PageHeaderSkeleton, TableSkeleton } from "@/components/layout/page-skeletons";

export default function AssetsLoading() {
  return (
    <div className="grid gap-6">
      <PageHeaderSkeleton />
      <TableSkeleton cols={7} />
    </div>
  );
}
