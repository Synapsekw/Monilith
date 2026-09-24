import { NotFoundFallback } from "@/components/shell/not-found-fallback";

export default function FolderNotFound() {
  return (
    <NotFoundFallback
      title="Folder not found"
      description="This folder may have been deleted, or you may not have access to it."
      backHref="/dashboards"
      backLabel="All folders"
    />
  );
}
