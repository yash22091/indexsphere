"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { BRAND } from "@/constants/brand";
import { ThemeToggle } from "@/components/atoms/theme-toggle";
import { 
  Shield, 
  AlertCircle, 
  CheckCircle2,
  UserCheck
} from "lucide-react";

function AuthPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();
  
  const redirectPath = searchParams.get("redirect") || "/connect";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Basic Auth Form State
  const [basicAuth, setBasicAuth] = useState({
    username: "",
    password: "",
    remember: false
  });

  const handleBasicLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    
    try {
      await login({
        username: basicAuth.username,
        password: basicAuth.password,
        authMethod: "basic"
      });
      
      setSuccess("Authentication successful! Redirecting...");
      setTimeout(() => {
        router.push(redirectPath);
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-slate-950 dark:via-blue-950 dark:to-indigo-950 flex items-center justify-center p-4">
      {/* Theme Toggle - Top Right Corner */}
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      {/* Main Content - Centered */}
      <div className="w-full max-w-sm space-y-3">{/* Reduced max-w and spacing */}
        {/* Welcome Card */}
        <Card className="text-center border-slate-200 dark:border-slate-800">
          <CardHeader className="pb-2">{/* Reduced pb from 3 to 2 */}
            <div className="mx-auto w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center mb-2">{/* Reduced size and margin */}
              <Shield className="h-4 w-4 text-white" />{/* Reduced icon size */}
            </div>
            <CardTitle className="text-base">{BRAND.name}</CardTitle>{/* Reduced text size */}
            <CardDescription className="text-sm">
              Please authenticate to access your Elasticsearch clusters
            </CardDescription>
          </CardHeader>
        </Card>

        {/* Authentication Card */}
        <Card className="border-slate-200 dark:border-slate-800">
          <CardContent className="pt-4 pb-4">
            {/* Error/Success Messages */}
            {error && (
              <Alert className="mb-3 border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20">
                <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                <AlertDescription className="text-red-700 dark:text-red-300">
                  {error}
                </AlertDescription>
              </Alert>
            )}

            {success && (
              <Alert className="mb-3 border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20">
                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                <AlertDescription className="text-green-700 dark:text-green-300">
                  {success}
                </AlertDescription>
              </Alert>
            )}

            {/* Authentication Form */}
            <form onSubmit={handleBasicLogin} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="basic-username" className="text-sm">Username</Label>
                <Input
                  id="basic-username"
                  type="text"
                  placeholder="Enter your username"
                  value={basicAuth.username}
                  onChange={(e) => setBasicAuth({...basicAuth, username: e.target.value})}
                  required
                  disabled={loading}
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="basic-password" className="text-sm">Password</Label>
                <Input
                  id="basic-password"
                  type="password"
                  placeholder="Enter your password"
                  value={basicAuth.password}
                  onChange={(e) => setBasicAuth({...basicAuth, password: e.target.value})}
                  required
                  disabled={loading}
                  className="h-9"
                />
              </div>
              <Button 
                type="submit" 
                className="w-full h-9" 
                disabled={loading}
              >
                {loading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Authenticating...
                  </>
                ) : (
                  <>
                    <UserCheck className="h-4 w-4 mr-2" />
                    Sign In
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
        <div className="text-center">
          <Shield className="h-8 w-8 mx-auto mb-4 text-blue-600" />
          <p>Loading authentication...</p>
        </div>
      </div>
    }>
      <AuthPageContent />
    </Suspense>
  );
}
