"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { BrandMark, BrandName } from "@/components/app";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";

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

      setSuccess("Password updated.");
      router.replace('/connections');
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
    if (score <= 2) return { label: "Weak", width: "33%", color: "bg-destructive" };
    if (score <= 3) return { label: "Fair", width: "66%", color: "bg-warning" };
    return { label: "Strong", width: "100%", color: "bg-success" };
  })();

  const field = (
    id: "currentPassword" | "newPassword" | "confirmPassword",
    label: string,
    show: boolean,
    toggle: () => void,
    autoComplete: string,
  ) => (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={show ? "text" : "password"}
          value={form[id]}
          onChange={e => setForm(f => ({ ...f, [id]: e.target.value }))}
          className="pr-10"
          required
          autoComplete={autoComplete}
          disabled={loading || !!success}
        />
        <button
          type="button"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onClick={toggle}
          tabIndex={-1}
          aria-label={show ? "Hide password" : "Show password"}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-svh flex-col gap-4 p-6 md:p-10">
      <div className="flex items-center gap-2.5">
        <BrandMark className="h-7 w-7" />
        <BrandName />
      </div>
      <div className="flex flex-1 items-center justify-center">
        <form onSubmit={handleSubmit} className="grid w-full max-w-sm gap-5">
          <div className="grid gap-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">Set a new password</h1>
            <p className="text-sm text-muted-foreground">
              For security, the initial password must be changed before you continue.
            </p>
          </div>

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

          {field("currentPassword", "Current password", showCurrent, () => setShowCurrent(v => !v), "current-password")}
          <div className="grid gap-2">
            {field("newPassword", "New password", showNew, () => setShowNew(v => !v), "new-password")}
            {strength ? (
              <div className="flex items-center gap-2">
                <div className="h-1 flex-1 rounded-full bg-muted">
                  <div className={`h-1 rounded-full transition-all ${strength.color}`} style={{ width: strength.width }} />
                </div>
                <span className="w-12 text-right text-xs text-muted-foreground">{strength.label}</span>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">At least 8 characters. Longer passphrases are stronger.</p>
            )}
          </div>
          <div className="grid gap-2">
            {field("confirmPassword", "Confirm new password", showConfirm, () => setShowConfirm(v => !v), "new-password")}
            {form.confirmPassword && form.newPassword !== form.confirmPassword && (
              <p className="text-xs text-destructive">Passwords don&apos;t match.</p>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={loading || !!success}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Update password
          </Button>
        </form>
      </div>
    </div>
  );
}
