"use client";

import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/app";
import { ReviewPanel } from "@/components/best-practices/review-view";

function BestPractices() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = params.get("target") === "clickhouse" ? "clickhouse" : "search";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Best practices"
        description="Checks each server's configuration against the vendor's production recommendations — memory, disks, shards or parts, replication, backups, lifecycle and more — and shows the current value, the recommended value and how to fix each gap."
        meta={<Badge variant="outline">Read-only — nothing is changed</Badge>}
      />
      <Tabs value={tab} onValueChange={v => router.replace(v === "clickhouse" ? `${pathname}?target=clickhouse` : pathname)}>
        <TabsList>
          <TabsTrigger value="search">Elasticsearch / OpenSearch</TabsTrigger>
          <TabsTrigger value="clickhouse">ClickHouse</TabsTrigger>
        </TabsList>
        <TabsContent value="search" className="mt-4"><ReviewPanel target="search" /></TabsContent>
        <TabsContent value="clickhouse" className="mt-4"><ReviewPanel target="clickhouse" /></TabsContent>
      </Tabs>
    </div>
  );
}

export default function BestPracticesPage() {
  return <Suspense><BestPractices /></Suspense>;
}
