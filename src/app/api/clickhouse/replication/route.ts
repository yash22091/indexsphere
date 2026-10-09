/** GET /api/clickhouse/replication — cluster topology, replicas, replication queue, distributed DDL, Keeper. */
import { NextRequest, NextResponse } from 'next/server';
import { requireClickHouseSession } from '@/lib/cluster-session';
import { chErrorResponse, runSections, type Row } from '@/lib/clickhouse-api';

export async function GET(request: NextRequest) {
  const ctx = requireClickHouseSession(request);
  if (ctx instanceof NextResponse) return ctx;
  const { user, session } = ctx;
  const q = (sql: string) => session.client.query<Row>(sql, { role: user.role }).then(r => r.data);

  try {
    const { data, unavailable } = await runSections(q, {
      clusters: `SELECT cluster, shard_num, shard_weight, replica_num, host_name, host_address, port, is_local,
                        errors_count, slowdowns_count, estimated_recovery_time
                 FROM system.clusters ORDER BY cluster, shard_num, replica_num`,
      replicas: `SELECT database, table, engine, is_leader, is_readonly, is_session_expired, future_parts, parts_to_check,
                        queue_size, inserts_in_queue, merges_in_queue, absolute_delay, total_replicas, active_replicas,
                        replica_name, zookeeper_path
                 FROM system.replicas ORDER BY is_readonly DESC, absolute_delay DESC LIMIT 500`,
      queue: `SELECT database, table, replica_name, type, create_time, num_tries,
                     substring(last_exception, 1, 500) AS last_exception, last_attempt_time,
                     postpone_reason, new_part_name
              FROM system.replication_queue
              WHERE num_tries > 1 OR last_exception != '' OR create_time < now() - INTERVAL 10 MINUTE
              ORDER BY create_time LIMIT 200`,
      ddl: `SELECT entry, cluster, substring(query, 1, 500) AS query, query_create_time, host, status,
                   exception_code, substring(exception_text, 1, 500) AS exception_text
            FROM system.distributed_ddl_queue ORDER BY query_create_time DESC LIMIT 100`,
      distribution: `SELECT database, table, is_blocked, error_count, data_files, data_compressed_bytes,
                            broken_data_files, substring(last_exception, 1, 500) AS last_exception
                     FROM system.distribution_queue`,
      keeper: `SELECT name, host, port, connected_time, is_expired, keeper_api_version
               FROM system.zookeeper_connection`,
    });
    return NextResponse.json({ ...data, unavailable });
  } catch (err) {
    return chErrorResponse(err);
  }
}
