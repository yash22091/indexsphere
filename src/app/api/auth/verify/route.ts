import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { getConfig } from '@/lib/config';
import { BOOT_NONCE } from '@/lib/boot-session';

export async function GET(request: NextRequest) {
  try {
    const config = getConfig();
    const token = request.cookies.get('auth-token')?.value;

    if (!token) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    try {
      const decoded = jwt.verify(token, config.security.jwtSecret) as any;

      // Reject tokens issued by a previous process/container boot.
      if (decoded.bid !== BOOT_NONCE) {
        return NextResponse.json({ authenticated: false }, { status: 401 });
      }

      return NextResponse.json({
        authenticated: true,
        user: {
          id: decoded.userId,
          username: decoded.username,
          permissions: decoded.permissions,
          mustChangePassword: decoded.mustChangePassword ?? false,
        }
      });
    } catch (jwtError) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

  } catch (error) {
    console.error('Auth verification error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
