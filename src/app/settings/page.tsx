"use client";

import { useState, useEffect } from "react";
import { getElasticsearchClient } from "@/lib/elasticsearch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Settings,
  Save,
  RefreshCw,
  Shield,
  Database,
  Network,
  AlertTriangle,
  CheckCircle,
  Monitor,
  Zap,
  Users,
  Key,
  Globe,
  Server,
  HardDrive,
  Clock,
  Lock,
  LockOpen,
  Bug,
  Eye,
  EyeOff,
} from "lucide-react";

export default function SettingsPage() {
  const [clusterSettings, setClusterSettings] = useState({
    clusterName: "elasticsearch-cluster",
    nodeMaxLocalStorageNodes: 1,
    actionAutoCreateIndex: true,
    actionDestructiveRequiresName: true,
    clusterRoutingAllocationEnable: "all",
    clusterRoutingAllocationNodeConcurrentRecoveries: 2,
    clusterRoutingAllocationNodeInitialPrimariesRecoveries: 4,
    indicesRecoveryMaxBytesPerSec: "40mb",
    indicesRecoveryMaxConcurrentFileChunks: 2,
    searchMaxBuckets: 65536,
    httpMaxContentLength: "100mb",
    httpMaxInitialLineLength: "4kb",
    httpMaxHeaderSize: "8kb"
  });

  const [securitySettings, setSecuritySettings] = useState({
    xpackSecurityEnabled: false,
    xpackSecurityTransportSslEnabled: false,
    xpackSecurityHttpSslEnabled: false,
    xpackMonitoringEnabled: true,
    xpackWatcherEnabled: false
  });

  // ── Traffic Security Lock state ────────────────────────────────────────────
  const [secLockEnabled, setSecLockEnabled] = useState(false);
  const [secLockLoading, setSecLockLoading] = useState(false);
  const [secLockError, setSecLockError] = useState<string | null>(null);
  const [secLockSuccess, setSecLockSuccess] = useState<string | null>(null);
  // toggle lock dialog
  const [showLockDialog, setShowLockDialog] = useState(false);
  const [lockTogglePassword, setLockTogglePassword] = useState("");
  const [showLockPwd, setShowLockPwd] = useState(false);
  // debug password regeneration
  const [showDebugPwdForm, setShowDebugPwdForm] = useState(false);
  const [ownPwdForDebug, setOwnPwdForDebug] = useState("");
  // activate debug mode
  const [debugInput, setDebugInput] = useState("");
  const [showDebugInput, setShowDebugInput] = useState(false);
  const [debugActive, setDebugActive] = useState(false);

  // Load security lock status on mount
  useEffect(() => {
    fetch("/api/settings/security", { credentials: "include" })
      .then(r => r.json())
      .then(d => { setSecLockEnabled(d.lockEnabled ?? false); })
      .catch(() => {});
    // Check if debug mode is currently active (in sessionStorage)
    if (typeof window !== "undefined") {
      const token = sessionStorage.getItem("is:debug");
      if (token) {
        try { const p = JSON.parse(atob(token.split(".")[1])); setDebugActive((p.exp ?? 0) * 1000 > Date.now()); } catch { /**/ }
      }
    }
  }, []);

  const [indexTemplateSettings, setIndexTemplateSettings] = useState({
    numberOfShards: 1,
    numberOfReplicas: 1,
    refreshInterval: "1s",
    indexBlocksReadOnly: false,
    indexBlocksWrite: false,
    indexBlocksMetadata: false
  });

  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const client = getElasticsearchClient();
        if (!client) return;
        const data = await client.getClusterSettings() as Record<string, Record<string, unknown>>;
        const persistent = data?.persistent || {};
        setClusterSettings(prev => ({
          ...prev,
          actionAutoCreateIndex:
            persistent["action.auto_create_index"] !== undefined
              ? String(persistent["action.auto_create_index"]) !== "false"
              : prev.actionAutoCreateIndex,
          actionDestructiveRequiresName:
            persistent["action.destructive_requires_name"] !== undefined
              ? String(persistent["action.destructive_requires_name"]) !== "false"
              : prev.actionDestructiveRequiresName,
          clusterRoutingAllocationEnable:
            (persistent["cluster.routing.allocation.enable"] as string) || prev.clusterRoutingAllocationEnable,
          clusterRoutingAllocationNodeConcurrentRecoveries:
            persistent["cluster.routing.allocation.node_concurrent_recoveries"] !== undefined
              ? parseInt(String(persistent["cluster.routing.allocation.node_concurrent_recoveries"]))
              : prev.clusterRoutingAllocationNodeConcurrentRecoveries,
          clusterRoutingAllocationNodeInitialPrimariesRecoveries:
            persistent["cluster.routing.allocation.node_initial_primaries_recoveries"] !== undefined
              ? parseInt(String(persistent["cluster.routing.allocation.node_initial_primaries_recoveries"]))
              : prev.clusterRoutingAllocationNodeInitialPrimariesRecoveries,
          indicesRecoveryMaxBytesPerSec:
            (persistent["indices.recovery.max_bytes_per_sec"] as string) || prev.indicesRecoveryMaxBytesPerSec,
          searchMaxBuckets:
            persistent["search.max_buckets"] !== undefined
              ? parseInt(String(persistent["search.max_buckets"]))
              : prev.searchMaxBuckets,
        }));
      } catch (err) {
        console.error("Failed to load cluster settings:", err);
      } finally {
        setIsLoading(false);
      }
    };
    loadSettings();
  }, []);

  const saveSettings = async () => {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const client = getElasticsearchClient();
      if (!client) throw new Error("Not connected to an Elasticsearch cluster");
      await client.updateClusterSettings({
        persistent: {
          "action.auto_create_index": clusterSettings.actionAutoCreateIndex,
          "action.destructive_requires_name": clusterSettings.actionDestructiveRequiresName,
          "cluster.routing.allocation.enable": clusterSettings.clusterRoutingAllocationEnable,
          "cluster.routing.allocation.node_concurrent_recoveries": clusterSettings.clusterRoutingAllocationNodeConcurrentRecoveries,
          "cluster.routing.allocation.node_initial_primaries_recoveries": clusterSettings.clusterRoutingAllocationNodeInitialPrimariesRecoveries,
          "indices.recovery.max_bytes_per_sec": clusterSettings.indicesRecoveryMaxBytesPerSec,
          "search.max_buckets": clusterSettings.searchMaxBuckets,
        }
      });
      setSaveSuccess(true);
      setHasChanges(false);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const resetSettings = () => {
    // Reset to defaults
    setHasChanges(false);
  };

  // ── Traffic Security Lock handlers ────────────────────────────────────────
  const secAction = async (action: string, extra: Record<string, string>) => {
    setSecLockLoading(true); setSecLockError(null); setSecLockSuccess(null);
    try {
      const resp = await fetch("/api/settings/security", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error ?? "Request failed");
      return data;
    } finally {
      setSecLockLoading(false);
    }
  };

  const toggleLock = async () => {
    try {
      await secAction("setLock", { enabled: String(!secLockEnabled), password: lockTogglePassword });
      setSecLockEnabled(v => !v);
      setSecLockSuccess(`Security lock ${secLockEnabled ? "disabled" : "enabled"}.`);
      setShowLockDialog(false); setLockTogglePassword("");
      setTimeout(() => setSecLockSuccess(null), 4000);
    } catch (e) { setSecLockError(String(e instanceof Error ? e.message : e)); }
  };

  const saveDebugPwd = async () => {
    try {
      await secAction("regenDebugPwd", { password: ownPwdForDebug });
      setSecLockSuccess("New debug password generated — check container logs immediately.");
      setShowDebugPwdForm(false); setOwnPwdForDebug("");
      setTimeout(() => setSecLockSuccess(null), 6000);
    } catch (e) { setSecLockError(String(e instanceof Error ? e.message : e)); }
  };

  const activateDebug = async () => {
    try {
      const data = await secAction("debugOn", { debugPwd: debugInput });
      if (data.debugToken && typeof window !== "undefined") {
        sessionStorage.setItem("is:debug", data.debugToken);
        setDebugActive(true); setShowDebugInput(false); setDebugInput("");
        setSecLockSuccess("Debug mode active for 1 hour. Reload to apply.");
        setTimeout(() => setSecLockSuccess(null), 5000);
      }
    } catch (e) { setSecLockError(String(e instanceof Error ? e.message : e)); }
  };

  const disableDebug = async () => {
    if (typeof window !== "undefined") sessionStorage.removeItem("is:debug");
    setDebugActive(false);
    setSecLockSuccess("Debug mode disabled.");
    setTimeout(() => setSecLockSuccess(null), 3000);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-7xl mx-auto space-y-8">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <h1 className="text-4xl font-bold tracking-tight">Cluster Settings</h1>
              <p className="text-xl text-muted-foreground">
                Configure your Elasticsearch cluster settings and preferences
              </p>
            </div>
            
            <div className="flex items-center space-x-4">
              {saveError && (
                <Badge variant="destructive">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  {saveError}
                </Badge>
              )}
              {saveSuccess && (
                <Badge variant="outline" className="text-green-600">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Saved
                </Badge>
              )}
              {hasChanges && !saveError && !saveSuccess && (
                <Badge variant="outline" className="text-orange-600">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Unsaved Changes
                </Badge>
              )}
              <Button variant="outline" onClick={resetSettings}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Reset
              </Button>
              <Button onClick={saveSettings} disabled={saving || !hasChanges}>
                {saving ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save Changes
              </Button>
            </div>
          </div>

          {/* Settings Warning */}
          <Alert className="border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/20">
            <AlertTriangle className="h-4 w-4 text-yellow-600" />
            <AlertDescription className="text-yellow-800 dark:text-yellow-200">
              <strong>Warning:</strong> Changing cluster settings may affect performance and stability. 
              Some settings require a cluster restart to take effect.
            </AlertDescription>
          </Alert>

          {/* Settings Tabs */}
          <Tabs defaultValue="general" className="space-y-6">
            <TabsList className="grid w-full grid-cols-6">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="performance">Performance</TabsTrigger>
              <TabsTrigger value="security">Security</TabsTrigger>
              <TabsTrigger value="indices">Indices</TabsTrigger>
              <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
              <TabsTrigger value="advanced">Advanced</TabsTrigger>
            </TabsList>

            <TabsContent value="general" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Settings className="h-5 w-5 mr-2" />
                    General Cluster Settings
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label htmlFor="cluster-name">Cluster Name</Label>
                      <Input
                        id="cluster-name"
                        value={clusterSettings.clusterName}
                        onChange={(e) => {
                          setClusterSettings({...clusterSettings, clusterName: e.target.value});
                          setHasChanges(true);
                        }}
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="max-local-storage">Max Local Storage Nodes</Label>
                      <Input
                        id="max-local-storage"
                        type="number"
                        value={clusterSettings.nodeMaxLocalStorageNodes}
                        onChange={(e) => {
                          setClusterSettings({...clusterSettings, nodeMaxLocalStorageNodes: parseInt(e.target.value)});
                          setHasChanges(true);
                        }}
                      />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Auto Create Index</Label>
                        <div className="text-sm text-muted-foreground">
                          Automatically create indices when documents are indexed
                        </div>
                      </div>
                      <Switch
                        checked={clusterSettings.actionAutoCreateIndex}
                        onCheckedChange={(checked: boolean) => {
                          setClusterSettings({...clusterSettings, actionAutoCreateIndex: checked});
                          setHasChanges(true);
                        }}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Destructive Operations Require Name</Label>
                        <div className="text-sm text-muted-foreground">
                          Require explicit index names for destructive operations
                        </div>
                      </div>
                      <Switch
                        checked={clusterSettings.actionDestructiveRequiresName}
                        onCheckedChange={(checked: boolean) => {
                          setClusterSettings({...clusterSettings, actionDestructiveRequiresName: checked});
                          setHasChanges(true);
                        }}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Network className="h-5 w-5 mr-2" />
                    Network Settings
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label htmlFor="http-max-content">HTTP Max Content Length</Label>
                      <Input
                        id="http-max-content"
                        value={clusterSettings.httpMaxContentLength}
                        onChange={(e) => {
                          setClusterSettings({...clusterSettings, httpMaxContentLength: e.target.value});
                          setHasChanges(true);
                        }}
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="http-max-header">HTTP Max Header Size</Label>
                      <Input
                        id="http-max-header"
                        value={clusterSettings.httpMaxHeaderSize}
                        onChange={(e) => {
                          setClusterSettings({...clusterSettings, httpMaxHeaderSize: e.target.value});
                          setHasChanges(true);
                        }}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="performance" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Zap className="h-5 w-5 mr-2" />
                    Performance Settings
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label htmlFor="allocation-enable">Routing Allocation</Label>
                      <Select
                        value={clusterSettings.clusterRoutingAllocationEnable}
                        onValueChange={(value) => {
                          setClusterSettings({...clusterSettings, clusterRoutingAllocationEnable: value});
                          setHasChanges(true);
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          <SelectItem value="primaries">Primaries Only</SelectItem>
                          <SelectItem value="new_primaries">New Primaries</SelectItem>
                          <SelectItem value="none">None</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="concurrent-recoveries">Concurrent Recoveries</Label>
                      <Input
                        id="concurrent-recoveries"
                        type="number"
                        value={clusterSettings.clusterRoutingAllocationNodeConcurrentRecoveries}
                        onChange={(e) => {
                          setClusterSettings({...clusterSettings, clusterRoutingAllocationNodeConcurrentRecoveries: parseInt(e.target.value)});
                          setHasChanges(true);
                        }}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="recovery-max-bytes">Recovery Max Bytes/sec</Label>
                      <Input
                        id="recovery-max-bytes"
                        value={clusterSettings.indicesRecoveryMaxBytesPerSec}
                        onChange={(e) => {
                          setClusterSettings({...clusterSettings, indicesRecoveryMaxBytesPerSec: e.target.value});
                          setHasChanges(true);
                        }}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="search-max-buckets">Search Max Buckets</Label>
                      <Input
                        id="search-max-buckets"
                        type="number"
                        value={clusterSettings.searchMaxBuckets}
                        onChange={(e) => {
                          setClusterSettings({...clusterSettings, searchMaxBuckets: parseInt(e.target.value)});
                          setHasChanges(true);
                        }}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="security" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Shield className="h-5 w-5 mr-2" />
                    Security Settings
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>X-Pack Security Enabled</Label>
                        <div className="text-sm text-muted-foreground">
                          Enable authentication and authorization features
                        </div>
                      </div>
                      <Switch
                        checked={securitySettings.xpackSecurityEnabled}
                        onCheckedChange={(checked: boolean) => {
                          setSecuritySettings({...securitySettings, xpackSecurityEnabled: checked});
                          setHasChanges(true);
                        }}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Transport SSL Enabled</Label>
                        <div className="text-sm text-muted-foreground">
                          Enable SSL/TLS for inter-node communication
                        </div>
                      </div>
                      <Switch
                        checked={securitySettings.xpackSecurityTransportSslEnabled}
                        onCheckedChange={(checked) => {
                          setSecuritySettings({...securitySettings, xpackSecurityTransportSslEnabled: checked});
                          setHasChanges(true);
                        }}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>HTTP SSL Enabled</Label>
                        <div className="text-sm text-muted-foreground">
                          Enable SSL/TLS for HTTP client connections
                        </div>
                      </div>
                      <Switch
                        checked={securitySettings.xpackSecurityHttpSslEnabled}
                        onCheckedChange={(checked) => {
                          setSecuritySettings({...securitySettings, xpackSecurityHttpSslEnabled: checked});
                          setHasChanges(true);
                        }}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* ── Traffic Security Lock ─────────────────────────────────── */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {secLockEnabled ? <Lock className="h-5 w-5 text-destructive" /> : <LockOpen className="h-5 w-5 text-muted-foreground" />}
                    Traffic Security Lock
                    <Badge variant={secLockEnabled ? "destructive" : "outline"} className="ml-auto text-xs">
                      {secLockEnabled ? "LOCKED" : "UNLOCKED"}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {secLockError && (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>{secLockError}</AlertDescription>
                    </Alert>
                  )}
                  {secLockSuccess && (
                    <Alert className="border-emerald-500/40 bg-emerald-500/5">
                      <CheckCircle className="h-4 w-4 text-emerald-500" />
                      <AlertDescription className="text-emerald-700 dark:text-emerald-400">{secLockSuccess}</AlertDescription>
                    </Alert>
                  )}

                  {/* Lock status + toggle */}
                  <div className="rounded-lg border p-4 space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-medium text-sm">Browser DevTools Lock</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          When enabled: blocks F12/Ctrl+Shift+I keyboard shortcuts, disables right-click, and shows a lockout overlay if DevTools is detected open.
                          Does <strong>not</strong> prevent TLS interception — use HTTPS for that.
                        </p>
                      </div>
                      <Switch
                        checked={secLockEnabled}
                        onCheckedChange={() => { setSecLockError(null); setSecLockSuccess(null); setShowLockDialog(true); }}
                        disabled={secLockLoading}
                      />
                    </div>

                    {showLockDialog && (
                      <div className="border rounded-md p-3 bg-muted/40 space-y-3">
                        <p className="text-sm font-medium">
                          {secLockEnabled ? "Disabling" : "Enabling"} the lock requires your account password:
                        </p>
                        <div className="relative">
                          <Input
                            type={showLockPwd ? "text" : "password"}
                            placeholder="Your account password"
                            value={lockTogglePassword}
                            onChange={e => setLockTogglePassword(e.target.value)}
                            className="pr-10"
                            onKeyDown={e => { if (e.key === "Enter") toggleLock(); }}
                          />
                          <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowLockPwd(v => !v)}>
                            {showLockPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={toggleLock} disabled={secLockLoading || !lockTogglePassword}>
                            {secLockLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                            Confirm
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => { setShowLockDialog(false); setLockTogglePassword(""); }}>Cancel</Button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Debug password — auto-generated on first boot */}
                  <div className="rounded-lg border p-4 space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-medium text-sm flex items-center gap-2">
                          <Bug className="h-4 w-4" /> Debug Unlock Password
                          <Badge variant="outline" className="text-emerald-600 border-emerald-500 text-xs">Auto-generated</Badge>
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          A random password was generated on first container boot and printed to the container logs (<code className="bg-muted px-1 rounded">docker logs &lt;container&gt;</code>).
                          Save it — it is never shown in the UI. Admins can regenerate it (new password printed to logs, old one invalidated).
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { setShowDebugPwdForm(v => !v); setSecLockError(null); }}
                        className="shrink-0"
                      >
                        Regenerate
                      </Button>
                    </div>
                    {showDebugPwdForm && (
                      <div className="border rounded-md p-3 bg-muted/40 space-y-2">
                        <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                          ⚠️ This will invalidate the current debug password. The new one will be printed to container logs — check them immediately.
                        </p>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Your account password (to confirm)</Label>
                          <Input
                            type="password"
                            placeholder="Your account password"
                            value={ownPwdForDebug}
                            onChange={e => setOwnPwdForDebug(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") saveDebugPwd(); }}
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={saveDebugPwd} disabled={secLockLoading || !ownPwdForDebug}>
                            {secLockLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                            Confirm Regenerate
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => { setShowDebugPwdForm(false); setOwnPwdForDebug(""); }}>Cancel</Button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Activate debug mode */}
                  <div className="rounded-lg border p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm flex items-center gap-2">
                          Debug / Inspection Mode
                          {debugActive && <Badge className="bg-amber-500 text-white text-xs animate-pulse">ACTIVE</Badge>}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Enter the debug unlock password (from container logs) to temporarily suspend the security lock for 1 hour.
                        </p>
                      </div>
                      <Button size="sm" variant={debugActive ? "destructive" : "outline"} onClick={() => { if (debugActive) disableDebug(); else setShowDebugInput(v => !v); }}>
                        {debugActive ? "Disable Debug Mode" : "Activate Debug Mode"}
                      </Button>
                    </div>
                    {showDebugInput && !debugActive && (
                      <div className="border rounded-md p-3 bg-muted/40 space-y-2">
                        <Label className="text-xs">Debug unlock password (from container logs)</Label>
                        <div className="flex gap-2">
                          <Input type="password" placeholder="Debug password" value={debugInput} onChange={e => setDebugInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") activateDebug(); }} />
                          <Button size="sm" onClick={activateDebug} disabled={secLockLoading || !debugInput}>Unlock</Button>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="indices" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Database className="h-5 w-5 mr-2" />
                    Default Index Settings
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label htmlFor="default-shards">Default Number of Shards</Label>
                      <Input
                        id="default-shards"
                        type="number"
                        value={indexTemplateSettings.numberOfShards}
                        onChange={(e) => {
                          setIndexTemplateSettings({...indexTemplateSettings, numberOfShards: parseInt(e.target.value)});
                          setHasChanges(true);
                        }}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="default-replicas">Default Number of Replicas</Label>
                      <Input
                        id="default-replicas"
                        type="number"
                        value={indexTemplateSettings.numberOfReplicas}
                        onChange={(e) => {
                          setIndexTemplateSettings({...indexTemplateSettings, numberOfReplicas: parseInt(e.target.value)});
                          setHasChanges(true);
                        }}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="refresh-interval">Default Refresh Interval</Label>
                      <Input
                        id="refresh-interval"
                        value={indexTemplateSettings.refreshInterval}
                        onChange={(e) => {
                          setIndexTemplateSettings({...indexTemplateSettings, refreshInterval: e.target.value});
                          setHasChanges(true);
                        }}
                      />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Block Read Operations</Label>
                        <div className="text-sm text-muted-foreground">
                          Block read operations on indices by default
                        </div>
                      </div>
                      <Switch
                        checked={indexTemplateSettings.indexBlocksReadOnly}
                        onCheckedChange={(checked) => {
                          setIndexTemplateSettings({...indexTemplateSettings, indexBlocksReadOnly: checked});
                          setHasChanges(true);
                        }}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Block Write Operations</Label>
                        <div className="text-sm text-muted-foreground">
                          Block write operations on indices by default
                        </div>
                      </div>
                      <Switch
                        checked={indexTemplateSettings.indexBlocksWrite}
                        onCheckedChange={(checked) => {
                          setIndexTemplateSettings({...indexTemplateSettings, indexBlocksWrite: checked});
                          setHasChanges(true);
                        }}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="monitoring" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Monitor className="h-5 w-5 mr-2" />
                    Monitoring Settings
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>X-Pack Monitoring Enabled</Label>
                        <div className="text-sm text-muted-foreground">
                          Enable cluster monitoring and metrics collection
                        </div>
                      </div>
                      <Switch
                        checked={securitySettings.xpackMonitoringEnabled}
                        onCheckedChange={(checked) => {
                          setSecuritySettings({...securitySettings, xpackMonitoringEnabled: checked});
                          setHasChanges(true);
                        }}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>X-Pack Watcher Enabled</Label>
                        <div className="text-sm text-muted-foreground">
                          Enable alerting and notification features
                        </div>
                      </div>
                      <Switch
                        checked={securitySettings.xpackWatcherEnabled}
                        onCheckedChange={(checked) => {
                          setSecuritySettings({...securitySettings, xpackWatcherEnabled: checked});
                          setHasChanges(true);
                        }}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="advanced" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Settings className="h-5 w-5 mr-2" />
                    Advanced Configuration
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-4">
                    <Label htmlFor="custom-settings">Custom Settings (JSON)</Label>
                    <Textarea
                      id="custom-settings"
                      placeholder="Enter custom Elasticsearch settings in JSON format..."
                      className="font-mono text-sm"
                      rows={12}
                    />
                    <div className="text-sm text-muted-foreground">
                      Add any custom Elasticsearch cluster settings not covered by the UI above.
                      Settings will be merged with the existing configuration.
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
