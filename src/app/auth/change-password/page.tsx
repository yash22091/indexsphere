"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { BRAND } from "@/constants/brand";
import { ThemeToggle } from "@/components/atoms/theme-toggle";
import { KeyRound, AlertCircle, CheckCircle2, Eye, EyeOff } from "lucide-react";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [form, setForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  // Redirect to login if there's no session at all
  useEffect(() => {
    fetch('/api/auth/verify', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (!data.authenticated) router.replace('/auth');
      })
      .catch(() => router.replace('/auth'));
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (form.newPassword !== form.confirmPassword) {
      setError("New passwords don't match.");
      return;
    }
    if (form.newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (form.currentPassword === form.newPassword) {
      setError("New password must be different from the current password.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          currentPassword: form.currentPassword,
          newPassword: form.newPassword,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to change password.');
        return;
      }

      setSuccess("Password changed successfully. Redirecting…");
      setTimeout(() => router.replace('/connect'), 1500);
    } catch {
      setError("Unexpected error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const strength = (() => {
    const p = form.newPassword;
    if (!p) return null;
    let score = 0;
    if (p.length >= 8) score++;
    if (p.length >= 12) score++;
    if (/[A-Z]/.test(p)) score++;
    if (/[0-9]/.test(p)) score++;
    if (/[^A-Za-z0-9]/.test(p)) score++;
    if (score <= 2) return { label: "Weak", color: "bg-red-500" };
    if (score <= 3) return { label: "Fair", color: "bg-yellow-500" };
    return { label: "Strong", color: "bg-green-500" };
  })();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-slate-950 dark:via-blue-950 dark:to-indigo-950 flex items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm space-y-3">
        {/* Header */}
        <Card className="text-center border-slate-200 dark:border-slate-800">
          <CardHeader className="pb-2">
            <div className="mx-auto w-10 h-10 bg-gradient-to-br from-orange-500 to-red-600 rounded-full flex items-center justify-center mb-2">
              <KeyRound className="h-5 w-5 text-white" />
            </div>
            <CardTitle className="text-base">{BRAND.name}</CardTitle>
            <CardDescription className="text-sm">
              You must set a new password before continuing.
            </CardDescription>
          </CardHeader>
        </Card>

        {/* Form */}
        <Card className="border-slate-200 dark:border-slate-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Change Password</CardTitle>
            <CardDescription className="text-xs">
              The default password <code className="font-mono bg-slate-100 dark:bg-slate-800 px-1 rounded">admin</code> must be changed before you can use the application.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Current password */}
              <div className="space-y-1">
                <Label htmlFor="currentPassword" className="text-xs">Current Password</Label>
                <div className="relative">
                  <Input
                    id="currentPassword"
                    type={showCurrent ? "text" : "password"}
                    value={form.currentPassword}
                    onChange={e => setForm(f => ({ ...f, currentPassword: e.target.value }))}
                    placeholder="Enter current password"
                    className="text-sm pr-9"
                    required
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    onClick={() => setShowCurrent(v => !v)}
                    tabIndex={-1}
                  >
                    {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* New password */}
              <div className="space-y-1">
                <Label htmlFor="newPassword" className="text-xs">New Password</Label>
                <div className="relative">
                  <Input
                    id="newPassword"
                    type={showNew ? "text" : "password"}
                    value={form.newPassword}
                    onChange={e => setForm(f => ({ ...f, newPassword: e.target.value }))}
                    placeholder="At least 8 characters"
                    className="text-sm pr-9"
                    required
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    onClick={() => setShowNew(v => !v)}
                    tabIndex={-1}
                  >
                    {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {strength && (
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 h-1 rounded bg-slate-200 dark:bg-slate-700">
                      <div
                        className={`h-1 rounded transition-all ${strength.color}`}
                        style={{ width: strength.label === "Weak" ? "33%" : strength.label === "Fair" ? "66%" : "100%" }}
                      />
                    </div>
                    <span className="text-xs text-slate-500">{strength.label}</span>
                  </div>
                )}
              </div>

              {/* Confirm password */}
              <div className="space-y-1">
                <Label htmlFor="confirmPassword" className="text-xs">Confirm New Password</Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showConfirm ? "text" : "password"}
                    value={form.confirmPassword}
                    onChange={e => setForm(f => ({ ...f, confirmPassword: e.target.value }))}
                    placeholder="Repeat new password"
                    className="text-sm pr-9"
                    required
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    onClick={() => setShowConfirm(v => !v)}
                    tabIndex={-1}
                  >
                    {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {form.confirmPassword && form.newPassword !== form.confirmPassword && (
                  <p className="text-xs text-red-500 mt-1">Passwords don&apos;t match.</p>
                )}
              </div>

              {error && (
                <Alert variant="destructive" className="py-2">
                  <AlertCircle className="h-3 w-3" />
                  <AlertDescription className="text-xs ml-1">{error}</AlertDescription>
                </Alert>
              )}
              {success && (
                <Alert className="py-2 border-green-200 bg-green-50 dark:bg-green-950">
                  <CheckCircle2 className="h-3 w-3 text-green-600" />
                  <AlertDescription className="text-xs ml-1 text-green-700 dark:text-green-300">{success}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" className="w-full" disabled={loading || !!success}>
                {loading ? "Changing…" : "Set New Password"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
