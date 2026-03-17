"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { storeSigningKey, clearSigningKey } from "@/lib/security-guardian";

interface AuthUser {
  id: string;
  username: string;
  authMethod: "basic";
  permissions?: string[];
  mustChangePassword?: boolean;
}

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  mustChangePassword: boolean;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => void;
  checkAuth: () => boolean;
}

interface LoginCredentials {
  username: string;
  password: string;
  authMethod: "basic";
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check authentication status on mount
    const checkAuth = async () => {
      try {
        const response = await fetch('/api/auth/verify', {
          credentials: 'include'
        });
        
        if (response.ok) {
          const data = await response.json();
          if (data.authenticated) {
            setUser({
              id: data.user.id,
              username: data.user.username,
              authMethod: "basic",
              permissions: data.user.permissions,
              mustChangePassword: data.user.mustChangePassword ?? false,
            });
          }
        }
      } catch (error) {
        console.error("Error checking authentication:", error);
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, []);

  const login = async (credentials: LoginCredentials): Promise<void> => {
    setIsLoading(true);
    
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          username: credentials.username,
          password: credentials.password
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Login failed');
      }

      const data = await response.json();
      
      if (data.success) {
        // Store the per-session signing key for HMAC request integrity checks.
        if (data.signingKey) storeSigningKey(data.signingKey);
        setUser({
          id: data.user.id,
          username: data.user.username,
          authMethod: "basic",
          permissions: data.user.permissions,
          mustChangePassword: data.mustChangePassword ?? false,
        });
      } else {
        throw new Error('Login failed');
      }
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      clearSigningKey();
      setUser(null);
    }
  };

  const checkAuth = (): boolean => {
    return !!user;
  };

  const value: AuthContextType = {
    user,
    isAuthenticated: !!user,
    isLoading,
    mustChangePassword: user?.mustChangePassword ?? false,
    login,
    logout,
    checkAuth
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

// Authentication guard component
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-950 dark:to-blue-950 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="text-slate-600 dark:text-slate-400">Checking authentication...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Redirect to auth page will be handled by middleware
    return null;
  }

  return <>{children}</>;
}
