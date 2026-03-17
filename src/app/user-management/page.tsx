"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { 
  Plus, 
  Trash2, 
  Users, 
  Shield, 
  AlertCircle, 
  CheckCircle,
  Key,
  Save,
  Loader2,
  Lock,
  RefreshCw
} from "lucide-react";

interface User {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'user' | 'readonly';
  created_at: string;
  updated_at: string;
  last_login?: string;
  is_active: boolean;
}

export default function UserManagementPage() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Show loading while auth is being checked
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  // If not authenticated, redirect will be handled by middleware
  if (!isAuthenticated) {
    return null;
  }

  // Check if user has admin access - use role instead of permissions
  const hasAdminAccess = user?.permissions?.includes('admin') || false;

  // If user doesn't have admin access, show access denied
  if (!hasAdminAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-950 dark:to-blue-950">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900">
              <Lock className="h-8 w-8 text-red-600 dark:text-red-400" />
            </div>
            <CardTitle className="text-2xl font-bold text-red-600 dark:text-red-400">
              Access Denied
            </CardTitle>
            <CardDescription className="text-lg">
              You don't have permission to access User Management
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-muted-foreground">
              This page requires administrator privileges. Contact your system administrator if you believe you should have access.
            </p>
            <div className="flex items-center justify-center space-x-2 text-sm text-muted-foreground">
              <Shield className="h-4 w-4" />
              <span>Current Role: {user?.permissions?.includes('admin') ? 'Admin' : 
                                  user?.permissions?.includes('user') ? 'User' : 'Read Only'}</span>
            </div>
            <Button 
              onClick={() => window.location.href = '/overview'} 
              className="w-full"
              variant="outline"
            >
              Go to Overview
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const [newUser, setNewUser] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
    role: "user" as 'admin' | 'user' | 'readonly'
  });

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [changePasswordUser, setChangePasswordUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [success, setSuccess] = useState("");

  // Load users on component mount, but only if authenticated
  useEffect(() => {
    console.log('useEffect triggered - isAuthenticated:', isAuthenticated, 'isLoading:', isLoading);
    if (isAuthenticated && !isLoading) {
      console.log('Calling loadUsers');
      loadUsers();
    } else {
      console.log('Skipping loadUsers - not ready');
    }
  }, [isAuthenticated, isLoading]);

  // Auto-clear success messages after 5 seconds
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => {
        setSuccess("");
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  // Auto-clear error messages after 10 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        setError("");
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const loadUsers = async () => {
    console.log('🔄 loadUsers function called');
    console.log('🔐 Current auth state - isAuthenticated:', isAuthenticated, 'isLoading:', isLoading);
    
    // Don't attempt to load users if not authenticated
    if (!isAuthenticated) {
      console.log('⏸️ Skipping user load - not authenticated');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      // Clear any existing messages
      setError("");
      setSuccess("");
      
      // Add cache-busting parameter to prevent stale data
      const timestamp = new Date().getTime();
      console.log('🌐 Making API call to /api/users with timestamp:', timestamp);
      
      const response = await fetch(`/api/users?_t=${timestamp}`, {
        cache: 'no-store',
        credentials: 'include',
        headers: {
          'Cache-Control': 'no-cache'
        }
      });
      
      if (!response.ok) {
        throw new Error('Failed to load users');
      }
      
      const data = await response.json();
      setUsers(data.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const availableRoles = [
    { id: "readonly", label: "Read Only", description: "View cluster data and indices" },
    { id: "user", label: "User", description: "Read access plus basic operations" },
    { id: "admin", label: "Administrator", description: "Full cluster administration" }
  ];

  const handleAddUser = async () => {
    setError("");
    setSuccess("");

    // Validation
    if (!newUser.username || !newUser.email || !newUser.password) {
      setError("Username, email, and password are required");
      return;
    }

    if (newUser.password !== newUser.confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (newUser.password.length < 6) {
      setError("Password must be at least 6 characters long");
      return;
    }

    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: newUser.username,
          email: newUser.email,
          password: newUser.password,
          role: newUser.role
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create user');
      }

      setNewUser({ username: "", email: "", password: "", confirmPassword: "", role: "user" });
      setShowAddDialog(false);
      setSuccess(`User "${newUser.username}" created successfully`);
      loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create user");
    }
  };

  const handleDeleteUser = async (userId: string) => {
    const user = users.find(u => u.id === userId);
    if (user && user.username === "admin") {
      setError("Cannot delete the admin user");
      return;
    }

    try {
      const response = await fetch(`/api/users/${userId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete user');
      }

      setSuccess("User deleted successfully");
      setError("");
      loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete user");
    }
  };

  const handleChangePassword = async () => {
    if (!changePasswordUser) return;

    if (newPassword !== confirmNewPassword) {
      setError("Passwords do not match");
      return;
    }

    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    try {
      const response = await fetch(`/api/users/${changePasswordUser.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          newPassword: newPassword
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to change password');
      }

      setChangePasswordUser(null);
      setNewPassword("");
      setConfirmNewPassword("");
      setShowPasswordDialog(false);
      setSuccess("Password changed successfully");
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password");
    }
  };

  return (
    <div className="space-y-6">
      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center p-8">
          <Loader2 className="h-8 w-8 animate-spin mr-2" />
          <span>Loading users...</span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">User Management</h1>
          <p className="text-muted-foreground">
            Manage users and permissions for production authentication
          </p>
        </div>
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add User
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New User</DialogTitle>
              <DialogDescription>
                Create a new user account for cluster access
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  placeholder="Enter username"
                  value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter password (min 8 characters)"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="Confirm password"
                  value={newUser.confirmPassword}
                  onChange={(e) => setNewUser({ ...newUser, confirmPassword: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  placeholder="user@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <div className="space-y-2">
                  {availableRoles.map((role) => (
                    <div key={role.id} className="flex items-center space-x-2">
                      <input
                        type="radio"
                        id={`role-${role.id}`}
                        name="role"
                        checked={newUser.role === role.id}
                        onChange={() => setNewUser({ ...newUser, role: role.id as 'admin' | 'user' | 'readonly' })}
                        className="rounded border-gray-300"
                      />
                      <label htmlFor={`role-${role.id}`} className="text-sm">
                        <span className="font-medium">{role.label}</span>
                        <span className="text-muted-foreground ml-2">{role.description}</span>
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
              <Button onClick={handleAddUser}>Create User</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Messages */}
      {error && (
        <Alert className="border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20">
          <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
          <AlertDescription className="text-red-700 dark:text-red-300">
            {error}
          </AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20">
          <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
          <AlertDescription className="text-green-700 dark:text-green-300">
            {success}
          </AlertDescription>
        </Alert>
      )}

      {/* Users Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center space-x-2">
                <Users className="h-5 w-5" />
                <span>System Users</span>
              </CardTitle>
              <CardDescription>
                Manage user accounts and their permissions
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={loadUsers}
                disabled={loading}
                title="Refresh user list"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.reload()}
                title="Hard refresh page"
              >
                Hard Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last Login</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center space-x-2">
                      <Key className="h-4 w-4 text-muted-foreground" />
                      <span>{user.username}</span>
                      {user.username === "admin" && (
                        <Badge variant="secondary">Admin</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <Badge 
                        key={user.role} 
                        variant={user.role === 'admin' ? 'default' : 'outline'} 
                        className="text-xs"
                      >
                        {user.role}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(user.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {user.last_login ? new Date(user.last_login).toLocaleDateString() : "Never"}
                  </TableCell>
                  <TableCell>
                    <div className="flex space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setChangePasswordUser(user);
                          setShowPasswordDialog(true);
                        }}
                        title="Change password"
                      >
                        <Key className="h-4 w-4" />
                      </Button>
                      {user.username !== "admin" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeleteUser(user.id)}
                          title="Delete user"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Production Note */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Shield className="h-5 w-5" />
            <span>Production Security Notes</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>Production Deployment:</strong> This user management system is for production use. 
              Passwords are hashed using bcrypt and stored securely. Users can only authenticate via Basic Authentication.
            </AlertDescription>
          </Alert>
          <div className="text-sm text-muted-foreground space-y-2">
            <p>• Passwords are automatically hashed using bcrypt with salt rounds</p>
            <p>• User sessions are managed securely with JWT tokens</p>
            <p>• Permission-based access control for different cluster operations</p>
            <p>• Admin user cannot be deleted to maintain system access</p>
          </div>
        </CardContent>
      </Card>

      {/* Change Password Dialog */}
      <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Password</DialogTitle>
            <DialogDescription>
              Change password for user: {changePasswordUser?.username}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="new-password">New Password</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
              />
            </div>
            <div>
              <Label htmlFor="confirm-new-password">Confirm New Password</Label>
              <Input
                id="confirm-new-password"
                type="password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                placeholder="Confirm new password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPasswordDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleChangePassword}>
              <Save className="h-4 w-4 mr-2" />
              Change Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
