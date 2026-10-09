import { NextRequest, NextResponse } from 'next/server';
import { hashPassword } from '@/lib/database-sqlite';
import { getDatabase } from '@/lib/database-sqlite';
import { requireAdmin } from '@/lib/auth';
import debugLog from '@/lib/debug';

export async function GET(request: NextRequest) {
  debugLog.api.request('GET', '/api/users', {});

  try {
    // Allow ?init=true without auth (first-run probe only)
    const isInit = request.nextUrl.searchParams.get('init') === 'true';
    const db = getDatabase();
    const users = await db.getUsers();

    if (isInit) {
      return NextResponse.json({
        initialized: users.length > 0,
        hasAdmin: users.some(u => u.role === 'admin'),
      });
    }

    // First-run: no users exist yet — allow access so the setup wizard can create admin
    if (users.length === 0) {
      return NextResponse.json({ users: [], message: 'No users found. Create the first admin user.' });
    }

    // Require admin for all other GET requests
    try {
      requireAdmin(request);
    } catch (errResponse) {
      return errResponse as NextResponse;
    }

    const safeUsers = users.map(user => ({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      created_at: user.created_at,
      updated_at: user.updated_at,
      last_login: user.last_login,
      is_active: user.is_active,
    }));

    return NextResponse.json({ users: safeUsers });
  } catch (error: any) {
    console.error('Get users error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { username, email, password, role } = await request.json();

    if (!username || !email || !password || !role) {
      return NextResponse.json(
        { error: 'Username, email, password, and role are required' },
        { status: 400 }
      );
    }

    if (username.length < 3 || password.length < 8) {
      return NextResponse.json(
        { error: 'Username must be at least 3 characters and password at least 8 characters' },
        { status: 400 }
      );
    }

    if (!['admin', 'user', 'readonly'].includes(role)) {
      return NextResponse.json({ error: 'role must be admin, user or readonly' }, { status: 400 });
    }

    const db = getDatabase();
    const existingUsers = await db.getUsers();
    const isFirstUser = existingUsers.length === 0;

    // Subsequent users require admin
    if (!isFirstUser) {
      try {
        requireAdmin(request);
      } catch (errResponse) {
        return errResponse as NextResponse;
      }
    }

    const existingUser = await db.getUserByUsername(username);
    if (existingUser) {
      return NextResponse.json({ error: 'Username already exists' }, { status: 409 });
    }

    const existingEmail = await db.getUserByEmail(email);
    if (existingEmail) {
      return NextResponse.json({ error: 'Email already exists' }, { status: 409 });
    }

    const user = await db.createUser({
      username,
      email,
      password_hash: await hashPassword(password),
      role: role as 'admin' | 'user' | 'readonly',
      is_active: true,
    });

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        created_at: user.created_at,
        updated_at: user.updated_at,
        last_login: user.last_login,
        is_active: user.is_active,
      },
      isFirstUser,
    });
  } catch (error: any) {
    console.error('Create user error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
