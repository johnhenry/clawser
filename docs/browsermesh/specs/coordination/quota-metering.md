# Quota Metering

Per-identity resource quotas with usage tracking and enforcement.

**Source**: `web/clawser-mesh-quotas.js`
**Related specs**: [payment-channels.md](../extensions/payment-channels.md) | [resource-marketplace.md](resource-marketplace.md)

## 1. Overview

Four cooperating pieces: `QuotaRule` defines per-pod resource limits,
`UsageRecord` tracks consumption in hourly periods, `QuotaManager` handles CRUD
with default-limit fallback, and `QuotaEnforcer` records real-time usage, checks
quotas before allocation, and logs violations. Wire codes are imported from the
canonical constants registry.

## 2. Wire Codes

From `MESH_TYPE` in `web/packages/mesh-primitives/src/constants.mjs`:

| Name            | Hex    | Description                      |
|-----------------|--------|----------------------------------|
| QUOTA_UPDATE    | `0xCD` | Quota rule created or updated    |
| QUOTA_VIOLATION | `0xCE` | Quota violation detected         |
| USAGE_REPORT    | `0xCF` | Periodic usage report            |

## 3. Default Limits

| Resource            | Default | Usage field      |
|---------------------|---------|------------------|
| `cpuMs`             | 60,000  | `cpuMs`          |
| `memoryMb`          | 512     | `memoryMb`       |
| `storageMb`         | 100     | `storageMb`      |
| `bandwidthMb`       | 1,000   | `bandwidthMb`    |
| `jobsPerHour`       | 100     | `jobCount`       |
| `maxConcurrentJobs` | 5       | `concurrentJobs` |

## 4. API Surface

### 4.1 QuotaRule

```
constructor({ podId, limits, overagePolicy?, createdAt?, expiresAt? })
isExpired(now?) -> boolean
toJSON() / static fromJSON(data)
```

Overage policies: `block` (default), `throttle`, `charge`.

### 4.2 UsageRecord

Hourly consumption record. Period key: ISO 8601 truncated to hour (e.g. `2026-03-02T06`).

```
constructor({ podId, period, usage?, updatedAt? })
static currentPeriod(date?) -> string
toJSON() / static fromJSON(data)
```

### 4.3 QuotaManager

CRUD for per-pod quota rules.

```
constructor(opts?)               // opts: { defaultLimits?, enforcementEnabled? }
get defaultLimits / enforcementEnabled / size
setQuota(podId, limits, overagePolicy?, opts?) -> QuotaRule
getQuota(podId) -> QuotaRule|null
removeQuota(podId) -> boolean
listQuotas() -> QuotaRule[]
resolveEffective(podId) -> { limits, overagePolicy, source }
toJSON() / static fromJSON(data)
```

`resolveEffective` returns the explicit rule if non-expired, else defaults
with `source: 'default'`.

### 4.4 QuotaEnforcer

Real-time tracking and enforcement against a QuotaManager.

```
constructor(quotaManager, opts?)          // opts: { onViolation? }
recordUsage(podId, resource, amount) -> void
getUsage(podId, period?) -> UsageRecord|null
checkQuota(podId, resource, requestedAmount) -> CheckResult
resetUsage(podId, period?) -> void
listViolations(podId?) -> Violation[]
pruneOldUsage(maxAgeMs?) -> number        // default 24h
get usageCount -> number
toJSON() / static fromJSON(data, quotaManager, opts?)
```

**recordUsage**: additive for most resources; `maxConcurrentJobs` uses
high-water-mark (`Math.max`). Immediately checks for violations after recording.

**CheckResult**: `{ allowed, remaining?, overage?, policy? }`. Under `block`,
denied when projected exceeds limit. Under `throttle`/`charge`, allowed with
overage reported.

**Violation**: `{ podId, resource, limit, actual, policy, timestamp }`.

## 5. Enforcement Flow

1. `recordUsage` updates the current-period `UsageRecord`
2. Resolves effective limits via `QuotaManager`
3. If actual > limit: records violation, calls `onViolation` callback
4. `checkQuota` projects current + requested vs limit before allocation

## 6. Implementation Status

| Aspect              | Status                                        |
|---------------------|-----------------------------------------------|
| All classes         | Fully implemented                             |
| Wire code imports   | From canonical constants registry             |
| Violation tracking  | Fully implemented with callback               |
| Serialization       | toJSON/fromJSON complete                      |
| Unit tests          | Yes (`web/test/clawser-mesh-quotas.test.mjs`) |
| App bootstrap wired | No -- not wired to app bootstrap              |
