"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertCircle, CheckCircle2, KeyRound, Loader2, Lock, Plus, RefreshCw, Trash2, Users } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app";

type Role = "admin" | "user" | "readonly";

interface User {
  id: string;
  username: string;
  email: string;
  role: Role;
  created_at: string;
  updated_at: string;
  last_login?: string;
  is_active: boolean;
}

const ROLES: { id: Role; label: string; description: string }[] = [
  { id: "readonly", label: "Read-only", description: "View clusters and run read-only queries." },
  { id: "user", label: "Operator", description: "Read access plus index and data operations." },
  { id: "admin", label: "Administrator", description: "Everything, including users, connections and security settings." },
];
const roleLabel = (r: Role) => ROLES.find(x => x.id === r)?.label ?? r;
const MIN_PASSWORD = 8; // enforced by the API as well

const emptyNewUser = { username: "", email: "", password: "", confirmPassword: "", role: "user" as Role };

export default function UserManagementPage() {
  // All hooks run unconditionally, before any early return
  const { user, isAuthenticated, isLoading } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [newUser, setNewUser] = useState(emptyNewUser);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [changePasswordUser, setChangePasswordUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const isAdmin = !!user?.permissions?.includes("admin");

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/users", { cache: "no-store", credentials: "include" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to load users");
      setUsers(data.users ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated && !isLoading && isAdmin) loadUsers();
  }, [isAuthenticated, isLoading, isAdmin, loadUsers]);

  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(""), 5000);
    return () => clearTimeout(t);
  }, [success]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (!isAuthenticated) return null;

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader title="Users" />
        <EmptyState
          icon={Lock}
          title="Administrator access required"
          description="Only administrators can manage users. Ask an administrator if you need access."
          action={<Button variant="outline" onClick={() => { window.location.href = "/overview"; }}>Go to overview</Button>}
        />
      </div>
    );
  }

  const handleAddUser = async () => {
    setFormError("");
    if (!newUser.username || !newUser.email || !newUser.password) {
      setFormError("Username, email and password are required.");
      return;
    }
    if (newUser.password.length < MIN_PASSWORD) {
      setFormError(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (newUser.password !== newUser.confirmPassword) {
      setFormError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newUser.username, email: newUser.email, password: newUser.password, role: newUser.role }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to create user");
      setShowAddDialog(false);
      setSuccess(`User "${newUser.username}" created.`);
      setNewUser(emptyNewUser);
      loadUsers();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteUser = async (target: User) => {
    if (!confirm(`Delete user "${target.username}"? Their sessions end immediately.`)) return;
    setPendingId(target.id);
    setError("");
    try {
      const response = await fetch(`/api/users/${target.id}`, { method: "DELETE", credentials: "include" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to delete user");
      setSuccess(`User "${target.username}" deleted.`);
      loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete user");
    } finally {
      setPendingId(null);
    }
  };

  const handleRoleChange = async (target: User, role: Role) => {
    if (role === target.role) return;
    setPendingId(target.id);
    setError("");
    try {
      const response = await fetch(`/api/users/${target.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to change role");
      setSuccess(`${target.username} is now ${roleLabel(role)}. The change applies to their open sessions immediately.`);
      loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change role");
    } finally {
      setPendingId(null);
    }
  };

  const handleChangePassword = async () => {
    if (!changePasswordUser) return;
    setFormError("");
    if (newPassword.length < MIN_PASSWORD) {
      setFormError(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setFormError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/users/${changePasswordUser.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to change password");
      setSuccess(`Password updated for ${changePasswordUser.username}.`);
      setChangePasswordUser(null);
      setNewPassword("");
      setConfirmNewPassword("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="IndexSphere accounts and their roles. Role changes and deletions take effect on open sessions immediately."
        actions={
          <>
            <Button variant="outline" onClick={loadUsers} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />Refresh
            </Button>
            <Button onClick={() => { setNewUser(emptyNewUser); setFormError(""); setShowAddDialog(true); }}>
              <Plus className="h-4 w-4 mr-1.5" />Add user
            </Button>
          </>
        }
      />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert>
          <CheckCircle2 className="h-4 w-4 text-success" />
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="pt-6">
          {loading && users.length === 0 ? (
            <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-10" />)}</div>
          ) : users.length === 0 ? (
            <EmptyState icon={Users} title="No users" description="Add the first account." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Last sign-in</TableHead>
                    <TableHead className="text-right"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map(u => {
                    const isSelf = u.id === user?.id || u.username === user?.username;
                    return (
                      <TableRow key={u.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{u.username}</span>
                            {isSelf && <Badge variant="outline">You</Badge>}
                            {!u.is_active && <Badge variant="outline" className="text-muted-foreground">Disabled</Badge>}
                          </div>
                          <div className="text-xs text-muted-foreground">{u.email}</div>
                        </TableCell>
                        <TableCell>
                          <Select value={u.role} onValueChange={v => handleRoleChange(u, v as Role)} disabled={isSelf || pendingId === u.id}>
                            <SelectTrigger className="h-8 w-40" aria-label={`Role for ${u.username}`}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {ROLES.map(r => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</TableCell>
                        <TableCell className="text-muted-foreground">{u.last_login ? new Date(u.last_login).toLocaleString() : "Never"}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="outline" size="sm" className="h-8"
                              onClick={() => { setChangePasswordUser(u); setNewPassword(""); setConfirmNewPassword(""); setFormError(""); }}>
                              <KeyRound className="h-3.5 w-3.5 mr-1.5" />Reset password
                            </Button>
                            {!isSelf && (
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                onClick={() => handleDeleteUser(u)} disabled={pendingId === u.id} aria-label={`Delete ${u.username}`}>
                                {pendingId === u.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add user</DialogTitle>
            <DialogDescription>The user signs in with this username and password.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="new-username">Username</Label>
                <Input id="new-username" autoComplete="off" value={newUser.username} onChange={e => setNewUser({ ...newUser, username: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="new-email">Email</Label>
                <Input id="new-email" type="email" value={newUser.email} onChange={e => setNewUser({ ...newUser, email: e.target.value })} placeholder="name@example.com" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="new-password">Password</Label>
                <Input id="new-password" type="password" autoComplete="new-password" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="new-confirm">Confirm password</Label>
                <Input id="new-confirm" type="password" autoComplete="new-password" value={newUser.confirmPassword} onChange={e => setNewUser({ ...newUser, confirmPassword: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Role</Label>
              <div className="grid gap-2">
                {ROLES.map(r => (
                  <label key={r.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors ${newUser.role === r.id ? "border-foreground/40 bg-muted/50" : "hover:bg-muted/30"}`}>
                    <input type="radio" name="role" className="mt-1 accent-foreground" checked={newUser.role === r.id} onChange={() => setNewUser({ ...newUser, role: r.id })} />
                    <span>
                      <span className="block font-medium">{r.label}</span>
                      <span className="block text-muted-foreground">{r.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            {formError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
            <Button onClick={handleAddUser} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}Add user</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!changePasswordUser} onOpenChange={o => { if (!o) setChangePasswordUser(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>Set a new password for {changePasswordUser?.username}.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="reset-password">New password</Label>
              <Input id="reset-password" type="password" autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
              <p className="text-xs text-muted-foreground">At least {MIN_PASSWORD} characters.</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="reset-confirm">Confirm new password</Label>
              <Input id="reset-confirm" type="password" autoComplete="new-password" value={confirmNewPassword} onChange={e => setConfirmNewPassword(e.target.value)} />
            </div>
            {formError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangePasswordUser(null)}>Cancel</Button>
            <Button onClick={handleChangePassword} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}Update password</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
