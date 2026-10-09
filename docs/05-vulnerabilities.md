# Vulnerability intelligence

IndexSphere detects the versions you run and lists the published vulnerabilities that affect them.

- [How it works](#how-it-works)
- [Reading the results](#reading-the-results)
- [Checking an upgrade target](#checking-an-upgrade-target)
- [Caching and refresh](#caching-and-refresh)
- [Air-gapped deployments](#air-gapped-deployments)
- [Limitations](#limitations)

---

## How it works

1. **Version detection.**
   - **Elasticsearch / OpenSearch:** every node's version (`_cat/nodes`). Each distinct version is assessed separately, so mixed-version clusters in the middle of a rolling upgrade are covered.
   - **ClickHouse:** `version()`.
2. **Matching.**
   - **[NVD](https://nvd.nist.gov/)** — all CVEs whose CPE configuration names the product (`elastic:elasticsearch`, `amazon:opensearch`, `linuxfoundation:opensearch`, `clickhouse:clickhouse`). IndexSphere evaluates each version range itself (start/end, inclusive/exclusive, exact versions, and ClickHouse's per-branch ranges).
   - **[OSV.dev](https://osv.dev/)** — GitHub and other advisories for the server artifacts (`org.elasticsearch:elasticsearch`, `org.opensearch:opensearch`). Findings that share a CVE id are merged.
3. **Context.**
   - **[CISA KEV](https://www.cisa.gov/known-exploited-vulnerabilities-catalog)** — flags vulnerabilities known to be exploited in the wild, including ransomware use. These are listed first.
   - **[EPSS](https://www.first.org/epss/)** — the probability that a CVE will be exploited in the next 30 days.
4. **Recommendation.** The smallest version that fixes every finding with a published fix, preferring your current release line (the same major version).

Only product names and version numbers are sent to these services. Nothing about your data, hosts or configuration leaves the server.

## Reading the results

- **Summary:** total findings by severity, and how many are actively exploited.
- **Each finding:** CVE id, CVSS severity and score, the matched version range, fixed versions, EPSS, CWE, sources (NVD and/or OSV) and advisory links.
- **Prioritise:** actively exploited (KEV) first, then critical/high with a high EPSS.
- The same summary appears as a banner on the Elasticsearch/OpenSearch **Overview** and the **ClickHouse overview**. It also feeds the **Security posture** score.

## Checking an upgrade target

Open **Vulnerabilities → Check a version**, choose the product and type the version you plan to upgrade to, such as `8.19.22` or `25.8.2.29`. Do this before scheduling an upgrade.

## Caching and refresh

- **Cache:** feeds are stored in SQLite for 24 h. The first lookup for a product takes a few seconds; later ones are instant.
- **Daily refresh:** NVD and KEV feeds are refreshed every day at 03:17.
- **Many users at once:** simultaneous lookups share a single fetch, so a cold cache can't flood NVD with requests.
- **Manual refresh:** admins can force a refresh with **Refresh from sources**.
- **Rate limits:** without an API key NVD allows 5 requests per 30 seconds, and IndexSphere paces itself accordingly. Set `NVD_API_KEY` for faster refreshes.
- **Outages:** if a source is down, the last cached data is shown along with the error.

## Air-gapped deployments

Set `VULN_INTEL_DISABLED=true`. No outbound lookups are made. The pages explain that lookups are disabled and show any data cached before the switch. To allow lookups through a proxy instead, permit HTTPS to `services.nvd.nist.gov`, `api.osv.dev`, `www.cisa.gov` and `api.first.org`.

## Limitations

- **Version-only matching.** Some CVEs apply only with a specific plugin, feature or configuration. Read the advisory before acting.
- **Vendor patches.** Vendor-patched builds (for example distribution packages with backported fixes) may still be reported under the base version.
- **Publication lag.** Advisories are only as current as NVD and OSV. Brand-new vulnerabilities can take days to get CPE data in NVD.
