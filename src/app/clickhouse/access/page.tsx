"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, StatGrid } from "@/components/app";
import { useAuth } from "@/contexts/auth-context";
import {
  ClickHouseGate, ClickHouseHeader, DataTable, ErrorBanner, RefreshButton, Section, StatTile,
  formatNumber, useChData, YesNo,
} from "@/components/clickhouse/shared";
import { Loader2, Lock } from "lucide-react";

type Row = Record<string, any>;
interface AccessData {
  users: Row[] | null;
  roles: Row[] | null;
  roleGrants: Row[] | null;
  grants: Row[] | null;
  quotas: Row[] | null;
  quotaUsage: Row[] | null;
  profiles: Row[] | null;
  rowPolicies: Row[] | null;
  logins: Row[] | null;
  current: Row[] | null;
  unavailable: { section: string; error: string }[];
}

const n = (v: unknown) => Number(v ?? 0) || 0;
const list = (v: unknown) => (Array.isArray(v) ? v : v ? [v] : []).map(String).filter(Boolean);

function authType(u: Row) {
  const t = list(u.auth_type);
  return t.length ? t.join(", ") : "—";
}

function hostsOf(u: Row) {
  const parts = [...list(u.host_ip), ...list(u.host_names), ...list(u.host_names_regexp), ...list(u.host_names_like)];
  return parts.length ? parts.join(", ") : "—";
}

const anyHost = (u: Row) => list(u.host_ip).some(h => h === "::/0" || h === "0.0.0.0/0") || list(u.host_names_like).includes("%");
const noPassword = (u: Row) => list(u.auth_type).some(t => t === "no_password");

