/** GET / DELETE (cancel) /api/clickhouse/migrate/jobs/[id] */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDatabase } from '@/lib/database-sqlite';
import { cancelMigrationJob } from '@/lib/migration-runner';

function load(request: NextRequest, id: string) {
  const user = getUserFromRequest(request);
  if (!user) return { error: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) };
  const job = getDatabase().getMigrationJob(id);
  if (!job || (user.role !== 'admin' && job.created_by !== user.id)) {
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  }
  return { job };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = load(request, id);
  if (r.error) return r.error;
  return NextResponse.json({ job: { ...r.job, result: r.job!.result ? JSON.parse(r.job!.result) : null } });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = load(request, id);
  if (r.error) return r.error;
  const ok = cancelMigrationJob(id);
  return NextResponse.json({ ok, message: ok ? 'Cancelling after the current batch' : 'Job is not running' });
}
