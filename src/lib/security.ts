import debugLog from './debug';

interface LoginAttempt {
  ip: string;
  username: string;
  timestamp: number;
  success: boolean;
}

interface UserLockout {
  username: string;
  lockedUntil: number;
  attempts: number;
}

class SecurityManager {
  private static instance: SecurityManager;
  private loginAttempts: Map<string, LoginAttempt[]> = new Map();
  private userLockouts: Map<string, UserLockout> = new Map();
  private auditLogs: LoginAttempt[] = [];

  static getInstance(): SecurityManager {
    if (!SecurityManager.instance) {
      SecurityManager.instance = new SecurityManager();
    }
    return SecurityManager.instance;
  }

  private getClientKey(ip: string, username: string): string {
    return `${ip}:${username}`;
  }

  private cleanupOldAttempts(config: any): void {
    const cutoff = Date.now() - (config.security.lockoutDuration * 60 * 1000);
    
    // Clean up old attempts
    for (const [key, attempts] of this.loginAttempts.entries()) {
      const filtered = attempts.filter(attempt => attempt.timestamp > cutoff);
      if (filtered.length === 0) {
        this.loginAttempts.delete(key);
      } else {
        this.loginAttempts.set(key, filtered);
      }
    }

    // Clean up expired lockouts
    for (const [username, lockout] of this.userLockouts.entries()) {
      if (lockout.lockedUntil < Date.now()) {
        this.userLockouts.delete(username);
        debugLog.auth.success(`Lockout expired for user: ${username}`);
      }
    }
  }

  isUserLockedOut(username: string): boolean {
    const lockout = this.userLockouts.get(username);
    if (!lockout) return false;

    if (lockout.lockedUntil < Date.now()) {
      this.userLockouts.delete(username);
      return false;
    }

    return true;
  }

  getRemainingLockoutTime(username: string): number {
    const lockout = this.userLockouts.get(username);
    if (!lockout) return 0;
    
    const remaining = lockout.lockedUntil - Date.now();
    return Math.max(0, Math.ceil(remaining / 1000 / 60)); // minutes
  }

  recordLoginAttempt(
    ip: string, 
    username: string, 
    success: boolean, 
    config: any
  ): { allowed: boolean; remainingAttempts?: number; lockoutMinutes?: number } {
    
    this.cleanupOldAttempts(config);

    // Check if user is currently locked out
    if (this.isUserLockedOut(username)) {
      const remaining = this.getRemainingLockoutTime(username);
      debugLog.auth.error(`Login attempt blocked - user locked out`, {
        username,
        ip,
        remainingMinutes: remaining
      });
      
      return {
        allowed: false,
        lockoutMinutes: remaining
      };
    }

    const clientKey = this.getClientKey(ip, username);
    const attempt: LoginAttempt = {
      ip,
      username,
      timestamp: Date.now(),
      success
    };

    // Add to attempts log
    if (!this.loginAttempts.has(clientKey)) {
      this.loginAttempts.set(clientKey, []);
    }
    this.loginAttempts.get(clientKey)!.push(attempt);

    // Add to audit log if enabled
    if (config.security.auditLogging) {
      this.auditLogs.push(attempt);
      // Keep only last 1000 audit entries to prevent memory issues
      if (this.auditLogs.length > 1000) {
        this.auditLogs = this.auditLogs.slice(-1000);
      }
    }

    // If login was successful, clear attempts and return
    if (success) {
      this.loginAttempts.delete(clientKey);
      debugLog.auth.success(`Successful login recorded`, { username, ip });
      return { allowed: true };
    }

    // Count failed attempts in the lockout window
    const windowStart = Date.now() - (config.security.lockoutDuration * 60 * 1000);
    const recentAttempts = this.loginAttempts.get(clientKey)!
      .filter(a => a.timestamp > windowStart && !a.success);

    const failedCount = recentAttempts.length;
    const maxAttempts = config.security.maxLoginAttempts;
    const remaining = Math.max(0, maxAttempts - failedCount);

    debugLog.auth.error(`Failed login attempt recorded`, {
      username,
      ip,
      failedCount,
      maxAttempts,
      remaining
    });

    // Check if user should be locked out
    if (failedCount >= maxAttempts) {
      const lockoutUntil = Date.now() + (config.security.lockoutDuration * 60 * 1000);
      this.userLockouts.set(username, {
        username,
        lockedUntil: lockoutUntil,
        attempts: failedCount
      });

      debugLog.auth.error(`User locked out due to too many failed attempts`, {
        username,
        ip,
        lockoutMinutes: config.security.lockoutDuration,
        totalAttempts: failedCount
      });

      return {
        allowed: false,
        lockoutMinutes: config.security.lockoutDuration
      };
    }

    return {
      allowed: true,
      remainingAttempts: remaining
    };
  }

  getAuditLogs(limit: number = 100): LoginAttempt[] {
    return this.auditLogs.slice(-limit).reverse();
  }

  getSecurityStats(): {
    activeAttempts: number;
    lockedUsers: number;
    totalAuditLogs: number;
  } {
    return {
      activeAttempts: this.loginAttempts.size,
      lockedUsers: this.userLockouts.size,
      totalAuditLogs: this.auditLogs.length
    };
  }

  // Admin function to unlock a user
  unlockUser(username: string): boolean {
    const wasLocked = this.userLockouts.has(username);
    this.userLockouts.delete(username);
    
    // Also clear their failed attempts
    for (const key of this.loginAttempts.keys()) {
      if (key.includes(username)) {
        this.loginAttempts.delete(key);
      }
    }

    if (wasLocked) {
      debugLog.auth.success(`User manually unlocked by admin: ${username}`);
    }

    return wasLocked;
  }
}

export const securityManager = SecurityManager.getInstance();
export default securityManager;
