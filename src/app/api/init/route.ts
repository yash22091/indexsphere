import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';

export async function GET(request: NextRequest) {
  try {
    const db = getDatabase();
    const users = await db.getUsers();
    
    const hasUsers = users.length > 0;
    const hasAdmin = users.some(u => u.role === 'admin');
    
    return NextResponse.json({
      initialized: hasUsers,
      hasAdmin,
      userCount: users.length,
      needsSetup: !hasUsers || !hasAdmin
    });
  } catch (error) {
    console.error('Init check error:', error);
    return NextResponse.json({
      initialized: false,
      hasAdmin: false,
      userCount: 0,
      needsSetup: true
    });
  }
}
