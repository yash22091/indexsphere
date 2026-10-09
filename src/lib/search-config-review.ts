/**
 * Elasticsearch / OpenSearch configuration review — is this cluster set up
 * the way Elastic / the OpenSearch project recommend for production?
 *
 * Read-only: GET requests against cluster, node, index and snapshot APIs.
 * Each check compares a live value with the documented recommendation
 * ("Important system configuration", "Size your shards", "Disk-based shard
 * allocation", "Heap size"). A check the connected user cannot evaluate is
 * reported as skipped. Same report shape and scoring as the ClickHouse review.
 */
import type { ElasticsearchClient } from './elasticsearch';
import { Review, finalizeReview, formatSize, type ConfigReview } from './config-review';

export type SearchConfigCategory =
  | 'Version' | 'Cluster health' | 'Topology' | 'JVM & memory' | 'Operating system'
  | 'Disk & allocation' | 'Shards' | 'Indices' | 'Data lifecycle' | 'Data safety' | 'Load' | 'Deprecations';

export const SEARCH_CONFIG_CATEGORIES: SearchConfigCategory[] = [
  'Version', 'Cluster health', 'Topology', 'JVM & memory', 'Operating system', 'Disk & allocation',
  'Shards', 'Indices', 'Data lifecycle', 'Data safety', 'Load', 'Deprecations',
];

type Obj = Record<string, any>;
const GiB = 1024 ** 3;
const n = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0)) || 0;

const DOCS_ES = {
  sysconfig: 'https://www.elastic.co/docs/deploy-manage/deploy/self-managed/important-system-configuration',
  heap: 'https://www.elastic.co/docs/reference/elasticsearch/jvm-settings#set-jvm-heap-size',
  shards: 'https://www.elastic.co/docs/deploy-manage/production-guidance/optimize-performance/size-shards',
  disk: 'https://www.elastic.co/docs/reference/elasticsearch/configuration-reference/cluster-level-shard-allocation-routing-settings#disk-based-shard-allocation',
  snapshots: 'https://www.elastic.co/docs/deploy-manage/tools/snapshot-and-restore',
  ilm: 'https://www.elastic.co/docs/manage-data/lifecycle/index-lifecycle-management',
  eol: 'https://www.elastic.co/support/eol',
  masters: 'https://www.elastic.co/docs/deploy-manage/distributed-architecture/discovery-cluster-formation/modules-discovery-quorums',
};
const DOCS_OS = {
  sysconfig: 'https://docs.opensearch.org/latest/install-and-configure/install-opensearch/index/#important-settings',
  heap: 'https://docs.opensearch.org/latest/install-and-configure/install-opensearch/index/#important-settings',
  shards: 'https://docs.opensearch.org/latest/tuning-your-cluster/performance/',
  disk: 'https://docs.opensearch.org/latest/install-and-configure/configuring-opensearch/cluster-settings/',
  snapshots: 'https://docs.opensearch.org/latest/tuning-your-cluster/availability-and-recovery/snapshots/index/',
  ilm: 'https://docs.opensearch.org/latest/im-plugin/ism/index/',
  eol: 'https://opensearch.org/releases/',
  masters: 'https://docs.opensearch.org/latest/tuning-your-cluster/',
};

/** "85%" → 0.85; "500mb" etc. (absolute) → null. */
function pct(v: unknown): number | null {
  const m = String(v ?? '').trim().match(/^([\d.]+)\s*%$/);
  return m ? Number(m[1]) / 100 : null;
}

/** Absolute watermark ("1gb", "500mb") → bytes of free space it requires; percentages → null. */
function absBytes(v: unknown): number | null {
  const m = String(v ?? '').trim().toLowerCase().match(/^([\d.]+)\s*(b|kb|mb|gb|tb|pb)$/);
  if (!m) return null;
  return Number(m[1]) * 1024 ** ['b', 'kb', 'mb', 'gb', 'tb', 'pb'].indexOf(m[2]);
}

/** Whether a node is past a watermark: percentages compare used ratio, absolute values compare free bytes. */
function past(mark: unknown, fallback: number, used: number, freeBytes: number): boolean {
  const abs = absBytes(mark);
  if (abs !== null) return freeBytes < abs;
  return used >= (pct(mark) ?? fallback);
}

/**
 * Support status of a release line. Elastic supports the latest minor of the
 * current and previous major; OpenSearch maintains the current major and puts
 * the previous one in maintenance.
 */
