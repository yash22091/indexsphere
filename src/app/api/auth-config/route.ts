import { NextRequest, NextResponse } from 'next/server';
import { getConfig, updateConfig } from '@/lib/config';
import { requireAdmin } from '@/lib/auth';
import debugLog from '@/lib/debug';
import securityManager from '@/lib/security';

export async function GET(request: NextRequest) {
  debugLog.api.request('GET', '/api/auth-config');

  try {
    requireAdmin(request);
  } catch (errResponse) {
    return errResponse as NextResponse;
  }

  try {
    const config = getConfig();
    const stats = securityManager.getSecurityStats();
    const auditLogs = securityManager.getAuditLogs(50);

    debugLog.api.response(200, 'Auth config retrieved');

    return NextResponse.json({
      config: {
        security: {
          sessionTimeout: config.security.sessionTimeout,
          maxLoginAttempts: config.security.maxLoginAttempts,
          lockoutDuration: config.security.lockoutDuration,
          auditLogging: config.security.auditLogging,
          requireStrongPasswords: config.security.requireStrongPasswords,
        },
        debug: {
          enabled: config.debug.enabled,
          level: config.debug.level,
          components: config.debug.components,
        },
      },
      stats,
      auditLogs,
    });
  } catch (error: any) {
    debugLog.api.error('Auth config retrieval failed', { error: error.message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  debugLog.api.request('POST', '/api/auth-config');

  let adminUser;
  try {
    adminUser = requireAdmin(request);
  } catch (errResponse) {
    return errResponse as NextResponse;
  }

  try {
    const updates = await request.json();
    const currentConfig = getConfig();

    const validatedConfig: any = {
      security: { ...currentConfig.security },
      debug: { ...currentConfig.debug }
    };

    // Track what was actually changed
    const changes: any = {};

    // Validate security settings
    if (updates.security) {
      if (typeof updates.security.sessionTimeout === 'number' && 
          updates.security.sessionTimeout > 0 && 
          updates.security.sessionTimeout <= 10080) { // Max 1 week
        validatedConfig.security.sessionTimeout = updates.security.sessionTimeout;
        changes.sessionTimeout = updates.security.sessionTimeout;
      }

      if (typeof updates.security.maxLoginAttempts === 'number' && 
          updates.security.maxLoginAttempts >= 1 && 
          updates.security.maxLoginAttempts <= 20) {
        validatedConfig.security.maxLoginAttempts = updates.security.maxLoginAttempts;
        changes.maxLoginAttempts = updates.security.maxLoginAttempts;
      }

      if (typeof updates.security.lockoutDuration === 'number' && 
          updates.security.lockoutDuration >= 1 && 
          updates.security.lockoutDuration <= 1440) { // Max 24 hours
        validatedConfig.security.lockoutDuration = updates.security.lockoutDuration;
        changes.lockoutDuration = updates.security.lockoutDuration;
      }

      if (typeof updates.security.auditLogging === 'boolean') {
        validatedConfig.security.auditLogging = updates.security.auditLogging;
        changes.auditLogging = updates.security.auditLogging;
      }

      if (typeof updates.security.requireStrongPasswords === 'boolean') {
        validatedConfig.security.requireStrongPasswords = updates.security.requireStrongPasswords;
        changes.requireStrongPasswords = updates.security.requireStrongPasswords;
      }
    }

    // Validate debug settings
    if (updates.debug) {
      if (typeof updates.debug.enabled === 'boolean') {
        validatedConfig.debug.enabled = updates.debug.enabled;
        changes.debugEnabled = updates.debug.enabled;
      }

      if (['error', 'warn', 'info', 'debug', 'trace'].includes(updates.debug.level)) {
        validatedConfig.debug.level = updates.debug.level;
        changes.debugLevel = updates.debug.level;
      }

      if (updates.debug.components && typeof updates.debug.components === 'object') {
        validatedConfig.debug.components = { ...validatedConfig.debug.components };
        for (const [component, enabled] of Object.entries(updates.debug.components)) {
          if (typeof enabled === 'boolean') {
            validatedConfig.debug.components[component] = enabled;
            changes[`debug_${component}`] = enabled;
          }
        }
      }
    }

    // Actually update the configuration
    try {
      updateConfig(validatedConfig);
      
      debugLog.auth.success('Auth config saved successfully', { 
        changes, 
        adminUser: adminUser.username 
      });

      debugLog.api.response(200, 'Auth config updated and saved');

      return NextResponse.json({
        success: true,
        message: 'Configuration updated and saved successfully',
        changes,
        config: {
          security: validatedConfig.security,
          debug: validatedConfig.debug
        }
      });
      
    } catch (saveError: any) {
      debugLog.api.error('Failed to save config changes', { error: saveError.message });
      return NextResponse.json({
        success: false,
        error: 'Configuration validated but failed to save',
        details: saveError.message
      }, { status: 500 });
    }

  } catch (error: any) {
    debugLog.api.error('Auth config update failed', { error: error.message });
    return NextResponse.json(
      { error: error.message },
      { status: error.message.includes('Admin') ? 403 : 401 }
    );
  }
}

// Unlock user endpoint
export async function PATCH(request: NextRequest) {
  debugLog.api.request('PATCH', '/api/auth-config');

  try {
    requireAdmin(request);
  } catch (errResponse) {
    return errResponse as NextResponse;
  }

  try {
    const { action, username } = await request.json();

    if (action === 'unlockUser' && username) {
      const wasLocked = securityManager.unlockUser(username);
      return NextResponse.json({
        success: true,
        message: wasLocked ? `User ${username} has been unlocked` : `User ${username} was not locked`,
        wasLocked,
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    debugLog.api.error('Auth config PATCH failed', { error: error.message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
