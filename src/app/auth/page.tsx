"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { BrandMark, BrandName } from "@/components/app";

const HIGHLIGHTS = [
  { title: "Elasticsearch, OpenSearch and ClickHouse", body: "One console for search clusters and analytical databases." },
  { title: "Advisors that explain the fix", body: "Index and table grading with the exact command to run." },
  { title: "Security built in", body: "Per-user sessions, role-based access, audit trail and CVE checks for the versions you run." },
];

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();
  // Only same-origin paths are accepted as a redirect target
  const requested = searchParams.get("redirect");
  const redirectPath = requested && requested.startsWith("/") && !requested.startsWith("//") ? requested : "/overview";

  // Already signed in (verified by the server, not just a cookie being present)? Go straight in.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/verify", { credentials: "include" })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled || !d?.authenticated) return;
        router.replace(d.user?.mustChangePassword ? "/auth/change-password" : redirectPath);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [router, redirectPath]);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await login({ username, password, authMethod: "basic" });
      router.push(redirectPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-5">
      <div className="grid gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">Enter your IndexSphere account details.</p>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-2">
        <Label htmlFor="username">Username</Label>
        <Input id="username" autoComplete="username" autoFocus required value={username}
          onChange={e => setUsername(e.target.value)} disabled={loading} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" autoComplete="current-password" required value={password}
          onChange={e => setPassword(e.target.value)} disabled={loading} />
      </div>
      <Button type="submit" className="w-full" disabled={loading || !username || !password}>
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Sign in
      </Button>
      <p className="text-xs text-muted-foreground">
        Forgot your password? Ask an IndexSphere administrator to reset it under Users.
      </p>
    </form>
  );
}

export default function AuthPage() {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex items-center gap-2.5">
          <BrandMark className="h-7 w-7" />
          <BrandName />
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">
            <Suspense fallback={<div className="flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
              <SignInForm />
            </Suspense>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Operations console for Elasticsearch, OpenSearch and ClickHouse.</p>
      </div>

      <div className="relative hidden border-l bg-muted/40 lg:flex lg:flex-col lg:justify-center lg:p-16">
        <div className="max-w-md space-y-8">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">IndexSphere</p>
            <h2 className="text-3xl font-semibold tracking-tight">Run your data platform with confidence.</h2>
          </div>
          <ul className="space-y-6">
            {HIGHLIGHTS.map(h => (
              <li key={h.title} className="flex gap-3">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground" aria-hidden />
                <div>
                  <p className="text-sm font-medium">{h.title}</p>
                  <p className="text-sm text-muted-foreground">{h.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
