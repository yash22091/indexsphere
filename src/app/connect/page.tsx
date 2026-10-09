"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Toast } from "@/components/ui/toast";
import { useConnection } from "@/contexts/connection-context";
import { ElasticsearchConnectionConfig } from "@/types";
import Link from "next/link";
import { Wifi, CheckCircle, AlertCircle, Loader2, Eye, EyeOff, TestTube, Save, Trash2 } from "lucide-react";
import { PageHeader, StatusDot } from "@/components/app";

const PRESET_CONNECTIONS = [
  {
    name: "Local Elasticsearch",
    url: "http://localhost:9200",
    type: "elasticsearch" as const,
    description: "Standard local Elasticsearch instance"
  },
  {
    name: "Local OpenSearch",
    url: "http://localhost:9200",
    type: "opensearch" as const,
    description: "Local OpenSearch instance"
  },
  {
    name: "Docker Elasticsearch",
    url: "http://localhost:9200",
    auth: { username: "elastic", password: "changeme" },
    type: "elasticsearch" as const,
    description: "Default Docker Compose Elasticsearch setup"
  },
  {
    name: "Docker OpenSearch",
    url: "http://localhost:9200",
    auth: { username: "admin", password: "admin" },
    type: "opensearch" as const,
    description: "Default Docker Compose OpenSearch setup"
  },
  {
    name: "Elastic Cloud",
    url: "https://your-cluster.es.us-central1.gcp.cloud.es.io:9243",
    auth: { username: "elastic", password: "" },
    type: "elasticsearch" as const,
    description: "Elastic Cloud deployment"
  },
  {
    name: "AWS OpenSearch",
    url: "https://your-domain.us-east-1.es.amazonaws.com",
    type: "opensearch" as const,
    description: "AWS OpenSearch Service"
  }
];

