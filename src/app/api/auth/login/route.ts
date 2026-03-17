import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getDatabase } from '@/lib/database';
import { getConfig } from '@/lib/config';
import debugLog from '@/lib/debug';
import securityManager from '@/lib/security';
import { BOOT_NONCE } from '@/lib/boot-session';

export async function POST(request: NextRequest) {
  const clientIP = request.headers.get('x-forwarded-for') || 
                   request.headers.get('x-real-ip') || 
                   'unknown';
  
  try {
    const { username, password } = await request.json();

    debugLog.auth.login('Login attempt started', { username, clientIP });

    if (!username || !password) {
      debugLog.auth.error('Missing credentials', { username: !!username, password: !!password });
      return NextResponse.json(
        { error: 'Username and password are required' },
        { status: 400 }
      );
    }

    const db = getDatabase();
    const config = getConfig();

    // Check if user is locked out
    if (securityManager.isUserLockedOut(username)) {
      const remainingMinutes = securityManager.getRemainingLockoutTime(username);
      debugLog.auth.error('Login blocked - user locked out', { 
        username, 
        clientIP, 
        remainingMinutes 
      });
      
      return NextResponse.json({
        error: 'Account temporarily locked due to too many failed attempts',
        lockoutMinutes: remainingMinutes
      }, { status: 423 }); // 423 Locked
    }

    // Authenticate user
    const user = await db.verifyPassword(username, password);
    
    // Record the login attempt
    const securityResult = securityManager.recordLoginAttempt(
      clientIP, 
      username, 
      !!user, 
      config
    );

    if (!user) {
      debugLog.auth.error('Invalid credentials provided', { username, clientIP });
      
      let errorMessage = 'Invalid credentials';
      if (securityResult.remainingAttempts !== undefined) {
        errorMessage += `. ${securityResult.remainingAttempts} attempts remaining.`;
      }
      if (securityResult.lockoutMinutes) {
        errorMessage = 'Too many failed attempts. Account locked.';
      }

      return NextResponse.json({
        error: errorMessage,
        remainingAttempts: securityResult.remainingAttempts,
        lockoutMinutes: securityResult.lockoutMinutes
      }, { status: 401 });
    }

    debugLog.auth.success('User authenticated successfully', { 
      username, 
      clientIP, 
      role: user.role 
    });

    // Convert role to permissions array
    const permissions = user.role === 'admin' ? ['admin', 'user', 'readonly'] : 
                      user.role === 'user' ? ['user', 'readonly'] : ['readonly'];

    // Generate a per-session signing key for HMAC request integrity checks.
    // It is embedded in the JWT (server can re-derive it) and returned in the
    // response body so the browser can store it in sessionStorage.
    const signingKey = crypto.randomBytes(32).toString('hex');

    // Generate JWT token — expiresIn as seconds (number) avoids StringValue type issues
    const expiresInSeconds = config.security.sessionTimeout * 60;
    const mustChangePassword = !!(user as any).must_change_password;
    const token = jwt.sign(
      { 
        userId: user.id, 
        username: user.username,
        permissions,
        loginTime: Date.now(),
        sigK: signingKey,
        mustChangePassword,
        bid: BOOT_NONCE,
      },
      config.security.jwtSecret,
      { expiresIn: expiresInSeconds }
    );

    debugLog.auth.success('JWT token generated', { 
      username, 
      expiresIn: `${config.security.sessionTimeout}m`,
      permissions 
    });

    // Set HTTP-only cookie
    const response = NextResponse.json({
      success: true,
      mustChangePassword,
      signingKey, // client stores this in sessionStorage for HMAC request signing
      user: {
        id: user.id,
        username: user.username,
        permissions,
        lastLogin: user.last_login,
        createdAt: user.created_at
      }
    });

    const maxAge = config.security.sessionTimeout * 60; // Convert minutes to seconds
    response.cookies.set('auth-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: maxAge,
      path: '/',
    });

    return response;

  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
