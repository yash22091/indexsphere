import type { LucideIcon } from "lucide-react";
import {
  Activity, ArrowRightLeft, BarChart3, BellRing, BookOpen, CalendarClock, ClipboardCheck, Combine, Database, FileDown, FileText,
  Gauge, GitCompare, HardDrive, History, Import, KeyRound, Network,
  Globe, Layers, LayoutDashboard, Lightbulb, PlugZap, RefreshCw, ScrollText, Server, Settings, Shield,
  ShieldAlert, ShieldCheck, Shuffle, Sparkles, Table2, Target, TerminalSquare, Trash2, Users, Zap, HeartPulse, LineChart,
} from "lucide-react";

/** Which data engine a page works with. */
export type Engine = "search" | "clickhouse";

export const ENGINE_LABEL: Record<Engine, { short: string; long: string }> = {
  search: { short: "ES", long: "Elasticsearch / OpenSearch" },
  clickhouse: { short: "CH", long: "ClickHouse" },
};

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  /** Extra words for the ⌘K command palette. */
  keywords?: string;
  /**
   * Engines the page works with. Shown as small ES / CH tags on pages outside
   * an engine's own section (cross-engine and administration pages).
   */
  engines?: Engine[];
  /** Direction of a cross-engine flow (shown as "ES → CH" instead of two tags). */
  flow?: [Engine, Engine];
  /** Optional sub-heading inside a group; shown when it changes. */
  section?: string;
}

export interface NavGroup {
  id: string;
  label: string;
  /** Shorter heading for the sidebar when `label` does not fit. */
  navLabel?: string;
  /** Engine-specific groups show that engine's connection status next to the heading. */
  engine?: Engine;
  /** One-line explanation, used as the heading's tooltip. */
  hint?: string;
  items: NavItem[];
}

