/** Persist drift snapshots: store a new snapshot only when the configuration changed. */
import { randomUUID } from 'crypto';
import { getDatabase } from './database-sqlite';
import { diffSnapshots, DriftSnapshotData, hashSections } from './drift';

export interface RecordResult {
  changed: boolean;
  changes: number;
  snapshotId: string;
  firstSnapshot: boolean;
}

export function recordSnapshot(connectionKey: string, label: string, takenBy: string, snap: DriftSnapshotData): RecordResult {
  const db = getDatabase();
  const hash = hashSections(snap.sections);
  const prev = db.latestSnapshot(connectionKey);
  const now = new Date().toISOString();

  if (prev && prev.hash === hash) {
    db.touchSnapshot(prev.id, now);
    return { changed: false, changes: 0, snapshotId: prev.id, firstSnapshot: false };
  }
  const changes = prev ? diffSnapshots((JSON.parse(prev.data) as DriftSnapshotData).sections, snap.sections).length : 0;
  const id = `snap-${randomUUID()}`;
  db.insertSnapshot({
    id, connection_key: connectionKey, connection_label: label, engine: snap.engine, version: snap.version,
    taken_at: now, taken_by: takenBy, hash, changes, data: JSON.stringify(snap),
  });
  return { changed: !!prev, changes, snapshotId: id, firstSnapshot: !prev };
}