export default function ConnectPage() {
  const { 
    connect, 
    connecting, 
    connectionError, 
    testConnection, 
    isConnected, 
    connectionConfig,
    savedConnections,
    saveConnection: saveConnectionToContext,
    deleteConnection: deleteConnectionFromContext,
    selectConnection
  } = useConnection();
  
  const [formData, setFormData] = useState<ElasticsearchConnectionConfig>({
    url: "http://localhost:9200",
    type: "elasticsearch"
  });
  const [showPassword, setShowPassword] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [toast, setToast] = useState<{message: string; type: "success" | "error"} | null>(null);
  const [connectionName, setConnectionName] = useState("");

  // Remove auto-redirect - let user choose what to do after connecting

  const handleSaveConnection = () => {
    if (!connectionName.trim()) {
      setToast({ message: "Enter a name first", type: "error" });
      return;
    }
    saveConnectionToContext(formData, connectionName);
    setConnectionName("");
    setToast({ message: "Connection saved successfully!", type: "success" });
  };

  const handleDeleteConnection = (id: string) => {
    deleteConnectionFromContext(id);
    setToast({ message: "Removed", type: "success" });
  };

  const handleSelectConnection = async (id: string) => {
    try {
      await selectConnection(id);
      setToast({ message: "Connected", type: "success" });
    } catch (error) {
      setToast({ message: "Failed to connect to saved cluster", type: "error" });
    }
  };

  const handleConnect = async () => {
    try {
      await connect(formData);
      setToast({ message: "Connected", type: "success" });
      // Don't auto-redirect - let user choose what to do
    } catch (error) {
      setToast({ message: "Connection failed. Please check your settings.", type: "error" });
      console.error('Connection failed:', error);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    
    try {
      const result = await testConnection(formData);
      setTestResult({
        success: true,
        message: `Reachable: ${result.serverType === "opensearch" ? "OpenSearch" : "Elasticsearch"} ${result.version || ''}`.trim()
      });
    } catch (error: any) {
      setTestResult({
        success: false,
        message: error.message || "Connection failed"
      });
    } finally {
      setTesting(false);
    }
  };

  const loadPreset = (preset: typeof PRESET_CONNECTIONS[0]) => {
    setFormData({
      name: preset.name,
      url: preset.url,
      auth: preset.auth,
      type: preset.type
    });
  };

  const loadSavedConnection = (connection: (typeof savedConnections)[0]) => {
    setFormData({
      url: connection.url,
      auth: connection.auth,
      type: connection.type
    });
    setConnectionName(connection.name);
  };


  const auth = formData.auth ?? { username: "", password: "" };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quick connect"
        description="Connect to an Elasticsearch or OpenSearch cluster by URL. For shared, role-based connections with stored credentials, use Connections."
        actions={<Button variant="outline" asChild><Link href="/connections">Saved connections</Link></Button>}
        meta={isConnected && connectionConfig ? (
          <Badge variant="outline" className="gap-1.5"><StatusDot status="green" />Connected to {connectionConfig.name || connectionConfig.url}</Badge>
        ) : undefined}
      />

      {connectionError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{connectionError}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Connection details</CardTitle>
            <CardDescription>The password is sent to the server once and is not stored in the browser.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4" onSubmit={e => { e.preventDefault(); handleConnect(); }}>
              <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
                <div className="grid gap-2">
                  <Label htmlFor="cluster-url">Cluster URL</Label>
                  <Input id="cluster-url" value={formData.url} onChange={e => setFormData({ ...formData, url: e.target.value })} placeholder="https://es.example.com:9200" required />
                </div>
                <div className="grid gap-2">
                  <Label>Engine</Label>
                  <Select value={formData.type || "elasticsearch"} onValueChange={v => setFormData({ ...formData, type: v as "elasticsearch" | "opensearch" })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="elasticsearch">Elasticsearch</SelectItem>
                      <SelectItem value="opensearch">OpenSearch</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="cluster-user">Username</Label>
                  <Input id="cluster-user" autoComplete="off" value={auth.username}
                    onChange={e => setFormData({ ...formData, auth: { ...auth, username: e.target.value, password: auth.password || "" } })} placeholder="Optional" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="cluster-pass">Password</Label>
                  <div className="relative">
                    <Input id="cluster-pass" type={showPassword ? "text" : "password"} autoComplete="new-password" className="pr-10" value={auth.password}
                      onChange={e => setFormData({ ...formData, auth: { ...auth, password: e.target.value, username: auth.username || "" } })} />
                    <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? "Hide password" : "Show password"}>
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {testResult && (
                <Alert variant={testResult.success ? "default" : "destructive"}>
                  {testResult.success ? <CheckCircle className="h-4 w-4 text-success" /> : <AlertCircle className="h-4 w-4" />}
                  <AlertDescription>{testResult.message}</AlertDescription>
                </Alert>
              )}

              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={connecting || !formData.url}>
                  {connecting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Wifi className="h-4 w-4 mr-1.5" />}
                  Connect
                </Button>
                <Button type="button" variant="outline" onClick={handleTest} disabled={testing || !formData.url}>
                  {testing ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <TestTube className="h-4 w-4 mr-1.5" />}
                  Test
                </Button>
              </div>

              <div className="grid gap-2 border-t pt-4">
                <Label htmlFor="remember-name">Remember in this browser</Label>
                <div className="flex gap-2">
                  <Input id="remember-name" value={connectionName} onChange={e => setConnectionName(e.target.value)} placeholder="Name, e.g. Staging" />
                  <Button type="button" variant="outline" onClick={handleSaveConnection}><Save className="h-4 w-4 mr-1.5" />Remember</Button>
                </div>
                <p className="text-xs text-muted-foreground">Stores the URL and engine only — never the password.</p>
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Remembered in this browser</CardTitle>
            </CardHeader>
            <CardContent>
              {savedConnections.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing remembered yet.</p>
              ) : (
                <ul className="divide-y">
                  {savedConnections.map(c => (
                    <li key={c.id} className="flex items-center gap-2 py-2.5">
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => loadSavedConnection(c)}>
                        <div className="truncate text-sm font-medium">{c.name}</div>
                        <div className="truncate font-mono text-xs text-muted-foreground">{c.url}</div>
                      </button>
                      <Button size="sm" variant="outline" className="h-8" onClick={() => handleSelectConnection(c.id)} disabled={connecting}>Connect</Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => handleDeleteConnection(c.id)} aria-label={`Forget ${c.name}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Templates</CardTitle>
              <CardDescription>Fill the form with common defaults.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {PRESET_CONNECTIONS.map(p => (
                  <li key={p.name}>
                    <button type="button" className="flex w-full items-center justify-between gap-2 py-2.5 text-left hover:text-foreground" onClick={() => loadPreset(p)}>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{p.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{p.description}</span>
                      </span>
                      <Badge variant="outline" className="shrink-0">{p.type === "opensearch" ? "OpenSearch" : "Elasticsearch"}</Badge>
                    </button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