/** Single source of truth for the sidebar, breadcrumbs and the command palette. */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: "search",
    label: "Elasticsearch / OpenSearch",
    navLabel: "Elastic / OpenSearch",
    engine: "search",
    hint: "pages for the connected Elasticsearch or OpenSearch cluster",
    items: [
      { title: "Overview", href: "/overview", icon: LayoutDashboard },
      { title: "Cluster health", href: "/cluster-health", icon: HeartPulse, keywords: "jvm heap cpu disk" },
      { title: "Cluster analysis", href: "/cluster-analysis", icon: Target, keywords: "score best practices" },
      { title: "Live monitoring", href: "/monitoring", icon: LineChart, keywords: "metrics realtime sse" },
      { title: "Nodes", href: "/nodes", icon: Server },
      { title: "Indices", href: "/indices", icon: Database },
      { title: "Shards", href: "/shards", icon: Layers, keywords: "allocation unassigned" },
      { title: "Index advisor", href: "/index-advisor", icon: Lightbulb, keywords: "score grade recommendations" },
      { title: "Query workbench", href: "/query-workbench", icon: TerminalSquare, keywords: "dsl profile explain" },
      { title: "AI query", href: "/ai-query", icon: Sparkles, keywords: "natural language llm" },
      { title: "Search analytics", href: "/search-analytics", icon: BarChart3 },
      { title: "Config & policies", href: "/cluster-config", icon: BookOpen, keywords: "aliases templates ilm ism snapshots" },
      { title: "Reindex", href: "/reindex-wizard", icon: RefreshCw, section: "Data operations" },
      { title: "Bulk operations", href: "/bulk-operations", icon: Zap, keywords: "close open forcemerge", section: "Data operations" },
      { title: "Delete by query", href: "/delete-by-query", icon: Trash2, section: "Data operations" },
      { title: "Data migration", href: "/data-migration", icon: Shuffle, section: "Data operations" },
      { title: "Reports", href: "/reports", icon: FileDown, keywords: "pdf export", section: "Reports" },
      { title: "Scheduled reports", href: "/scheduled-reports", icon: CalendarClock, keywords: "email cron", section: "Reports" },
    ],
  },
  {
    id: "clickhouse",
    label: "ClickHouse",
    engine: "clickhouse",
    hint: "pages for the connected ClickHouse server",
    items: [
      { title: "Overview", href: "/clickhouse", icon: Gauge, keywords: "clickhouse" },
      { title: "Explorer", href: "/clickhouse/explorer", icon: Table2, keywords: "clickhouse tables databases" },
      { title: "Query activity", href: "/clickhouse/queries", icon: Activity, keywords: "clickhouse slow failed" },
      { title: "SQL workbench", href: "/clickhouse/sql", icon: TerminalSquare, keywords: "clickhouse sql" },
      { title: "Table advisor", href: "/clickhouse/advisor", icon: Lightbulb, keywords: "clickhouse best practices schema" },
      { title: "Merges & mutations", href: "/clickhouse/merges", icon: Combine, keywords: "clickhouse parts too many parts mutation kill", section: "Operations" },
      { title: "Storage", href: "/clickhouse/storage", icon: HardDrive, keywords: "clickhouse disks partitions ttl detached dictionaries optimize drop", section: "Operations" },
      { title: "Ingestion", href: "/clickhouse/ingestion", icon: Import, keywords: "clickhouse inserts async kafka materialized views", section: "Operations" },
      { title: "Replication & cluster", href: "/clickhouse/replication", icon: Network, keywords: "clickhouse replicas keeper zookeeper distributed ddl shards", section: "Operations" },
      { title: "Server & logs", href: "/clickhouse/server", icon: FileText, keywords: "clickhouse text_log errors warnings settings metrics backups crashes", section: "Operations" },
      { title: "Users & access", href: "/clickhouse/access", icon: KeyRound, keywords: "clickhouse users roles grants quotas profiles row policies logins", section: "Access" },
    ],
  },
  {
    id: "common",
    label: "Cross-engine",
    hint: "features that work with both engines; the tags show which",
    items: [
      { title: "Best practices", href: "/best-practices", icon: ClipboardCheck, keywords: "configuration review recommendations score production readiness", engines: ["search", "clickhouse"] },
      { title: "Security posture", href: "/security/posture", icon: ShieldCheck, keywords: "hardening audit tls users grants", engines: ["search", "clickhouse"] },
      { title: "Vulnerabilities", href: "/vulnerabilities", icon: ShieldAlert, keywords: "cve nvd kev", engines: ["search", "clickhouse"] },
      { title: "Configuration drift", href: "/security/drift", icon: History, keywords: "changes snapshots diff history", engines: ["search", "clickhouse"] },
      { title: "Cluster compare", href: "/cluster-compare", icon: GitCompare, keywords: "diff staging production schema", engines: ["search", "clickhouse"] },
      { title: "Alerts", href: "/alerts", icon: BellRing, keywords: "notifications email slack webhook", engines: ["search", "clickhouse"] },
      { title: "ES to ClickHouse", href: "/clickhouse/migrate", icon: ArrowRightLeft, keywords: "migrate migration mapping ddl copy clickhouse elasticsearch", flow: ["search", "clickhouse"] },
    ],
  },
  {
    id: "admin",
    label: "Administration",
    hint: "IndexSphere itself: connections, users and settings",
    items: [
      { title: "Connections", href: "/connections", icon: Globe, keywords: "clusters saved clickhouse", engines: ["search", "clickhouse"] },
      { title: "Quick connect", href: "/connect", icon: PlugZap, keywords: "ad-hoc", engines: ["search"] },
      { title: "Users", href: "/user-management", icon: Users, adminOnly: true },
      { title: "Authentication", href: "/auth-config", icon: Shield, adminOnly: true },
      { title: "Settings", href: "/settings", icon: Settings, keywords: "smtp email" },
      { title: "Audit trail", href: "/audit-trail", icon: ScrollText },
    ],
  },
];

export function findNavItem(pathname: string): { group: NavGroup; item: NavItem } | null {
  // Longest matching href wins (/clickhouse/sql over /clickhouse)
  let best: { group: NavGroup; item: NavItem } | null = null;
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (pathname === item.href || pathname.startsWith(item.href + "/")) {
        if (!best || item.href.length > best.item.href.length) best = { group, item };
      }
    }
  }
  return best;
}
