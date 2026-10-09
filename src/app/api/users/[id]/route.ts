import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, hashPassword } from '@/lib/database-sqlite';
import { requireAdmin, getUserFromRequest } from '@/lib/auth';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    let admin;
    try {
      admin = requireAdmin(request);
    } catch (errResponse) {
      return errResponse as NextResponse;
    }

    const { id } = await params;
    if (id === admin.id) {
      return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 });
    }
    const db = getDatabase();
    const success = await db.deleteUser(id);

    if (!success) {
      return NextResponse.json({ error: 'User not found or cannot be deleted' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'User deleted successfully' });
  } catch (error: any) {
    console.error('Delete user error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = getUserFromRequest(request);
    if (!currentUser) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { id } = await params;
    const { newPassword, role } = await request.json();

    const isAdmin = currentUser.permissions.includes('admin');
    const isSelfUpdate = currentUser.id === id;

    if (role && !isAdmin) {
      return NextResponse.json({ error: 'Admin permissions required to change roles' }, { status: 403 });
    }

    if (role && !['admin', 'user', 'readonly'].includes(role)) {
      return NextResponse.json({ error: 'role must be admin, user or readonly' }, { status: 400 });
    }

    // Non-admins must use /api/auth/change-password, which verifies the current password
    if (newPassword && !isAdmin) {
      return NextResponse.json(
        { error: isSelfUpdate ? 'Use /api/auth/change-password to change your own password' : 'You can only change your own password' },
        { status: 403 },
      );
    }

    if (role && isSelfUpdate && role !== 'admin') {
      return NextResponse.json({ error: 'Admins cannot demote themselves' }, { status: 400 });
    }

    const db = getDatabase();
    const updates: Record<string, unknown> = {};

    if (newPassword) {
      if (newPassword.length < 8) {
        return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
      }
      updates.password_hash = await hashPassword(newPassword);
    }

    if (role) {
      updates.role = role;
    }

    const updatedUser = await db.updateUser(id, updates as any);
    if (!updatedUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'User updated successfully' });
  } catch (error: any) {
    console.error('Update user error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
