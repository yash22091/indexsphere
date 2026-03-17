"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Shield, Key, Settings, CheckCircle, Copy, RefreshCw,
  Eye, EyeOff, Lock, LockOpen, Bug, AlertTriangle,
} from "lucide-react";
import { writeLockState } from "@/lib/security-guardian";

export default function AuthConfigPage() {
  const [showPasswords, setShowPasswords] = useState(false);
  const [authConfig, setAuthConfig] = useState({
    basicAuth: {
      enabled: true,
      requireHttps: true,
      sessionTimeout: 3600,
      maxLoginAttempts: 5
    },
    security: {
      enforceHttps: true,
      sessionTimeout: 3600,
      rememberMe: true,
      maxConcurrentSessions: 3,
      bruteForceProtection: true,
      auditLogging: true
    }
  });

  // ── Traffic Security Lock ─────────────────────────────────────────────────
  const [secLockEnabled, setSecLockEnabled] = useState(false);
  const [secLockLoading, setSecLockLoading] = useState(false);
  const [secLockError, setSecLockError] = useState<string | null>(null);
  const [secLockSuccess, setSecLockSuccess] = useState<string | null>(null);
  // lock toggle dialog
  const [showLockDialog, setShowLockDialog] = useState(false);
  const [lockTogglePassword, setLockTogglePassword] = useState("");
  const [showLockPwd, setShowLockPwd] = useState(false);
  // regenerate debug password
  const [showRegenForm, setShowRegenForm] = useState(false);
  const [regenPassword, setRegenPassword] = useState("");
  // activate debug mode
  const [showDebugInput, setShowDebugInput] = useState(false);
  const [debugInput, setDebugInput] = useState("");
  const [debugActive, setDebugActive] = useState(false);

  useEffect(() => {
    fetch("/api/settings/security", { credentials: "include" })
      .then(r => r.json())
      .then(d => setSecLockEnabled(d.lockEnabled ?? false))
      .catch(() => {});
    if (typeof window !== "undefined") {
      const token = sessionStorage.getItem("is:debug");
      if (token) {
        try {
          const p = JSON.parse(atob(token.split(".")[1]));
          setDebugActive((p.exp ?? 0) * 1000 > Date.now());
        } catch { /**/ }
      }
    }
  }, []);

  const secPost = async (body: Record<string, string>) => {
    setSecLockLoading(true); setSecLockError(null); setSecLockSuccess(null);
    try {
      const resp = await fetch("/api/settings/security", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
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
      await secPost({ action: "setLock", enabled: String(!secLockEnabled), password: lockTogglePassword });
      const nextState = !secLockEnabled;
      setSecLockEnabled(nextState);
      // Notify SecurityGuard (in the layout) immediately via localStorage
      writeLockState(nextState);
      setSecLockSuccess(`Browser DevTools Lock ${nextState ? "enabled" : "disabled"}.`);
      setShowLockDialog(false); setLockTogglePassword("");
      setTimeout(() => setSecLockSuccess(null), 4000);
    } catch (e) { setSecLockError(e instanceof Error ? e.message : String(e)); }
  };

  const regenDebugPwd = async () => {
    try {
      await secPost({ action: "regenDebugPwd", password: regenPassword });
      setSecLockSuccess("New debug password printed to container logs — check them now.");
      setShowRegenForm(false); setRegenPassword("");
      setTimeout(() => setSecLockSuccess(null), 6000);
    } catch (e) { setSecLockError(e instanceof Error ? e.message : String(e)); }
  };

  const activateDebug = async () => {
    try {
      const data = await secPost({ action: "debugOn", debugPwd: debugInput });
      if (data.debugToken && typeof window !== "undefined") {
        sessionStorage.setItem("is:debug", data.debugToken);
        setDebugActive(true); setShowDebugInput(false); setDebugInput("");
        setSecLockSuccess("Debug mode active for 1 hour — traffic inspection enabled.");
        setTimeout(() => setSecLockSuccess(null), 5000);
      }
    } catch (e) { setSecLockError(e instanceof Error ? e.message : String(e)); }
  };

  const disableDebug = () => {
    if (typeof window !== "undefined") sessionStorage.removeItem("is:debug");
    setDebugActive(false);
    setSecLockSuccess("Debug mode disabled.");
    setTimeout(() => setSecLockSuccess(null), 3000);
  };
  // ─────────────────────────────────────────────────────────────────────────

  const handleSave = () => { console.log("Saving auth config:", authConfig); };
  const handleTest = (type: "basic") => { console.log(`Testing ${type} authentication...`); };
  const copyConfig = () => { navigator.clipboard.writeText(JSON.stringify(authConfig, null, 2)); };

  void showPasswords; // used by future password fields

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Authentication Configuration</h1>
          <p className="text-muted-foreground mt-2">
            Configure authentication methods and security settings for your Indexsphere instance
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="outline" onClick={copyConfig}>
            <Copy className="h-4 w-4 mr-2" />
            Export Config
          </Button>
          <Button onClick={handleSave}>
            <Settings className="h-4 w-4 mr-2" />
            Save Changes
          </Button>
        </div>
      </div>

      <div className="grid gap-6">
        <Tabs defaultValue="methods" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="methods">Auth Methods</TabsTrigger>
            <TabsTrigger value="security">Security</TabsTrigger>
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
          </TabsList>

          {/* Authentication Methods */}
          <TabsContent value="methods" className="space-y-6">
            {/* Basic Authentication */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Key className="h-5 w-5" />
                    <CardTitle>Basic Authentication</CardTitle>
                    <Badge variant={authConfig.basicAuth.enabled ? "default" : "secondary"}>
                      {authConfig.basicAuth.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </div>
                  <Switch
                    checked={authConfig.basicAuth.enabled}
                    onCheckedChange={(checked) => 
                      setAuthConfig(prev => ({
                        ...prev,
                        basicAuth: { ...prev.basicAuth, enabled: checked }
                      }))
                    }
                  />
                </div>
                <CardDescription>
                  HTTP Basic Authentication using username and password
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="session-timeout">Session Timeout (seconds)</Label>
                    <Input
                      id="session-timeout"
                      type="number"
                      value={authConfig.basicAuth.sessionTimeout}
                      onChange={(e) => 
                        setAuthConfig(prev => ({
                          ...prev,
                          basicAuth: { ...prev.basicAuth, sessionTimeout: parseInt(e.target.value) }
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="max-attempts">Max Login Attempts</Label>
                    <Input
                      id="max-attempts"
                      type="number"
                      value={authConfig.basicAuth.maxLoginAttempts}
                      onChange={(e) => 
                        setAuthConfig(prev => ({
                          ...prev,
                          basicAuth: { ...prev.basicAuth, maxLoginAttempts: parseInt(e.target.value) }
                        }))
                      }
                    />
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="require-https"
                    checked={authConfig.basicAuth.requireHttps}
                    onCheckedChange={(checked) => 
                      setAuthConfig(prev => ({
                        ...prev,
                        basicAuth: { ...prev.basicAuth, requireHttps: checked }
                      }))
                    }
                  />
                  <Label htmlFor="require-https">Require HTTPS</Label>
                </div>
                <div className="flex space-x-2">
                  <Button variant="outline" onClick={() => handleTest("basic")}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Test Configuration
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Security Settings */}
          <TabsContent value="security" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Shield className="h-5 w-5 mr-2" />
                  Security Settings
                </CardTitle>
                <CardDescription>
                  Configure security policies and session management
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h3 className="font-medium">Session Management</h3>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="remember-me">Allow Remember Me</Label>
                        <Switch
                          id="remember-me"
                          checked={authConfig.security.rememberMe}
                          onCheckedChange={(checked) => 
                            setAuthConfig(prev => ({
                              ...prev,
                              security: { ...prev.security, rememberMe: checked }
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="concurrent-sessions">Max Concurrent Sessions</Label>
                        <Input
                          id="concurrent-sessions"
                          type="number"
                          value={authConfig.security.maxConcurrentSessions}
                          onChange={(e) => 
                            setAuthConfig(prev => ({
                              ...prev,
                              security: { ...prev.security, maxConcurrentSessions: parseInt(e.target.value) }
                            }))
                          }
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="font-medium">Security Policies</h3>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="enforce-https">Enforce HTTPS</Label>
                        <Switch
                          id="enforce-https"
                          checked={authConfig.security.enforceHttps}
                          onCheckedChange={(checked) => 
                            setAuthConfig(prev => ({
                              ...prev,
                              security: { ...prev.security, enforceHttps: checked }
                            }))
                          }
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label htmlFor="brute-force">Brute Force Protection</Label>
                        <Switch
                          id="brute-force"
                          checked={authConfig.security.bruteForceProtection}
                          onCheckedChange={(checked) => 
                            setAuthConfig(prev => ({
                              ...prev,
                              security: { ...prev.security, bruteForceProtection: checked }
                            }))
                          }
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label htmlFor="audit-logging">Audit Logging</Label>
                        <Switch
                          id="audit-logging"
                          checked={authConfig.security.auditLogging}
                          onCheckedChange={(checked) => 
                            setAuthConfig(prev => ({
                              ...prev,
                              security: { ...prev.security, auditLogging: checked }
                            }))
                          }
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ── Traffic Security Lock ─────────────────────────────────── */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    {secLockEnabled
                      ? <Lock className="h-5 w-5 text-destructive" />
                      : <LockOpen className="h-5 w-5 text-muted-foreground" />}
                    Traffic Security Lock
                  </CardTitle>
                  <Badge variant={secLockEnabled ? "destructive" : "outline"}>
                    {secLockEnabled ? "LOCKED" : "UNLOCKED"}
                  </Badge>
                </div>
                <CardDescription>
                  Blocks browser DevTools (F12 / Ctrl+Shift+I) and shows a lockout overlay if DevTools is detected open.
                  Enable debug mode with a one-time password (from container logs) to temporarily allow inspection.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">

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

                {/* 1 — Lock toggle */}
                <div className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium text-sm">Browser DevTools Lock</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Disables F12 / right-click / Ctrl+Shift+I and shows a full-screen lockout if DevTools is open. Requires admin password to toggle.
                      </p>
                    </div>
                    <Switch
                      checked={secLockEnabled}
                      disabled={secLockLoading}
                      onCheckedChange={() => { setSecLockError(null); setShowLockDialog(true); }}
                    />
                  </div>

                  {showLockDialog && (
                    <div className="rounded-md border bg-muted/40 p-3 space-y-3">
                      <p className="text-sm font-medium">
                        {secLockEnabled ? "Disable" : "Enable"} lock — confirm with your account password:
                      </p>
                      <div className="relative">
                        <Input
                          type={showLockPwd ? "text" : "password"}
                          placeholder="Your account password"
                          value={lockTogglePassword}
                          onChange={e => setLockTogglePassword(e.target.value)}
                          className="pr-10"
                          onKeyDown={e => { if (e.key === "Enter") toggleLock(); }}
                          autoFocus
                        />
                        <button
                          type="button"
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          onClick={() => setShowLockPwd(v => !v)}
                        >
                          {showLockPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={toggleLock} disabled={secLockLoading || !lockTogglePassword}>
                          {secLockLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1" />}
                          Confirm
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => { setShowLockDialog(false); setLockTogglePassword(""); }}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* 2 — Debug unlock password */}
                <div className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium text-sm flex items-center gap-2">
                        <Bug className="h-4 w-4" />
                        Debug Unlock Password
                        <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-500">Auto-generated on first boot</Badge>
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        A random password was generated at first container startup and printed to the container logs
                        (<code className="bg-muted px-1 rounded">docker logs &lt;container&gt;</code>).
                        Save it — it is never shown again in the UI. Admins can regenerate it; new password is printed to logs.
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => { setShowRegenForm(v => !v); setSecLockError(null); }}
                    >
                      Regenerate
                    </Button>
                  </div>

                  {showRegenForm && (
                    <div className="rounded-md border bg-muted/40 p-3 space-y-2">
                      <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                        ⚠️ This invalidates the current debug password. The new one will be printed to container logs only.
                      </p>
                      <Label className="text-xs">Your account password (to confirm)</Label>
                      <Input
                        type="password"
                        placeholder="Your account password"
                        value={regenPassword}
                        onChange={e => setRegenPassword(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") regenDebugPwd(); }}
                        autoFocus
                      />
                      <div className="flex gap-2 pt-1">
                        <Button size="sm" onClick={regenDebugPwd} disabled={secLockLoading || !regenPassword}>
                          {secLockLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1" />}
                          Confirm Regenerate
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => { setShowRegenForm(false); setRegenPassword(""); }}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* 3 — Activate debug mode */}
                <div className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-medium text-sm flex items-center gap-2">
                        Debug / Inspection Mode
                        {debugActive && (
                          <Badge className="bg-amber-500 text-white text-xs animate-pulse">ACTIVE — 1hr</Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Enter the debug password from container logs to temporarily unlock traffic inspection for 1 hour.
                        When active, DevTools and browser inspection tools work normally.
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={debugActive ? "destructive" : "outline"}
                      className="shrink-0"
                      onClick={() => {
                        if (debugActive) disableDebug();
                        else { setShowDebugInput(v => !v); setSecLockError(null); }
                      }}
                    >
                      {debugActive ? "Disable Debug Mode" : "Activate Debug Mode"}
                    </Button>
                  </div>

                  {showDebugInput && !debugActive && (
                    <div className="rounded-md border bg-muted/40 p-3 space-y-2">
                      <Label className="text-xs">Debug unlock password (from container logs)</Label>
                      <div className="flex gap-2">
                        <Input
                          type="password"
                          placeholder="Paste debug password here"
                          value={debugInput}
                          onChange={e => setDebugInput(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") activateDebug(); }}
                          autoFocus
                        />
                        <Button size="sm" onClick={activateDebug} disabled={secLockLoading || !debugInput}>
                          {secLockLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : "Unlock"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

              </CardContent>
            </Card>
          </TabsContent>

          {/* Advanced Settings */}
          <TabsContent value="advanced" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Configuration Export/Import</CardTitle>
                <CardDescription>
                  Export current configuration or import from file
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="config-json">Configuration JSON</Label>
                  <Textarea
                    id="config-json"
                    rows={12}
                    value={JSON.stringify(authConfig, null, 2)}
                    onChange={(e) => {
                      try {
                        setAuthConfig(JSON.parse(e.target.value));
                      } catch (err) {
                        console.error("Invalid JSON");
                      }
                    }}
                    className="font-mono text-sm"
                  />
                </div>
                <div className="flex space-x-2">
                  <Button variant="outline" onClick={copyConfig}>
                    <Copy className="h-4 w-4 mr-2" />
                    Copy to Clipboard
                  </Button>
                  <Button variant="outline">
                    Import from File
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Alert>
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>
                Changes to authentication configuration require application restart.
                Always test configuration in a development environment first.
              </AlertDescription>
            </Alert>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
