/**
 * GET /api/clickhouse/access — users, roles, grants, quotas, settings profiles,
 * row policies and recent logins. Admins and operators only: this shows who can
 * do what on the server. Never returns password hashes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireClickHouseSession } from '@/lib/cluster-session';
import { chErrorResponse, chRoleDenied, runSections, type Row } from '@/lib/clickhouse-api';

export async function GET(request: NextRequest) {
  const ctx = requireClickHouseSession(request);
  if (ctx instanceof NextResponse) return ctx;
  const { user, session } = ctx;
  const denied = chRoleDenied(user.role, 'write');
  if (denied) return denied;
  const q = (sql: string) => session.client.query<Row>(sql, { role: user.role }).then(r => r.data);

  try {
    const { data, unavailable } = await runSections(q, {
      users: `SELECT name, storage, auth_type, host_ip, host_names, host_names_regexp, host_names_like,
                     default_roles_all, default_roles_list, default_database
              FROM system.users ORDER BY name`,
      roles: `SELECT name, storage FROM system.roles ORDER BY name`,
      roleGrants: `SELECT user_name, role_name, granted_role_name, with_admin_option FROM system.role_grants`,
      grants: `SELECT user_name, role_name, access_type, database, table, column, is_partial_revoke, grant_option
               FROM system.grants ORDER BY user_name, role_name, access_type LIMIT 5000`,
      quotas: `SELECT name, keys, durations, apply_to_all, apply_to_list FROM system.quotas`,
      quotaUsage: `SELECT quota_name, quota_key, duration, queries, max_queries, errors, max_errors,
                          result_rows, max_result_rows, read_rows, max_read_rows, execution_time, max_execution_time
                   FROM system.quotas_usage`,
      profiles: `SELECT profile_name, user_name, role_name, setting_name, value, min, max, writability, inherit_profile
                 FROM system.settings_profile_elements ORDER BY profile_name, user_name, role_name LIMIT 2000`,
      rowPolicies: `SELECT name, database, table, select_filter, is_restrictive, apply_to_all, apply_to_list
                    FROM system.row_policies`,
      logins: `SELECT user, type, toString(client_address) AS client_address, interface, count() AS events, max(event_time) AS last
               FROM system.session_log
               WHERE event_time > now() - INTERVAL 24 HOUR AND type IN ('LoginSuccess', 'LoginFailure')
               GROUP BY user, type, client_address, interface ORDER BY last DESC LIMIT 200`,
      current: `SELECT currentUser() AS user, currentRoles() AS roles, enabledRoles() AS enabled_roles`,
    });
    return NextResponse.json({ ...data, unavailable });
  } catch (err) {
    return chErrorResponse(err);
  }
}
