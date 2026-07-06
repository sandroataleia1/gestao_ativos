import { PageHeaderSkeleton, TableSkeleton } from "@/components/layout/page-skeletons";

export default function CadastrosLoading() {
  return (
    <div className="grid gap-6">
      <PageHeaderSkeleton />
      <TableSkeleton cols={4} />
    </div>
  );
}