export function searchVersionSupport(distribution: 'elasticsearch' | 'opensearch', version: string):
  { status: 'current' | 'maintenance' | 'eol'; note: string } {
  const [major, minor] = version.split('.').map(Number);
  if (distribution === 'opensearch') {
    if (major >= 3) return { status: 'current', note: 'current major' };
    if (major === 2) return { status: 'maintenance', note: '2.x is in maintenance; new features and most fixes land in 3.x' };
    return { status: 'eol', note: `${major}.x is end of life` };
  }
  if (major >= 9) return { status: 'current', note: 'current major' };
  if (major === 8) return minor >= 19 ? { status: 'current', note: 'latest 8.x minor' } : { status: 'maintenance', note: 'only the latest 8.x minor (8.19) receives fixes' };
  if (major === 7 && minor >= 17) return { status: 'eol', note: '7.17 reached end of life in January 2026' };
  return { status: 'eol', note: `${major}.${minor} is end of life` };
}

export async function reviewSearchConfig(client: ElasticsearchClient, url: string): Promise<ConfigReview> {
  const r = new Review<SearchConfigCategory>();
  const get = async <T = Obj>(path: string): Promise<T | null> => {
    try { return await client.request(path) as T; } catch { return null; }
  };

  const info = await client.getClusterInfo() as Obj;
  const isOS = info.version?.distribution === 'opensearch';
  const distribution = isOS ? 'opensearch' : 'elasticsearch';
  const version = String(info.version?.number ?? 'unknown');
  const D = isOS ? DOCS_OS : DOCS_ES;
  const masterWord = isOS ? 'cluster-manager' : 'master';

  const [health, nodesInfo, nodesStats, settings, shards, indices, blocks, lifecycle, repos, deprecations] = await Promise.all([
    get('/_cluster/health'),
    get('/_nodes?filter_path=nodes.*.name,nodes.*.version,nodes.*.roles,nodes.*.jvm.mem,nodes.*.jvm.using_compressed_ordinary_object_pointers,nodes.*.process.mlockall'),
    get('/_nodes/stats/jvm,os,fs,process,thread_pool,breaker?filter_path=nodes.*.name,nodes.*.roles,nodes.*.jvm.mem.heap_used_percent,nodes.*.jvm.mem.heap_max_in_bytes,nodes.*.os.mem.total_in_bytes,nodes.*.os.swap,nodes.*.process.max_file_descriptors,nodes.*.fs.total,nodes.*.thread_pool.write.rejected,nodes.*.thread_pool.search.rejected,nodes.*.breakers.*.tripped'),
    get('/_cluster/settings?include_defaults=true&flat_settings=true'),
    get<Obj[]>('/_cat/shards?format=json&bytes=b&h=index,shard,prirep,state,store,node'),
    get<Obj[]>('/_cat/indices?format=json&bytes=b&h=index,health,status,pri,rep,pri.store.size,creation.date.string&expand_wildcards=open'),
    get('/_all/_settings/index.blocks.*?flat_settings=true&expand_wildcards=open'),
    isOS ? get('/_plugins/_ism/explain/*') : get('/_all/_settings/index.lifecycle.name?flat_settings=true&expand_wildcards=open'),
    get('/_snapshot'),
    isOS ? Promise.resolve(null) : get('/_migration/deprecations'),
  ]);

  const nodes: Obj[] = Object.values(nodesInfo?.nodes ?? {});
  const stats: Obj[] = Object.values(nodesStats?.nodes ?? {});
  const setting = (key: string): unknown =>
    settings?.transient?.[key] ?? settings?.persistent?.[key] ?? settings?.defaults?.[key];
  const isData = (roles: string[] = []) => roles.some(x => x === 'data' || x.startsWith('data_'));
  const isMaster = (roles: string[] = []) => roles.includes('master') || roles.includes('cluster_manager');
  const dataNodes = nodes.filter(x => isData(x.roles));
  const masterNodes = nodes.filter(x => isMaster(x.roles));
  const userIndex = (name: string) => !name.startsWith('.');

  // ── Version ──────────────────────────────────────────────────────────────
  {
    const v = searchVersionSupport(distribution, version);
    const base = { id: 'es-version-support', category: 'Version' as const, title: 'Release line is supported',
      current: `${isOS ? 'OpenSearch' : 'Elasticsearch'} ${version} — ${v.note}`,
      recommended: isOS ? 'Latest 3.x release' : 'Latest 9.x release, or 8.19.x', reference: D.eol };
    if (v.status === 'eol') r.fail({ ...base, severity: 'high', detail: 'This release line no longer receives security or bug fixes.', remediation: 'Plan an upgrade to a supported release. Check the Vulnerabilities page for CVEs affecting this version.' });
    else if (v.status === 'maintenance') r.fail({ ...base, severity: 'low', detail: 'Only critical fixes are back-ported to this line.', remediation: 'Upgrade to the latest release of the current major.' });
    else r.pass(base);
  }
  if (nodes.length) {
    const versions = [...new Set(nodes.map(x => String(x.version)))];
    const base = { id: 'es-mixed-versions', category: 'Version' as const, title: 'All nodes run the same version',
      current: versions.join(', '), recommended: 'one version (mixed only during a rolling upgrade)', reference: D.eol };
    if (versions.length > 1) r.fail({ ...base, severity: 'medium', detail: 'Mixed versions restrict shard allocation (shards cannot move to older nodes) and some features.', remediation: 'Finish the rolling upgrade.' });
    else r.pass(base);
  } else {
    r.skip({ id: 'es-mixed-versions', category: 'Version', title: 'All nodes run the same version', detail: 'Nodes info API is not readable by this user' });
  }

  // ── Cluster health ───────────────────────────────────────────────────────
  if (!health) {
    r.skip({ id: 'es-health', category: 'Cluster health', title: 'Cluster status', detail: 'Cluster health API is not readable' });
  } else {
    const status = String(health.status);
    const base = { id: 'es-health', category: 'Cluster health' as const, title: 'Cluster status is green',
      current: `${status}${n(health.unassigned_shards) ? `, ${n(health.unassigned_shards)} unassigned shards` : ''}`, recommended: 'green' };
    if (status === 'red') r.fail({ ...base, severity: 'critical', detail: 'At least one primary shard is unassigned: some data cannot be searched or written.', remediation: 'Open the Shards page to see why each shard is unassigned.' });
    else if (status === 'yellow') r.fail({ ...base, severity: 'medium', detail: 'Some replica shards are unassigned, so a node failure can lose data availability.', remediation: dataNodes.length === 1 ? 'Single data node: set number_of_replicas to 0, or add a node.' : 'Open the Shards page to see why replicas are unassigned.' });
    else r.pass(base);

    const pending = n(health.number_of_pending_tasks);
    const pbase = { id: 'es-pending-tasks', category: 'Cluster health' as const, title: `The ${masterWord} keeps up with cluster changes`,
      current: `${pending} pending cluster tasks`, recommended: 'close to 0' };
    if (pending > 50) r.fail({ ...pbase, severity: 'medium', detail: `The elected ${masterWord} is falling behind — often too many shards, mapping updates or index creations.`, remediation: 'Reduce shard count and dynamic mapping updates; consider dedicated nodes.' });
    else r.pass(pbase);
  }

  // ── Topology ─────────────────────────────────────────────────────────────
  if (!nodes.length) {
    r.skip({ id: 'es-master-quorum', category: 'Topology', title: `${masterWord} quorum`, detail: 'Nodes info API is not readable by this user' });
  } else if (nodes.length === 1) {
    r.fail({ id: 'es-master-quorum', category: 'Topology', title: 'Cluster survives a node failure', severity: 'info',
      current: 'single node', recommended: `≥ 3 ${masterWord}-eligible nodes for production`, reference: D.masters,
      detail: 'A single-node cluster has no redundancy: losing the node means downtime and restoring from snapshot.',
      remediation: `Run three ${masterWord}-eligible nodes and at least two data nodes.` });
  } else {
    const base = { id: 'es-master-quorum', category: 'Topology' as const, title: `Enough ${masterWord}-eligible nodes for a quorum`,
      current: `${masterNodes.length} ${masterWord}-eligible of ${nodes.length} nodes`, recommended: `≥ 3 ${masterWord}-eligible nodes`, reference: D.masters };
    if (masterNodes.length < 3) r.fail({ ...base, severity: 'high', detail: `With fewer than three ${masterWord}-eligible nodes, losing one can stop the cluster from electing a ${masterWord}.`, remediation: `Give three nodes the ${masterWord} role.` });
    else r.pass(base);

    const dedicated = masterNodes.filter(x => !isData(x.roles));
    const dbase = { id: 'es-dedicated-masters', category: 'Topology' as const, title: `Large clusters use dedicated ${masterWord} nodes`,
      current: `${dedicated.length} dedicated, ${dataNodes.length} data nodes`, recommended: `3 dedicated ${masterWord} nodes when there are 6+ data nodes`, reference: D.masters };
    if (dataNodes.length >= 6 && dedicated.length < 3) r.fail({ ...dbase, severity: 'low', detail: `Busy data nodes doing ${masterWord} work can delay cluster-state updates and destabilise the cluster.`, remediation: `Add three small nodes with only the ${masterWord} role.` });
    else r.pass(dbase);
  }

  // ── JVM & memory ─────────────────────────────────────────────────────────
  if (!nodes.length || !stats.length) {
    r.skip({ id: 'es-heap-size', category: 'JVM & memory', title: 'Heap size', detail: 'Node info/stats are not readable by this user' });
  } else {
    const ramByName = new Map(stats.map(x => [x.name, n(x.os?.mem?.total_in_bytes)]));
    const big = nodes.filter(x => n(x.jvm?.mem?.heap_max_in_bytes) > 31 * GiB || x.jvm?.using_compressed_ordinary_object_pointers === 'false');
    const heaps = [...new Set(nodes.map(x => formatSize(n(x.jvm?.mem?.heap_max_in_bytes))))];
    const base = { id: 'es-heap-oops', category: 'JVM & memory' as const, title: 'Heap stays below the compressed-pointers limit',
      current: `heap ${heaps.join(', ')}`, recommended: '≤ 31 GiB with compressed oops', reference: D.heap };
    if (big.length) r.fail({ ...base, severity: 'medium', detail: 'Above ~31 GiB the JVM switches to 64-bit pointers, so a bigger heap holds less and GC gets slower.', remediation: '-Xms31g -Xmx31g (or less) in jvm.options.d/heap.options' });
    else r.pass(base);

    const overHalf = nodes.filter(x => { const ram = ramByName.get(x.name) ?? 0; return ram && n(x.jvm?.mem?.heap_max_in_bytes) > ram * 0.5; });
    const ratios = nodes.map(x => { const ram = ramByName.get(x.name) ?? 0; return ram ? Math.round((n(x.jvm?.mem?.heap_max_in_bytes) / ram) * 100) : 0; });
    const rbase = { id: 'es-heap-ratio', category: 'JVM & memory' as const, title: 'Heap leaves half of RAM for the file-system cache',
      current: `heap = ${[...new Set(ratios)].join('%, ')}% of RAM`, recommended: '≤ 50% of RAM', reference: D.heap };
    if (overHalf.length) r.fail({ ...rbase, severity: 'medium', detail: 'Lucene relies on the OS page cache; a heap above half of RAM starves it and slows searches.', remediation: 'Set -Xms/-Xmx to at most 50% of the machine\'s memory.' });
    else r.pass(rbase);

    const uneven = nodes.filter(x => n(x.jvm?.mem?.heap_init_in_bytes) !== n(x.jvm?.mem?.heap_max_in_bytes));
    const ubase = { id: 'es-heap-min-max', category: 'JVM & memory' as const, title: 'Initial and maximum heap are equal',
      current: uneven.length ? `${uneven.length} node(s) differ` : 'equal on all nodes', recommended: 'Xms = Xmx', reference: D.heap };
    if (uneven.length) r.fail({ ...ubase, severity: 'low', detail: 'Heap resizing at runtime causes pauses.', remediation: 'Set -Xms and -Xmx to the same value.' });
    else r.pass(ubase);

    const hot = stats.filter(x => n(x.jvm?.mem?.heap_used_percent) > 85);
    const hbase = { id: 'es-heap-pressure', category: 'JVM & memory' as const, title: 'Heap usage is healthy',
      current: `max ${Math.max(...stats.map(x => n(x.jvm?.mem?.heap_used_percent)))}% used`, recommended: '< 75% sustained' };
    if (hot.length) r.fail({ ...hbase, severity: 'medium', detail: 'Sustained heap above 85% leads to long GC pauses and circuit-breaker errors.', remediation: 'Reduce shard count, field data and large aggregations, or add memory/nodes.' });
    else r.pass(hbase);
  }

  // ── Operating system ─────────────────────────────────────────────────────
  if (!stats.length) {
    r.skip({ id: 'es-swap', category: 'Operating system', title: 'Swapping disabled', detail: 'Node stats are not readable by this user' });
  } else {
    const lockByName = new Map(nodes.map(x => [x.name, x.process?.mlockall === true]));
    const swapping = stats.filter(x => n(x.os?.swap?.total_in_bytes) > 0 && !lockByName.get(x.name));
    const used = Math.max(...stats.map(x => n(x.os?.swap?.used_in_bytes)));
    const base = { id: 'es-swap', category: 'Operating system' as const, title: 'The JVM cannot be swapped out',
      current: swapping.length ? `swap enabled, memory lock off (${formatSize(used)} swap in use)` : 'swap off or memory locked',
      recommended: 'swapoff -a, or bootstrap.memory_lock: true', reference: D.sysconfig };
    if (swapping.length) r.fail({ ...base, severity: 'medium', detail: 'If the heap is swapped out, GC pauses go from milliseconds to minutes and nodes drop out of the cluster.', remediation: 'Disable swap (swapoff -a, vm.swappiness=1) or set bootstrap.memory_lock: true.' });
    else r.pass(base);

    const fds = stats.map(x => n(x.process?.max_file_descriptors)).filter(Boolean);
    const fbase = { id: 'es-file-descriptors', category: 'Operating system' as const, title: 'File-descriptor limit is high enough',
      current: fds.length ? `min ${Math.min(...fds)}` : 'unknown', recommended: '≥ 65535', reference: D.sysconfig };
    if (fds.length && Math.min(...fds) < 65535) r.fail({ ...fbase, severity: 'high', detail: 'Running out of file descriptors can corrupt indices and crash nodes.', remediation: 'ulimit -n 65535 (LimitNOFILE=65535 in the systemd unit).' });
    else if (fds.length) r.pass(fbase);
    else r.skip({ id: 'es-file-descriptors', category: 'Operating system', title: 'File-descriptor limit', detail: 'Not reported' });
  }

  // ── Disk & allocation ────────────────────────────────────────────────────
  if (!settings) {
    r.skip({ id: 'es-disk-watermarks', category: 'Disk & allocation', title: 'Disk watermarks', detail: 'Cluster settings are not readable by this user' });
  } else {
    const enabled = String(setting('cluster.routing.allocation.disk.threshold_enabled')) !== 'false';
    const low = setting('cluster.routing.allocation.disk.watermark.low');
    const high = setting('cluster.routing.allocation.disk.watermark.high');
    const flood = setting('cluster.routing.allocation.disk.watermark.flood_stage');
    const base = { id: 'es-disk-watermarks', category: 'Disk & allocation' as const, title: 'Disk watermarks protect against full disks',
      current: enabled ? `low ${low}, high ${high}, flood ${flood}` : 'disk threshold disabled',
      recommended: 'enabled; defaults 85% / 90% / 95%', reference: D.disk };
    if (!enabled) r.fail({ ...base, severity: 'high', detail: 'Without watermarks shards are allocated until disks are full, which can corrupt shards.', remediation: 'PUT _cluster/settings {"persistent":{"cluster.routing.allocation.disk.threshold_enabled":null}}' });
    else if ((pct(flood) ?? 0) > 0.97 || (pct(high) ?? 0) > 0.95) r.fail({ ...base, severity: 'medium', detail: 'Watermarks this close to 100% leave no room for merges and recoveries.', remediation: 'Reset the watermarks to their defaults and add disk capacity instead.' });
    else r.pass(base);

    const alloc = String(setting('cluster.routing.allocation.enable') ?? 'all');
    const abase = { id: 'es-allocation-enabled', category: 'Disk & allocation' as const, title: 'Shard allocation is enabled',
      current: alloc, recommended: 'all (restrict only during maintenance)', reference: D.disk };
    if (alloc !== 'all') r.fail({ ...abase, severity: 'medium', detail: 'Allocation is restricted — often left over from a rolling restart. Replicas will not be rebuilt after a node failure.', remediation: 'PUT _cluster/settings {"persistent":{"cluster.routing.allocation.enable":null}}' });
    else r.pass(abase);

    if (stats.length) {
      const used = stats.map(x => {
        const t = n(x.fs?.total?.total_in_bytes);
        const free = n(x.fs?.total?.available_in_bytes);
        return { name: String(x.name), used: t ? 1 - free / t : 0, free };
      }).sort((a, b) => b.used - a.used);
      const w = used[0];
      const level = (node: typeof w) => past(flood, 0.95, node.used, node.free) ? 3 : past(high, 0.9, node.used, node.free) ? 2 : past(low, 0.85, node.used, node.free) ? 1 : 0;
      const worst = used.reduce((a, x) => (level(x) > level(a) ? x : a), w);
      const lv = level(worst);
      const ubase = { id: 'es-disk-usage', category: 'Disk & allocation' as const, title: 'Disk usage is below the low watermark',
        current: `${worst.name}: ${Math.round(worst.used * 100)}% used, ${formatSize(worst.free)} free`, recommended: `below the low watermark (${low})`, reference: D.disk };
      if (lv === 3) r.fail({ ...ubase, severity: 'critical', detail: 'Flood stage: indices on this node are made read-only.', remediation: 'Free space or add capacity; then remove the read-only block.' });
      else if (lv === 2) r.fail({ ...ubase, severity: 'high', detail: 'Above the high watermark shards are moved away from this node.', remediation: 'Free space, delete old indices or add nodes.' });
      else if (lv === 1) r.fail({ ...ubase, severity: 'medium', detail: 'Above the low watermark no new shards are allocated to this node.', remediation: 'Plan capacity: delete or shrink old indices, or add nodes.' });
      else r.pass(ubase);
    }
  }

  if (blocks) {
    const ro = Object.entries(blocks as Obj)
      .filter(([, v]) => String(v?.settings?.['index.blocks.read_only_allow_delete']) === 'true')
      .map(([k]) => k);
    const base = { id: 'es-read-only-indices', category: 'Disk & allocation' as const, title: 'No indices blocked by the flood-stage watermark',
      current: ro.length ? `${ro.length}: ${ro.slice(0, 5).join(', ')}` : 'none', recommended: 'none', reference: D.disk };
    if (ro.length) r.fail({ ...base, severity: 'high', detail: 'These indices reject writes because a disk reached the flood stage.', remediation: 'Free disk space; the block is released automatically on recent versions, otherwise PUT <index>/_settings {"index.blocks.read_only_allow_delete":null}' });
    else r.pass(base);
  }

  // ── Shards ───────────────────────────────────────────────────────────────
  if (!shards) {
    r.skip({ id: 'es-shard-size', category: 'Shards', title: 'Shard sizes', detail: '_cat/shards is not readable by this user' });
  } else {
    const prim = shards.filter(x => x.prirep === 'p' && x.state === 'STARTED');
    const huge = prim.filter(x => n(x.store) > 50 * GiB);
    const base = { id: 'es-shard-size', category: 'Shards' as const, title: 'Shards are not too large',
      current: huge.length ? `${huge.length} shards over 50 GiB (largest ${formatSize(Math.max(...huge.map(x => n(x.store))))})` : `largest ${formatSize(Math.max(0, ...prim.map(x => n(x.store))))}`,
      recommended: '10–50 GiB per shard', reference: D.shards };
    if (huge.length) r.fail({ ...base, severity: 'medium', detail: 'Very large shards make recovery and rebalancing slow after a node failure.', remediation: 'Use rollover (ILM/ISM) with max_primary_shard_size: 50gb, or split the index.' });
    else r.pass(base);

    const userPrim = prim.filter(x => userIndex(String(x.index)));
    const tiny = userPrim.filter(x => n(x.store) < GiB);
    const sbase = { id: 'es-oversharding', category: 'Shards' as const, title: 'Data is not spread over many tiny shards',
      current: `${tiny.length} of ${userPrim.length} primary shards are under 1 GiB`, recommended: 'few shards of 10–50 GiB rather than many small ones', reference: D.shards };
    const perNode = userPrim.length / Math.max(1, dataNodes.length || 1);
    if (userPrim.length > 100 && tiny.length / userPrim.length > 0.8 && perNode > 50) {
      r.fail({ ...sbase, severity: 'low', detail: 'Every shard costs heap, file handles and cluster-state updates regardless of its size.', remediation: 'Use 1 primary shard for small indices, roll over by size, and merge small daily indices into weekly/monthly ones.' });
    } else r.pass(sbase);

    const limit = n(setting('cluster.max_shards_per_node')) || 1000;
    const total = shards.length;
    const capacity = limit * Math.max(1, dataNodes.length || 1);
    const lbase = { id: 'es-shard-limit', category: 'Shards' as const, title: 'Shard count is well below the cluster limit',
      current: `${total} shards / limit ${capacity} (${limit} per data node)`, recommended: '< 80% of cluster.max_shards_per_node × data nodes', reference: D.shards };
    if (total > capacity * 0.8) r.fail({ ...lbase, severity: total >= capacity ? 'high' : 'medium', detail: 'When the limit is reached, creating indices (including rollover) fails.', remediation: 'Delete or shrink old indices and reduce shards per index — do not just raise the limit.' });
    else r.pass(lbase);
  }

  // ── Indices ──────────────────────────────────────────────────────────────
  if (!indices) {
    r.skip({ id: 'es-replicas', category: 'Indices', title: 'Replicas', detail: '_cat/indices is not readable by this user' });
  } else {
    const user = indices.filter(x => userIndex(String(x.index)));
    if (dataNodes.length > 1 || (!nodes.length && n(health?.number_of_data_nodes) > 1)) {
      const none = user.filter(x => n(x.rep) === 0);
      const base = { id: 'es-replicas', category: 'Indices' as const, title: 'Indices have replicas',
        current: none.length ? `${none.length} indices without replicas (${none.slice(0, 3).map(x => x.index).join(', ')})` : 'all indices have ≥ 1 replica',
        recommended: 'number_of_replicas ≥ 1', reference: D.shards };
      if (none.length) r.fail({ ...base, severity: 'medium', detail: 'Losing the node that holds a shard without a replica loses that data.', remediation: 'PUT <index>/_settings {"index.number_of_replicas": 1}' });
      else r.pass(base);
    } else {
      const withRep = user.filter(x => n(x.rep) > 0);
      const base = { id: 'es-replicas', category: 'Indices' as const, title: 'Replica count fits the number of data nodes',
        current: withRep.length ? `${withRep.length} indices ask for replicas on a single data node` : 'single data node, no replicas requested',
        recommended: 'number_of_replicas 0 on a single node (or add nodes)' };
      if (withRep.length) r.fail({ ...base, severity: 'low', detail: 'Replicas can never be allocated on one node, so the cluster stays yellow.', remediation: 'PUT <index>/_settings {"index.number_of_replicas": 0}, or add a data node.' });
      else r.pass(base);
    }
  }

  // ── Data lifecycle ───────────────────────────────────────────────────────
  if (!indices || !lifecycle) {
    r.skip({ id: 'es-lifecycle', category: 'Data lifecycle', title: 'Time-series data has a lifecycle policy', detail: isOS ? 'ISM explain API is not readable (is the ISM plugin installed?)' : 'Index settings are not readable by this user' });
  } else {
    const managed = new Set<string>();
    for (const [name, v] of Object.entries(lifecycle as Obj)) {
      if (isOS ? !!(v as Obj)?.['index.plugins.index_state_management.policy_id'] || !!(v as Obj)?.policy_id
        : !!(v as Obj)?.settings?.['index.lifecycle.name']) managed.add(name);
    }
    const timeSeries = indices.map(x => String(x.index))
      .filter(name => userIndex(name) || name.startsWith('.ds-'))
      .filter(name => /\d{4}[.\-_]?\d{2}([.\-_]?\d{2})?/.test(name) || name.startsWith('.ds-') || /-\d{6}$/.test(name));
    const unmanaged = timeSeries.filter(name => !managed.has(name));
    const base = { id: 'es-lifecycle', category: 'Data lifecycle' as const, title: `Time-series indices are managed by ${isOS ? 'ISM' : 'ILM'}`,
      current: timeSeries.length ? `${unmanaged.length} of ${timeSeries.length} dated/rollover indices without a policy` : 'no time-series indices found',
      recommended: `${isOS ? 'An ISM' : 'An ILM'} policy with rollover and delete`, reference: D.ilm };
    if (unmanaged.length >= 5) r.fail({ ...base, severity: 'low', detail: 'Without a lifecycle policy old indices are never rolled over, shrunk or deleted; shard count and disk use grow forever.', remediation: isOS ? 'Create an ISM policy with an ism_template matching these index patterns.' : 'Create an ILM policy (rollover + delete phase) and attach it via the index template.' });
    else r.pass(base);
  }

  // ── Data safety ──────────────────────────────────────────────────────────
  if (repos === null) {
    r.skip({ id: 'es-snapshots', category: 'Data safety', title: 'Snapshots', detail: 'Snapshot API is not readable by this user' });
  } else {
    const names = Object.keys(repos);
    if (!names.length) {
      r.fail({ id: 'es-snapshots', category: 'Data safety', title: 'A snapshot repository is configured', severity: 'medium',
        current: 'no repository', recommended: `A repository with scheduled snapshots (${isOS ? 'snapshot management' : 'SLM'})`, reference: D.snapshots,
        detail: 'Replicas do not protect against deletes, corruption or a lost cluster; only snapshots do.',
        remediation: 'PUT _snapshot/backups {"type":"fs","settings":{"location":"/mnt/backups"}} — then schedule snapshots.' });
    } else {
      let latest = 0;
      for (const repo of names.slice(0, 5)) {
        const snaps = await get<Obj[]>(`/_cat/snapshots/${encodeURIComponent(repo)}?format=json&h=id,status,end_epoch`);
        for (const sn of snaps ?? []) if (sn.status === 'SUCCESS') latest = Math.max(latest, n(sn.end_epoch) * 1000);
      }
      const ageH = latest ? (Date.now() - latest) / 3_600_000 : Infinity;
      const base = { id: 'es-snapshots', category: 'Data safety' as const, title: 'A snapshot succeeded in the last 24 hours',
        current: latest ? `last success ${Math.round(ageH)} h ago (${names.length} repositories)` : `no successful snapshot in ${names.join(', ')}`,
        recommended: 'daily snapshots', reference: D.snapshots };
      if (ageH > 24) r.fail({ ...base, severity: 'medium', detail: 'The most recent restorable copy of the data is old or missing.', remediation: isOS ? 'Create a snapshot management policy: POST _plugins/_sm/policies/daily' : 'Create an SLM policy: PUT _slm/policy/daily' });
      else r.pass(base);
    }
  }

  if (settings) {
    const v = String(setting('action.destructive_requires_name') ?? 'false');
    const base = { id: 'es-destructive-requires-name', category: 'Data safety' as const, title: 'Index deletes require explicit names',
      current: `action.destructive_requires_name = ${v}`, recommended: 'true', reference: D.sysconfig };
    if (v !== 'true') r.fail({ ...base, severity: 'medium', detail: 'DELETE /* or DELETE /logs-* can remove every matching index in one call.', remediation: 'PUT _cluster/settings {"persistent":{"action.destructive_requires_name":true}}' });
    else r.pass(base);
  }

  // ── Load ─────────────────────────────────────────────────────────────────
  if (stats.length) {
    const rejected = stats.reduce((a, x) => a + n(x.thread_pool?.write?.rejected) + n(x.thread_pool?.search?.rejected), 0);
    const base = { id: 'es-rejections', category: 'Load' as const, title: 'No rejected search or write requests',
      current: `${rejected} rejected since node start`, recommended: '0' };
    if (rejected > 0) r.fail({ ...base, severity: 'low', detail: 'Thread-pool queues overflowed: clients received 429 errors.', remediation: 'Smooth bulk sizes and concurrency, or add capacity. Watch Live monitoring for spikes.' });
    else r.pass(base);

    const tripped = stats.reduce((a, x) => a + Object.values((x.breakers ?? {}) as Obj).reduce((b: number, br: Obj) => b + n(br?.tripped), 0), 0);
    const bbase = { id: 'es-breakers', category: 'Load' as const, title: 'Circuit breakers have not tripped',
      current: `${tripped} trips since node start`, recommended: '0' };
    if (tripped > 0) r.fail({ ...bbase, severity: 'low', detail: 'Requests were refused to protect the heap — usually large aggregations or fielddata on text fields.', remediation: 'Find the offending queries in Query workbench / Search analytics; avoid fielddata on text fields.' });
    else r.pass(bbase);
  }

  // ── Deprecations (Elasticsearch only) ────────────────────────────────────
  if (!isOS) {
    if (!deprecations) {
      r.skip({ id: 'es-deprecations', category: 'Deprecations', title: 'No deprecated configuration', detail: 'Deprecation API is not readable by this user' });
    } else {
      const all: Obj[] = [
        ...(deprecations.cluster_settings ?? []), ...(deprecations.node_settings ?? []), ...(deprecations.ml_settings ?? []),
        ...Object.values((deprecations.index_settings ?? {}) as Obj).flat() as Obj[],
      ];
      const critical = all.filter(d => d.level === 'critical');
      const base = { id: 'es-deprecations', category: 'Deprecations' as const, title: 'No deprecated configuration blocks the next upgrade',
        current: `${critical.length} critical, ${all.length - critical.length} warnings${all.length ? ` — e.g. ${String(all[0].message).slice(0, 80)}` : ''}`,
        recommended: '0 critical', reference: 'https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-migration-deprecations' };
      if (critical.length) r.fail({ ...base, severity: 'medium', detail: 'Critical deprecations must be fixed before upgrading to the next major.', remediation: 'GET _migration/deprecations lists each item with a link to the fix.' });
      else if (all.length) r.fail({ ...base, severity: 'low', detail: 'Deprecated settings still work but will be removed in a future version.', remediation: 'GET _migration/deprecations lists each item with a link to the fix.' });
      else r.pass(base);
    }
  }

  return finalizeReview(r, SEARCH_CONFIG_CATEGORIES, { version, target: url, engine: distribution });
}
