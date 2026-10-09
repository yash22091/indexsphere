/**
 * GET /api/drift/[id] — changes in this snapshot compared with the previous one
 * for the same connection. Sections with users/roles/grants are admin-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { canWrite, getUserFromRequest } from '@/lib/auth';
import { getClickHouseSession, getClusterSession } from '@/lib/cluster-session';
import { diffSnapshots, DriftSnapshotData, SENSITIVE_SECTIONS } from '@/lib/drift';
import { getDatabase, isRoleAllowedForConnection } from '@/lib/database-sqlite';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  if (!canWrite(user)) return NextResponse.json({ error: 'Configuration history is available to admins and operators' }, { status: 403 });

  const { id } = await params;
  const db = getDatabase();
  const snap = db.getSnapshot(id);
  if (!snap) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Access: saved connections by role; ad-hoc snapshots only for the connection the user is on
  if (snap.connection_key.startsWith('adhoc:')) {
    const url = snap.connection_key.slice(6);
    const mine = getClusterSession(user.id)?.url === url || getClickHouseSession(user.id)?.url === url;
    if (!mine && user.role !== 'admin') return NextResponse.json({ error: 'Not found' }, { status: 404 });
  } else {
    const conn = db.getSavedConnectionById(snap.connection_key);
    if (!conn || !isRoleAllowedForConnection(conn, user.role)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const visible = (data: DriftSnapshotData) => Object.fromEntries(
    Object.entries(data.sections).filter(([name]) => user.role === 'admin' || !SENSITIVE_SECTIONS.has(name)));
  const current = JSON.parse(snap.data) as DriftSnapshotData;
  const prev = db.previousSnapshot(snap.connection_key, snap.taken_at);
  const changes = prev ? diffSnapshots(visible(JSON.parse(prev.data)), visible(current)) : [];

  return NextResponse.json({
    snapshot: { id: snap.id, taken_at: snap.taken_at, taken_by: snap.taken_by, last_checked_at: snap.last_checked_at, engine: snap.engine, version: snap.version },
    previous: prev ? { id: prev.id, taken_at: prev.taken_at } : null,
    changes,
    sections: Object.fromEntries(Object.entries(visible(current)).map(([k, v]) => [k, Object.keys(v).length])),
    unreadable: current.notes,
    hiddenSections: user.role === 'admin' ? [] : Object.keys(current.sections).filter(n => SENSITIVE_SECTIONS.has(n)),
  });
}