function AccessView() {
  const { data, error, loading, reload, unavailableFor } = useChData<AccessData>("/api/clickhouse/access");
  const [filter, setFilter] = useState("");

  const users = data?.users ?? [];
  const openUsers = users.filter(u => noPassword(u));
  const failures = (data?.logins ?? []).filter(l => l.type === "LoginFailure").reduce((a, l) => a + n(l.events), 0);
  const grants = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (data?.grants ?? []).filter(g => !f || [g.user_name, g.role_name, g.access_type, g.database, g.table].some(v => String(v ?? "").toLowerCase().includes(f)));
  }, [data, filter]);
  const me = data?.current?.[0];

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><RefreshButton loading={loading} onClick={reload} /></div>
      <ErrorBanner message={error} />
      {loading && !data && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}
      {data && (
        <>
          <StatGrid>
            <StatTile label="Users" value={formatNumber(users.length)} sub={me ? `connected as ${me.user}` : undefined} />
            <StatTile label="Users without password" value={formatNumber(openUsers.length)} tone={openUsers.length ? "crit" : "ok"} sub={openUsers.map(u => u.name).join(", ") || "none"} />
            <StatTile label="Roles" value={formatNumber(data.roles?.length)} sub={`${formatNumber(data.grants?.length)} grants`} />
            <StatTile label="Failed logins (24h)" value={formatNumber(failures)} tone={failures > 10 ? "warn" : "ok"} sub={data.logins === null ? "session_log disabled" : "from system.session_log"} />
          </StatGrid>

          <p className="text-sm text-muted-foreground">
            Read-only view of access control. Make changes with SQL (CREATE USER / GRANT …) in the <Link href="/clickhouse/sql" className="underline underline-offset-4">SQL workbench</Link>;
            the <Link href="/security/posture?target=clickhouse" className="underline underline-offset-4">Security posture</Link> page audits these settings.
          </p>

          <Tabs defaultValue="users">
            <TabsList className="flex-wrap">
              <TabsTrigger value="users">Users</TabsTrigger>
              <TabsTrigger value="grants">Grants</TabsTrigger>
              <TabsTrigger value="roles">Roles</TabsTrigger>
              <TabsTrigger value="quotas">Quotas</TabsTrigger>
              <TabsTrigger value="profiles">Settings profiles</TabsTrigger>
              <TabsTrigger value="policies">Row policies</TabsTrigger>
              <TabsTrigger value="logins">Logins</TabsTrigger>
            </TabsList>

            <TabsContent value="users" className="mt-4">
              <Section title="Users" description="Where each user is defined, how it authenticates and which hosts it may connect from." unavailable={unavailableFor("users")}>
                <DataTable rows={data.users} columns={[
                  { key: "name", label: "User", mono: true },
                  { key: "storage", label: "Defined in" },
                  { key: "auth_type", label: "Authentication", render: u => <Badge variant="outline" className={noPassword(u) ? "border-destructive/40 text-destructive" : "font-normal"}>{authType(u)}</Badge> },
                  { key: "hosts", label: "Allowed hosts", render: u => <span className={anyHost(u) ? "text-warning" : ""}>{hostsOf(u)}</span> },
                  { key: "default_roles", label: "Default roles", render: u => n(u.default_roles_all) ? "all granted" : list(u.default_roles_list).join(", ") || "—" },
                  { key: "default_database", label: "Default DB", mono: true },
                ]} />
              </Section>
            </TabsContent>

            <TabsContent value="grants" className="mt-4">
              <Section title="Grants" description="Privileges granted directly to users or to roles." unavailable={unavailableFor("grants")}
                actions={<Input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter user, role, privilege…" className="w-64" />}>
                <DataTable rows={grants} maxHeight={600} columns={[
                  { key: "who", label: "Grantee", render: g => g.user_name ? <span className="font-mono">{g.user_name}</span> : <span className="font-mono">role {g.role_name}</span> },
                  { key: "access_type", label: "Privilege", mono: true },
                  { key: "on", label: "On", render: g => <span className="font-mono">{g.database ?? "*"}.{g.table ?? "*"}{g.column ? `(${g.column})` : ""}</span> },
                  { key: "is_partial_revoke", label: "Revoke", render: g => n(g.is_partial_revoke) ? <Badge variant="outline">partial revoke</Badge> : null },
                  { key: "grant_option", label: "With grant option", render: g => <YesNo value={g.grant_option} /> },
                ]} />
              </Section>
            </TabsContent>

            <TabsContent value="roles" className="mt-4 space-y-4">
              <Section title="Roles" unavailable={unavailableFor("roles")}>
                <DataTable rows={data.roles} empty="No roles defined." columns={[
                  { key: "name", label: "Role", mono: true },
                  { key: "storage", label: "Defined in" },
                ]} />
              </Section>
              <Section title="Role assignments" unavailable={unavailableFor("roleGrants")}>
                <DataTable rows={data.roleGrants} empty="No roles granted." columns={[
                  { key: "grantee", label: "Granted to", render: g => <span className="font-mono">{g.user_name ?? `role ${g.role_name}`}</span> },
                  { key: "granted_role_name", label: "Role", mono: true },
                  { key: "with_admin_option", label: "Admin option", render: g => <YesNo value={g.with_admin_option} /> },
                ]} />
              </Section>
            </TabsContent>

            <TabsContent value="quotas" className="mt-4 space-y-4">
              <Section title="Quota usage" description="Usage in the current interval against each limit (empty limit = unlimited)." unavailable={unavailableFor("quotaUsage")}>
                <DataTable rows={data.quotaUsage} empty="No quotas in use." columns={[
                  { key: "quota_name", label: "Quota", mono: true },
                  { key: "quota_key", label: "Key", mono: true },
                  { key: "duration", label: "Interval", right: true, render: q => q.duration ? `${q.duration} s` : "—" },
                  { key: "queries", label: "Queries", right: true, render: q => `${formatNumber(q.queries)}${q.max_queries ? ` / ${formatNumber(q.max_queries)}` : ""}` },
                  { key: "errors", label: "Errors", right: true, render: q => `${formatNumber(q.errors)}${q.max_errors ? ` / ${formatNumber(q.max_errors)}` : ""}` },
                  { key: "read_rows", label: "Rows read", right: true, render: q => `${formatNumber(q.read_rows)}${q.max_read_rows ? ` / ${formatNumber(q.max_read_rows)}` : ""}` },
                  { key: "execution_time", label: "Exec time", right: true, render: q => `${Number(q.execution_time ?? 0).toFixed(1)}${q.max_execution_time ? ` / ${q.max_execution_time}` : ""} s` },
                ]} />
              </Section>
              <Section title="Quotas" unavailable={unavailableFor("quotas")}>
                <DataTable rows={data.quotas} empty="No quotas defined." columns={[
                  { key: "name", label: "Quota", mono: true },
                  { key: "keys", label: "Keyed by" },
                  { key: "durations", label: "Intervals (s)" },
                  { key: "applies", label: "Applies to", render: q => n(q.apply_to_all) ? "everyone" : list(q.apply_to_list).join(", ") || "—" },
                ]} />
              </Section>
            </TabsContent>

            <TabsContent value="profiles" className="mt-4">
              <Section title="Settings profiles" description="Settings and constraints applied to users and roles. Server-side limits here are the real guardrails — they apply to every client, not just IndexSphere." unavailable={unavailableFor("profiles")}>
                <DataTable rows={data.profiles} empty="No settings profile elements." maxHeight={600} columns={[
                  { key: "owner", label: "Profile / owner", render: p => <span className="font-mono">{p.profile_name ?? (p.user_name ? `user ${p.user_name}` : `role ${p.role_name}`)}</span> },
                  { key: "setting_name", label: "Setting", render: p => p.setting_name ? <span className="font-mono">{p.setting_name}</span> : p.inherit_profile ? <span className="text-muted-foreground">inherits {p.inherit_profile}</span> : null },
                  { key: "value", label: "Value", mono: true },
                  { key: "min", label: "Min", mono: true },
                  { key: "max", label: "Max", mono: true },
                  { key: "writability", label: "Writability" },
                ]} />
              </Section>
            </TabsContent>

            <TabsContent value="policies" className="mt-4">
              <Section title="Row policies" description="Filters that limit which rows a user can see." unavailable={unavailableFor("rowPolicies")}>
                <DataTable rows={data.rowPolicies} empty="No row policies." columns={[
                  { key: "name", label: "Policy", mono: true },
                  { key: "on", label: "Table", render: p => <span className="font-mono">{p.database}.{p.table}</span> },
                  { key: "select_filter", label: "Filter", mono: true },
                  { key: "is_restrictive", label: "Restrictive", render: p => <YesNo value={p.is_restrictive} /> },
                  { key: "applies", label: "Applies to", render: p => n(p.apply_to_all) ? "everyone" : list(p.apply_to_list).join(", ") || "—" },
                ]} />
              </Section>
            </TabsContent>

            <TabsContent value="logins" className="mt-4">
              <Section title="Logins, last 24 hours" description="Successful and failed logins grouped by user, client address and interface (system.session_log)." unavailable={unavailableFor("logins") ? "system.session_log is not enabled" : null}>
                <DataTable rows={data.logins} empty="No logins recorded." columns={[
                  { key: "user", label: "User", mono: true },
                  { key: "type", label: "Result", render: l => <Badge variant="outline" className={l.type === "LoginFailure" ? "border-destructive/40 text-destructive" : "font-normal"}>{l.type === "LoginFailure" ? "failed" : "success"}</Badge> },
                  { key: "client_address", label: "Client", mono: true },
                  { key: "interface", label: "Interface" },
                  { key: "events", label: "Count", right: true, render: l => formatNumber(l.events) },
                  { key: "last", label: "Last", className: "whitespace-nowrap" },
                ]} />
              </Section>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

export default function ClickHouseAccessPage() {
  const { user } = useAuth();
  const allowed = !!user?.permissions?.includes("admin") || !!user?.permissions?.includes("user");
  return (
    <ClickHouseGate>
      {(status, disconnect) => (
        <div className="space-y-6">
          <ClickHouseHeader title="Users & access" status={status} onDisconnect={disconnect}
            description="Who can connect, from where, with which privileges, quotas, settings profiles and row policies — plus recent logins." />
          {allowed ? <AccessView /> : (
            <EmptyState icon={Lock} title="Operator or admin role required" description="Access-control details are not shown to read-only users." />
          )}
        </div>
      )}
    </ClickHouseGate>
  );
}
