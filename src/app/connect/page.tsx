"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Toast } from "@/components/ui/toast";
import { useConnection } from "@/contexts/connection-context";
import { ElasticsearchConnectionConfig } from "@/types";
import { 
  Wifi, 
  Server, 
  CheckCircle, 
  AlertCircle, 
  Loader2,
  Eye,
  EyeOff,
  TestTube,
  Save,
  Trash2,
  Database,
  Cloud,
  Zap
} from "lucide-react";

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
  const router = useRouter();
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
      setToast({ message: "Please enter a connection name", type: "error" });
      return;
    }
    saveConnectionToContext(formData, connectionName);
    setConnectionName("");
    setToast({ message: "Connection saved successfully!", type: "success" });
  };

  const handleDeleteConnection = (id: string) => {
    deleteConnectionFromContext(id);
    setToast({ message: "Connection deleted successfully!", type: "success" });
  };

  const handleSelectConnection = async (id: string) => {
    try {
      await selectConnection(id);
      setToast({ message: "Successfully connected to saved cluster!", type: "success" });
    } catch (error) {
      setToast({ message: "Failed to connect to saved cluster", type: "error" });
    }
  };

  const handleConnect = async () => {
    try {
      await connect(formData);
      setToast({ message: "Successfully connected to cluster!", type: "success" });
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
        message: `✅ Connected successfully! Server: ${result.serverType || formData.type || 'Unknown'} ${result.version || ''}`
      });
    } catch (error: any) {
      setTestResult({
        success: false,
        message: `❌ Connection failed: ${error.message}`
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

  const handleConnectPreset = async (preset: typeof PRESET_CONNECTIONS[0]) => {
    try {
      await connect(preset);
      setToast({ message: `Connected to ${preset.name}!`, type: "success" });
    } catch (error) {
      setToast({ message: "Connection failed. Please check the server status.", type: "error" });
      console.error('Connection failed:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Header */}
          <div className="text-center space-y-4">
            <div className="flex items-center justify-center mb-4">
              <div className="relative">
                <Server className="h-16 w-16 text-primary" />
                <div className="absolute -top-1 -right-1 h-6 w-6 bg-green-500 rounded-full flex items-center justify-center">
                  <Wifi className="h-3 w-3 text-white" />
                </div>
              </div>
            </div>
            <h1 className="text-4xl font-bold tracking-tight">Connect to Your Cluster</h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Connect to Elasticsearch or OpenSearch clusters to start managing your search infrastructure
            </p>
          </div>

          {/* Connection Error Alert */}
          {connectionError && (
            <Alert className="border-destructive/50 text-destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{connectionError}</AlertDescription>
            </Alert>
          )}

          {/* Quick Development Connection */}
          <Card className="max-w-md mx-auto mb-8 border-2 border-dashed border-primary/30">
            <CardContent className="pt-6">
              <div className="text-center space-y-4">
                <div className="flex items-center justify-center">
                  <div className="w-10 h-10 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center">
                    <Zap className="h-5 w-5 text-green-600 dark:text-green-400" />
                  </div>
                </div>
                <div>
                  <h3 className="font-semibold text-lg">Quick Development Connect</h3>
                  <p className="text-sm text-muted-foreground">
                    Connect instantly to localhost:9200 for development
                  </p>
                </div>
                <Button 
                  onClick={() => handleConnectPreset({
                    name: 'Development',
                    url: 'http://localhost:9200',
                    type: 'elasticsearch',
                    description: 'Local development instance'
                  })}
                  className="w-full bg-green-600 hover:bg-green-700"
                  size="lg"
                >
                  <Zap className="h-4 w-4 mr-2" />
                  Connect to Localhost
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Main Content */}
          <Tabs defaultValue="manual" className="w-full">
            <div className="flex justify-center mb-6">
              <TabsList className="grid w-full max-w-md grid-cols-3">
                <TabsTrigger value="manual">Manual Setup</TabsTrigger>
                <TabsTrigger value="presets">Quick Connect</TabsTrigger>
                <TabsTrigger value="saved">Saved</TabsTrigger>
              </TabsList>
            </div>

            {/* Manual Setup Tab */}
            <TabsContent value="manual">
              <Card className="max-w-2xl mx-auto">
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Database className="h-5 w-5 mr-2" />
                    Manual Connection Setup
                  </CardTitle>
                  <CardDescription>
                    Configure your Elasticsearch or OpenSearch connection manually
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="connection-name">Connection Name</Label>
                      <Input
                        id="connection-name"
                        placeholder="My Cluster"
                        value={connectionName}
                        onChange={(e) => setConnectionName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="server-type">Server Type</Label>
                      <Select 
                        value={formData.type || "elasticsearch"} 
                        onValueChange={(value: "elasticsearch" | "opensearch") => setFormData({...formData, type: value})}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="elasticsearch">Elasticsearch</SelectItem>
                          <SelectItem value="opensearch">OpenSearch</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="cluster-url">Cluster URL</Label>
                    <Input
                      id="cluster-url"
                      placeholder="http://localhost:9200"
                      value={formData.url}
                      onChange={(e) => setFormData({...formData, url: e.target.value})}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="username">Username (Optional)</Label>
                      <Input
                        id="username"
                        placeholder="elastic"
                        value={formData.auth?.username || ""}
                        onChange={(e) => setFormData({
                          ...formData, 
                          auth: { ...formData.auth, username: e.target.value, password: formData.auth?.password || "" }
                        })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="password">Password (Optional)</Label>
                      <div className="relative">
                        <Input
                          id="password"
                          type={showPassword ? "text" : "password"}
                          placeholder="••••••••"
                          value={formData.auth?.password || ""}
                          onChange={(e) => setFormData({
                            ...formData, 
                            auth: { ...formData.auth, password: e.target.value, username: formData.auth?.username || "" }
                          })}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Test Result */}
                  {testResult && (
                    <Alert className={testResult.success ? "border-green-500/50 text-green-700 dark:text-green-400" : "border-destructive/50 text-destructive"}>
                      {testResult.success ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                      <AlertDescription>{testResult.message}</AlertDescription>
                    </Alert>
                  )}

                  {/* Action Buttons */}
                  <div className="flex flex-col sm:flex-row gap-3 pt-4">
                    <Button 
                      onClick={handleTest} 
                      variant="outline" 
                      disabled={!formData.url || testing}
                      className="flex-1"
                    >
                      {testing ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <TestTube className="h-4 w-4 mr-2" />
                      )}
                      Test Connection
                    </Button>
                    
                    <Button 
                      onClick={handleSaveConnection} 
                      variant="outline"
                      disabled={!formData.url || !connectionName.trim()}
                      className="flex-1"
                    >
                      <Save className="h-4 w-4 mr-2" />
                      Save Connection
                    </Button>
                    
                    <Button 
                      onClick={handleConnect} 
                      disabled={!formData.url || connecting}
                      className="flex-1"
                    >
                      {connecting ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Wifi className="h-4 w-4 mr-2" />
                      )}
                      Connect
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Presets Tab */}
            <TabsContent value="presets">
              <div className="max-w-4xl mx-auto">
                <div className="text-center mb-6">
                  <h3 className="text-lg font-semibold mb-2">Quick Connect Presets</h3>
                  <p className="text-muted-foreground">Choose from common configuration presets</p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {PRESET_CONNECTIONS.map((preset, index) => (
                    <Card key={index} className="cursor-pointer hover:shadow-lg transition-all hover:scale-[1.02]">
                      <CardContent className="p-6">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center">
                            {preset.type === "elasticsearch" ? (
                              <Database className="h-8 w-8 text-blue-500 mr-3" />
                            ) : (
                              <Cloud className="h-8 w-8 text-purple-500 mr-3" />
                            )}
                            <div>
                              <h3 className="font-semibold">{preset.name}</h3>
                              <Badge variant="outline" className="mt-1">
                                {preset.type === "elasticsearch" ? "Elasticsearch" : "OpenSearch"}
                              </Badge>
                            </div>
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground mb-4">{preset.description}</p>
                        <div className="text-xs font-mono bg-muted p-2 rounded mb-4">
                          {preset.url}
                        </div>
                        <Button 
                          onClick={() => loadPreset(preset)} 
                          className="w-full"
                          variant="outline"
                        >
                          Use This Preset
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </TabsContent>

            {/* Saved Connections Tab */}
            <TabsContent value="saved">
              <div className="max-w-2xl mx-auto">
                <div className="text-center mb-6">
                  <h3 className="text-lg font-semibold mb-2">Saved Connections</h3>
                  <p className="text-muted-foreground">Your previously saved connection configurations</p>
                </div>
                
                {savedConnections.length === 0 ? (
                  <Card>
                    <CardContent className="text-center py-12">
                      <Server className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                      <h3 className="text-lg font-semibold mb-2">No Saved Connections</h3>
                      <p className="text-muted-foreground mb-4">
                        Save connections from the Manual Setup tab to access them quickly later
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {savedConnections.map((connection) => (
                      <Card key={connection.id} className="cursor-pointer hover:shadow-lg transition-shadow">
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-3">
                              {connection.type === "elasticsearch" ? (
                                <Database className="h-5 w-5 text-blue-500" />
                              ) : (
                                <Cloud className="h-5 w-5 text-purple-500" />
                              )}
                              <div>
                                <h3 className="font-medium">{connection.name}</h3>
                                <p className="text-sm text-muted-foreground">{connection.url}</p>
                              </div>
                            </div>
                            <div className="flex items-center space-x-2">
                              <Badge variant="outline">
                                {connection.type === "elasticsearch" ? "Elasticsearch" : "OpenSearch"}
                              </Badge>
                              <Button
                                size="sm"
                                onClick={() => handleSelectConnection(connection.id)}
                                className="bg-green-600 hover:bg-green-700 text-white"
                              >
                                Connect
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => loadSavedConnection(connection)}
                              >
                                Load
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleDeleteConnection(connection.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Toast Notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
