import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { getDatabase, hashPassword } from '@/lib/database';
import { getConfig } from '@/lib/config';
import { BOOT_NONCE } from '@/lib/boot-session';

export async function POST(request: NextRequest) {
  try {
    const config = getConfig();
    const token = request.cookies.get('auth-token')?.value;

    if (!token) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(token, config.security.jwtSecret) as any;
    } catch {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    if (decoded.bid !== BOOT_NONCE) {
      return NextResponse.json({ error: 'Session expired, please log in again' }, { status: 401 });
    }

    const { currentPassword, newPassword } = await request.json();

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: 'currentPassword and newPassword are required' },
        { status: 400 }
      );
    }

    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: 'New password must be at least 8 characters' },
        { status: 400 }
      );
    }

    if (currentPassword === newPassword) {
      return NextResponse.json(
        { error: 'New password must be different from the current password' },
        { status: 400 }
      );
    }

    const db = getDatabase();

    // Validate current password
    const user = await db.verifyPassword(decoded.username, currentPassword);
    if (!user) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
    }

    // Hash and persist the new password; clear the forced-change flag
    const newHash = await hashPassword(newPassword);
    await db.updateUser(user.id, {
      password_hash: newHash,
      must_change_password: false,
    } as any);

    // Issue a new JWT without mustChangePassword so the user can proceed
    const expiresInSeconds = config.security.sessionTimeout * 60;
    const newToken = jwt.sign(
      {
        userId: user.id,
        username: user.username,
        permissions: decoded.permissions,
        loginTime: Date.now(),
        sigK: decoded.sigK,
        mustChangePassword: false,
        bid: BOOT_NONCE,
      },
      config.security.jwtSecret,
      { expiresIn: expiresInSeconds }
    );

    const response = NextResponse.json({ success: true });
    response.cookies.set('auth-token', newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: expiresInSeconds,
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Change password error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
