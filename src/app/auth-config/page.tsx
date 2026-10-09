"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2, Lock, LockOpen, Save, Unlock } from "lucide-react";
import { PageHeader, SeverityBadge, StatCard } from "@/components/app";
import { writeLockState } from "@/lib/security-guardian";

interface Policy {
  sessionTimeout: number;      // minutes
  maxLoginAttempts: number;
  lockoutDuration: number;     // minutes
  auditLogging: boolean;
  requireStrongPasswords: boolean;
}
interface LoginAttempt { ip: string; username: string; timestamp: number; success: boolean }
interface Stats { activeAttempts: number; lockedUsers: number; totalAuditLogs: number }

export default function AuthConfigPage() {
  // ── Sign-in policy (server config via /api/auth-config) ────────────────
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [attempts, setAttempts] = useState<LoginAttempt[]>([]);
  const [policyLoading, setPolicyLoading] = useState(true);
  const [policySaving, setPolicySaving] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [policySaved, setPolicySaved] = useState<string | null>(null);
  const [unlockName, setUnlockName] = useState("");
  const [unlockMsg, setUnlockMsg] = useState<string | null>(null);

  const loadPolicy = async () => {
    setPolicyLoading(true); setPolicyError(null);
    try {
      const r = await fetch("/api/auth-config", { credentials: "include" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Failed to load configuration");
      const sec = d.config?.security ?? {};
      setPolicy({
        sessionTimeout: sec.sessionTimeout ?? 480,
        maxLoginAttempts: sec.maxLoginAttempts ?? 5,
        lockoutDuration: sec.lockoutDuration ?? 15,
        auditLogging: sec.auditLogging ?? true,
        requireStrongPasswords: sec.requireStrongPasswords ?? false,
      });
      setStats(d.stats ?? null);
      setAttempts(Array.isArray(d.auditLogs) ? d.auditLogs : []);
    } catch (e) { setPolicyError(e instanceof Error ? e.message : String(e)); }
    finally { setPolicyLoading(false); }
  };

  const savePolicy = async () => {
    if (!policy) return;
    setPolicySaving(true); setPolicyError(null); setPolicySaved(null);
    try {
      const r = await fetch("/api/auth-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ security: policy }),
      });
      const d = await r.json();
      if (!r.ok || d.success === false) throw new Error(d.error ?? "Failed to save");
      setPolicySaved("Sign-in policy saved. New sessions use the new timeout.");
      setTimeout(() => setPolicySaved(null), 5000);
    } catch (e) { setPolicyError(e instanceof Error ? e.message : String(e)); }
    finally { setPolicySaving(false); }
  };

  const unlockUser = async () => {
    if (!unlockName.trim()) return;
    setUnlockMsg(null);
    try {
      const r = await fetch("/api/auth-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "unlockUser", username: unlockName.trim() }),
      });
      const d = await r.json();
      setUnlockMsg(d.message ?? d.error ?? "Done");
      if (r.ok) { setUnlockName(""); loadPolicy(); }
    } catch { setUnlockMsg("Request failed"); }
  };

  useEffect(() => { loadPolicy(); }, []);

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

  const numField = (key: "sessionTimeout" | "maxLoginAttempts" | "lockoutDuration", label: string, hint: string, min: number, max: number) => (
    <div className="grid gap-2">
      <Label htmlFor={key}>{label}</Label>
      <Input id={key} type="number" min={min} max={max} value={policy?.[key] ?? ""}
        onChange={e => setPolicy(p => (p ? { ...p, [key]: Number(e.target.value) } : p))} />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Authentication"
        description="Sign-in policy, account lockouts and browser inspection controls."
        actions={
          <Button onClick={savePolicy} disabled={!policy || policySaving}>
            {policySaving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Save className="h-4 w-4 mr-1.5" />}
            Save policy
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Locked accounts" value={stats?.lockedUsers ?? "—"} tone={stats?.lockedUsers ? "warning" : "default"} />
        <StatCard label="Clients with recent attempts" value={stats?.activeAttempts ?? "—"} />
        <StatCard label="Recorded sign-in events" value={stats?.totalAuditLogs ?? "—"} hint="Kept in memory, last 1,000" />
      </div>

      {policyError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{policyError}</AlertDescription>
        </Alert>
      )}
      {policySaved && (
        <Alert>
          <CheckCircle2 className="h-4 w-4 text-success" />
          <AlertDescription>{policySaved}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sign-in policy</CardTitle>
            <CardDescription>Applies to all IndexSphere accounts.</CardDescription>
          </CardHeader>
          <CardContent>
            {policyLoading || !policy ? (
              <div className="space-y-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-14" />)}</div>
            ) : (
              <div className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  {numField("sessionTimeout", "Session length (min)", "1–10,080", 1, 10080)}
                  {numField("maxLoginAttempts", "Failed attempts", "Before lockout, 1–20", 1, 20)}
                  {numField("lockoutDuration", "Lockout (min)", "1–1,440", 1, 1440)}
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <Label htmlFor="strong-pw">Require strong passwords</Label>
                    <p className="text-xs text-muted-foreground">Enforce complexity for new passwords.</p>
                  </div>
                  <Switch id="strong-pw" checked={policy.requireStrongPasswords} onCheckedChange={v => setPolicy(p => (p ? { ...p, requireStrongPasswords: v } : p))} />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <Label htmlFor="audit-log">Audit logging</Label>
                    <p className="text-xs text-muted-foreground">Record sign-in events.</p>
                  </div>
                  <Switch id="audit-log" checked={policy.auditLogging} onCheckedChange={v => setPolicy(p => (p ? { ...p, auditLogging: v } : p))} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Unlock an account</CardTitle>
            <CardDescription>Clears a lockout caused by repeated failed sign-ins.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <form className="flex gap-2" onSubmit={e => { e.preventDefault(); unlockUser(); }}>
              <Input placeholder="Username" value={unlockName} onChange={e => setUnlockName(e.target.value)} aria-label="Username to unlock" />
              <Button type="submit" variant="outline" disabled={!unlockName.trim()}><Unlock className="h-4 w-4 mr-1.5" />Unlock</Button>
            </form>
            {unlockMsg && <p className="text-sm text-muted-foreground">{unlockMsg}</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent sign-in attempts</CardTitle>
          <CardDescription>The latest 50 attempts since the server started.</CardDescription>
        </CardHeader>
        <CardContent>
          {attempts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sign-in attempts recorded.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Username</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attempts.map((a, i) => (
                    <TableRow key={`${a.timestamp}-${i}`}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{new Date(a.timestamp).toLocaleString()}</TableCell>
                      <TableCell className="font-medium">{a.username}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{a.ip}</TableCell>
                      <TableCell><SeverityBadge level={a.success ? "ok" : "high"}>{a.success ? "Success" : "Failed"}</SeverityBadge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="flex items-center gap-2 text-base">
              {secLockEnabled ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4 text-muted-foreground" />}
              Browser inspection lock
            </CardTitle>
            <Badge variant="outline">{secLockEnabled ? "On" : "Off"}</Badge>
          </div>
          <CardDescription>
            Blocks browser developer tools for all users and signs API requests to detect tampering.
            An administrator can temporarily allow inspection with the debug password printed in the server logs.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {secLockError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{secLockError}</AlertDescription>
            </Alert>
          )}
          {secLockSuccess && (
            <Alert>
              <CheckCircle2 className="h-4 w-4 text-success" />
              <AlertDescription>{secLockSuccess}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-3 rounded-lg border p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Developer tools lock</p>
                <p className="text-xs text-muted-foreground">Requires your password to change.</p>
              </div>
              <Switch checked={secLockEnabled} disabled={secLockLoading}
                onCheckedChange={() => { setSecLockError(null); setShowLockDialog(true); }} aria-label="Developer tools lock" />
            </div>
            {showLockDialog && (
              <div className="grid gap-2 rounded-md bg-muted/50 p-3">
                <Label htmlFor="lock-pw">{secLockEnabled ? "Turn off" : "Turn on"} — confirm with your password</Label>
                <div className="relative">
                  <Input id="lock-pw" type={showLockPwd ? "text" : "password"} value={lockTogglePassword}
                    onChange={e => setLockTogglePassword(e.target.value)} className="pr-10"
                    onKeyDown={e => { if (e.key === "Enter") toggleLock(); }} autoFocus />
                  <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowLockPwd(v => !v)} aria-label={showLockPwd ? "Hide password" : "Show password"}>
                    {showLockPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={toggleLock} disabled={secLockLoading || !lockTogglePassword}>
                    {secLockLoading && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}Confirm
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setShowLockDialog(false); setLockTogglePassword(""); }}>Cancel</Button>
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-3 rounded-lg border p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Debug password</p>
                <p className="text-xs text-muted-foreground">
                  Generated on first start and printed to the server logs (<code className="font-mono">docker logs indexsphere-prod</code>). Never shown in the UI.
                </p>
              </div>
              <Button size="sm" variant="outline" className="shrink-0" onClick={() => { setShowRegenForm(v => !v); setSecLockError(null); }}>Regenerate</Button>
            </div>
            {showRegenForm && (
              <div className="grid gap-2 rounded-md bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">The current debug password stops working; the new one is printed to the server logs only.</p>
                <Label htmlFor="regen-pw">Your password</Label>
                <Input id="regen-pw" type="password" value={regenPassword} onChange={e => setRegenPassword(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") regenDebugPwd(); }} autoFocus />
                <div className="flex gap-2">
                  <Button size="sm" variant="destructive" onClick={regenDebugPwd} disabled={secLockLoading || !regenPassword}>
                    {secLockLoading && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}Regenerate
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setShowRegenForm(false); setRegenPassword(""); }}>Cancel</Button>
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-3 rounded-lg border p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="flex items-center gap-2 text-sm font-medium">
                  Inspection mode
                  {debugActive && <Badge variant="outline">Active for 1 hour</Badge>}
                </p>
                <p className="text-xs text-muted-foreground">Allows developer tools in this browser for one hour.</p>
              </div>
              <Button size="sm" variant={debugActive ? "destructive" : "outline"} className="shrink-0"
                onClick={() => { if (debugActive) disableDebug(); else { setShowDebugInput(v => !v); setSecLockError(null); } }}>
                {debugActive ? "End inspection" : "Start inspection"}
              </Button>
            </div>
            {showDebugInput && !debugActive && (
              <form className="flex gap-2" onSubmit={e => { e.preventDefault(); activateDebug(); }}>
                <Input type="password" placeholder="Debug password" value={debugInput} onChange={e => setDebugInput(e.target.value)} autoFocus aria-label="Debug password" />
                <Button type="submit" size="sm" disabled={secLockLoading || !debugInput}>
                  {secLockLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Unlock"}
                </Button>
              </form>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
