"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getElasticsearchClient } from "@/lib/elasticsearch";
import { useConnection } from "@/contexts/connection-context";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, CheckCircle2, Database, Loader2, Mail, Save, Send, Shield } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app";

// ── Email (SMTP) ─────────────────────────────────────────────────────────────

interface Smtp {
  smtp_host: string;
  smtp_port: string;
  smtp_secure: string; // "true" | "false"
  smtp_user: string;
  smtp_from: string;
  smtp_pass: string;   // write-only: never returned by the API
}

function EmailSettings({ isAdmin }: { isAdmin: boolean }) {
  const [smtp, setSmtp] = useState<Smtp | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!isAdmin) { setLoading(false); return; }
    fetch("/api/settings/email", { credentials: "include" })
      .then(r => r.json())
      .then(d => setSmtp({
        smtp_host: d.smtp_host ?? "", smtp_port: String(d.smtp_port ?? "587"), smtp_secure: String(d.smtp_secure ?? "false"),
        smtp_user: d.smtp_user ?? "", smtp_from: d.smtp_from ?? "", smtp_pass: "",
      }))
      .catch(() => setMessage({ ok: false, text: "Failed to load email settings" }))
      .finally(() => setLoading(false));
  }, [isAdmin]);

  if (!isAdmin) {
    return <EmptyState icon={Mail} title="Administrator access required" description="Only administrators can view or change email delivery settings." />;
  }
  if (loading || !smtp) {
    return <Card><CardContent className="space-y-3 pt-6">{[0, 1, 2].map(i => <Skeleton key={i} className="h-12" />)}</CardContent></Card>;
  }

  const update = (k: keyof Smtp, v: string) => setSmtp(s => (s ? { ...s, [k]: v } : s));

  const save = async () => {
    setSaving(true); setMessage(null);
    try {
      // Only send the password when one was typed, so a blank field keeps the stored one
      const { smtp_pass, ...rest } = smtp;
      const body = smtp_pass ? { ...rest, smtp_pass } : rest;
      const r = await fetch("/api/settings/email", {
        method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Failed to save");
      setSmtp(s => (s ? { ...s, smtp_pass: "" } : s));
      setMessage({ ok: true, text: "Email settings saved." });
    } catch (e) { setMessage({ ok: false, text: e instanceof Error ? e.message : "Failed to save" }); }
    finally { setSaving(false); }
  };

  const test = async () => {
    setTesting(true); setMessage(null);
    try {
      const r = await fetch("/api/settings/email", { method: "POST", credentials: "include" });
      const d = await r.json();
      setMessage(d.ok ? { ok: true, text: "Connected to the SMTP server successfully." } : { ok: false, text: d.error ?? "Connection failed" });
    } catch { setMessage({ ok: false, text: "Connection failed" }); }
    finally { setTesting(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Email delivery</CardTitle>
        <CardDescription>Used for alert notifications and scheduled reports. Save before testing.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
          <div className="grid gap-2">
            <Label htmlFor="smtp-host">SMTP server</Label>
            <Input id="smtp-host" value={smtp.smtp_host} onChange={e => update("smtp_host", e.target.value)} placeholder="smtp.example.com" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="smtp-port">Port</Label>
            <Input id="smtp-port" inputMode="numeric" value={smtp.smtp_port} onChange={e => update("smtp_port", e.target.value)} placeholder="587" />
          </div>
        </div>
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <Label htmlFor="smtp-secure">Use TLS from the start (SMTPS)</Label>
            <p className="text-xs text-muted-foreground">On for port 465. Leave off for 587, which upgrades with STARTTLS.</p>
          </div>
          <Switch id="smtp-secure" checked={smtp.smtp_secure === "true"} onCheckedChange={v => update("smtp_secure", v ? "true" : "false")} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="smtp-user">Username</Label>
            <Input id="smtp-user" autoComplete="off" value={smtp.smtp_user} onChange={e => update("smtp_user", e.target.value)} placeholder="Optional" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="smtp-pass">Password</Label>
            <Input id="smtp-pass" type="password" autoComplete="new-password" value={smtp.smtp_pass} onChange={e => update("smtp_pass", e.target.value)} placeholder="Leave blank to keep the current one" />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="smtp-from">From address</Label>
          <Input id="smtp-from" type="email" value={smtp.smtp_from} onChange={e => update("smtp_from", e.target.value)} placeholder="indexsphere@example.com" />
        </div>
        {message && (
          <Alert variant={message.ok ? "default" : "destructive"}>
            {message.ok ? <CheckCircle2 className="h-4 w-4 text-success" /> : <AlertCircle className="h-4 w-4" />}
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        )}
      </CardContent>
      <CardFooter className="justify-end gap-2 border-t pt-6">
        <Button variant="outline" onClick={test} disabled={testing || saving}>
          {testing ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Send className="h-4 w-4 mr-1.5" />}Test connection
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Save className="h-4 w-4 mr-1.5" />}Save
        </Button>
      </CardFooter>
    </Card>
  );
}

// ── Cluster settings (persistent, on the connected Elasticsearch/OpenSearch cluster) ──

interface ClusterSettings {
  actionAutoCreateIndex: boolean;
  actionDestructiveRequiresName: boolean;
  clusterRoutingAllocationEnable: string;
  clusterRoutingAllocationNodeConcurrentRecoveries: number;
  clusterRoutingAllocationNodeInitialPrimariesRecoveries: number;
  indicesRecoveryMaxBytesPerSec: string;
  searchMaxBuckets: number;
}

const CLUSTER_DEFAULTS: ClusterSettings = {
  actionAutoCreateIndex: true,
  actionDestructiveRequiresName: true,
  clusterRoutingAllocationEnable: "all",
  clusterRoutingAllocationNodeConcurrentRecoveries: 2,
  clusterRoutingAllocationNodeInitialPrimariesRecoveries: 4,
  indicesRecoveryMaxBytesPerSec: "40mb",
  searchMaxBuckets: 65536,
};

function ClusterSettingsForm() {
  const { isConnected } = useConnection();
  const [settings, setSettings] = useState<ClusterSettings>(CLUSTER_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const client = getElasticsearchClient();
    if (!client) { setLoading(false); return; }
    setLoading(true);
    try {
      const data = await client.getClusterSettings() as Record<string, Record<string, unknown>>;
      const p = data?.persistent || {};
      const num = (k: string, d: number) => (p[k] !== undefined ? parseInt(String(p[k]), 10) : d);
      setSettings({
        actionAutoCreateIndex: p["action.auto_create_index"] !== undefined ? String(p["action.auto_create_index"]) !== "false" : CLUSTER_DEFAULTS.actionAutoCreateIndex,
        actionDestructiveRequiresName: p["action.destructive_requires_name"] !== undefined ? String(p["action.destructive_requires_name"]) !== "false" : CLUSTER_DEFAULTS.actionDestructiveRequiresName,
        clusterRoutingAllocationEnable: (p["cluster.routing.allocation.enable"] as string) || CLUSTER_DEFAULTS.clusterRoutingAllocationEnable,
        clusterRoutingAllocationNodeConcurrentRecoveries: num("cluster.routing.allocation.node_concurrent_recoveries", CLUSTER_DEFAULTS.clusterRoutingAllocationNodeConcurrentRecoveries),
        clusterRoutingAllocationNodeInitialPrimariesRecoveries: num("cluster.routing.allocation.node_initial_primaries_recoveries", CLUSTER_DEFAULTS.clusterRoutingAllocationNodeInitialPrimariesRecoveries),
        indicesRecoveryMaxBytesPerSec: (p["indices.recovery.max_bytes_per_sec"] as string) || CLUSTER_DEFAULTS.indicesRecoveryMaxBytesPerSec,
        searchMaxBuckets: num("search.max_buckets", CLUSTER_DEFAULTS.searchMaxBuckets),
      });
      setDirty(false);
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Failed to load cluster settings" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isConnected) load(); else setLoading(false); }, [isConnected, load]);

  if (!isConnected) {
    return (
      <EmptyState icon={Database} title="No cluster connected" description="Connect to an Elasticsearch or OpenSearch cluster to view and change its settings."
        action={<Button asChild><Link href="/connections">Go to connections</Link></Button>} />
    );
  }

  const set = <K extends keyof ClusterSettings>(k: K, v: ClusterSettings[K]) => { setSettings(s => ({ ...s, [k]: v })); setDirty(true); };

  const save = async () => {
    setSaving(true); setMessage(null);
    try {
      const client = getElasticsearchClient();
      if (!client) throw new Error("Not connected to a cluster");
      await client.updateClusterSettings({
        persistent: {
          "action.auto_create_index": settings.actionAutoCreateIndex,
          "action.destructive_requires_name": settings.actionDestructiveRequiresName,
          "cluster.routing.allocation.enable": settings.clusterRoutingAllocationEnable,
          "cluster.routing.allocation.node_concurrent_recoveries": settings.clusterRoutingAllocationNodeConcurrentRecoveries,
          "cluster.routing.allocation.node_initial_primaries_recoveries": settings.clusterRoutingAllocationNodeInitialPrimariesRecoveries,
          "indices.recovery.max_bytes_per_sec": settings.indicesRecoveryMaxBytesPerSec,
          "search.max_buckets": settings.searchMaxBuckets,
        },
      });
      setDirty(false);
      setMessage({ ok: true, text: "Cluster settings saved (persistent)." });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cluster settings</CardTitle>
        <CardDescription>Persistent settings on the connected cluster. Changing them requires the administrator role.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {loading ? (
          <div className="space-y-3">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-12" />)}</div>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label htmlFor="auto-create">Automatically create indices</Label>
                <p className="text-xs text-muted-foreground"><code className="font-mono">action.auto_create_index</code></p>
              </div>
              <Switch id="auto-create" checked={settings.actionAutoCreateIndex} onCheckedChange={v => set("actionAutoCreateIndex", v)} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label htmlFor="destructive-name">Require explicit names for destructive actions</Label>
                <p className="text-xs text-muted-foreground"><code className="font-mono">action.destructive_requires_name</code> — blocks wildcard deletes.</p>
              </div>
              <Switch id="destructive-name" checked={settings.actionDestructiveRequiresName} onCheckedChange={v => set("actionDestructiveRequiresName", v)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Shard allocation</Label>
                <Select value={settings.clusterRoutingAllocationEnable} onValueChange={v => set("clusterRoutingAllocationEnable", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All shards</SelectItem>
                    <SelectItem value="primaries">Primaries only</SelectItem>
                    <SelectItem value="new_primaries">New primaries only</SelectItem>
                    <SelectItem value="none">None (maintenance)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground"><code className="font-mono">cluster.routing.allocation.enable</code></p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="recovery-rate">Recovery bandwidth per node</Label>
                <Input id="recovery-rate" value={settings.indicesRecoveryMaxBytesPerSec} onChange={e => set("indicesRecoveryMaxBytesPerSec", e.target.value)} placeholder="40mb" />
                <p className="text-xs text-muted-foreground"><code className="font-mono">indices.recovery.max_bytes_per_sec</code></p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="concurrent-rec">Concurrent recoveries per node</Label>
                <Input id="concurrent-rec" type="number" min={1} value={settings.clusterRoutingAllocationNodeConcurrentRecoveries}
                  onChange={e => set("clusterRoutingAllocationNodeConcurrentRecoveries", parseInt(e.target.value, 10) || 0)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="initial-rec">Initial primary recoveries per node</Label>
                <Input id="initial-rec" type="number" min={1} value={settings.clusterRoutingAllocationNodeInitialPrimariesRecoveries}
                  onChange={e => set("clusterRoutingAllocationNodeInitialPrimariesRecoveries", parseInt(e.target.value, 10) || 0)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="max-buckets">Maximum aggregation buckets</Label>
                <Input id="max-buckets" type="number" min={1} value={settings.searchMaxBuckets}
                  onChange={e => set("searchMaxBuckets", parseInt(e.target.value, 10) || 0)} />
                <p className="text-xs text-muted-foreground"><code className="font-mono">search.max_buckets</code></p>
              </div>
            </div>
          </>
        )}
        {message && (
          <Alert variant={message.ok ? "default" : "destructive"}>
            {message.ok ? <CheckCircle2 className="h-4 w-4 text-success" /> : <AlertCircle className="h-4 w-4" />}
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        )}
      </CardContent>
      <CardFooter className="justify-end gap-2 border-t pt-6">
        <Button variant="outline" onClick={load} disabled={loading || saving}>Discard changes</Button>
        <Button onClick={save} disabled={saving || !dirty}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Save className="h-4 w-4 mr-1.5" />}Save
        </Button>
      </CardFooter>
    </Card>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = !!user?.permissions?.includes("admin");

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Email delivery for alerts and reports, and settings of the connected cluster." />
      <Tabs defaultValue="email">
        <TabsList>
          <TabsTrigger value="email">Email</TabsTrigger>
          <TabsTrigger value="cluster">Cluster</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>
        <TabsContent value="email" className="mt-4 max-w-3xl"><EmailSettings isAdmin={isAdmin} /></TabsContent>
        <TabsContent value="cluster" className="mt-4 max-w-3xl"><ClusterSettingsForm /></TabsContent>
        <TabsContent value="security" className="mt-4 max-w-3xl">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Shield className="h-4 w-4 text-muted-foreground" />Security settings</CardTitle>
              <CardDescription>
                Sign-in policy, account lockouts and the browser inspection lock live on the Authentication page.
                Server-level options (TLS, cookies, allowed hosts) are environment variables — see docs/02-configuration.md.
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <Button variant="outline" asChild><Link href="/auth-config">Open authentication settings</Link></Button>
            </CardFooter>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
