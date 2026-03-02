# mesh-ctl CLI Reference

Command-line interface for managing BrowserMesh resources.

**Related specs**: [manifest-format.md](manifest-format.md) | [client-api.md](client-api.md) | [pod-types.md](../core/pod-types.md) | [service-model.md](../coordination/service-model.md) | [observability.md](../operations/observability.md)

## 1. Overview

[manifest-format.md](manifest-format.md) lists `mesh-ctl` commands but does not define their behavior or output format. This spec defines the full CLI reference:

- Command reference with arguments and flags
- Output formats (table, JSON, YAML)
- Resource targeting syntax
- Configuration and contexts
- Plugin system

## 2. Command Reference

### 2.1 `mesh-ctl apply`

Apply a manifest to the mesh runtime.

```
mesh-ctl apply -f <file|directory|url> [--dry-run] [--force]
```

| Flag | Description |
|------|-------------|
| `-f, --file` | Manifest file, directory, or URL |
| `--dry-run` | Validate without applying |
| `--force` | Skip confirmation for destructive changes |

```bash
# Apply a single manifest
mesh-ctl apply -f pod.yaml

# Apply all manifests in a directory
mesh-ctl apply -f ./manifests/

# Dry-run to validate
mesh-ctl apply -f pod.yaml --dry-run
```

Output:
```
pod/image-resizer created
service/image-service configured
deployment/image-deploy unchanged
```

### 2.2 `mesh-ctl get`

List resources of a given kind.

```
mesh-ctl get <resource-type> [name] [-o format] [-n namespace] [-l selector]
```

| Flag | Description |
|------|-------------|
| `-o, --output` | Output format: `table` (default), `json`, `yaml`, `wide` |
| `-n, --namespace` | Filter by namespace |
| `-l, --selector` | Label selector (e.g., `app=web,tier=frontend`) |

```bash
# List all pods
mesh-ctl get pods

# Get a specific pod as JSON
mesh-ctl get pod image-resizer -o json

# List services in a namespace
mesh-ctl get services -n production

# Filter by label
mesh-ctl get pods -l app=compute
```

Table output:
```
NAME             KIND      STATUS    AGE     POD-ID
image-resizer    worker    Running   5m32s   a1b2c3...
data-processor   window    Running   12m     d4e5f6...
```

### 2.3 `mesh-ctl describe`

Show detailed information about a resource.

```
mesh-ctl describe <resource-type> <name> [-n namespace]
```

```bash
mesh-ctl describe pod image-resizer
```

Output:
```
Name:         image-resizer
Namespace:    default
Kind:         worker
Pod ID:       a1b2c3d4e5f6...
Status:       Running
Created:      2026-02-16T10:30:00Z

Capabilities:
  - compute/run
  - storage/read

Labels:
  app: image-resizer
  tier: compute

Sessions:
  Peer               State      Age
  d4e5f6...          active     5m
  g7h8i9...          active     2m

Events:
  Type     Reason          Age    Message
  Normal   BootComplete    5m     Pod booted successfully
  Normal   SessionCreated  5m     Session with d4e5f6 established
```

### 2.4 `mesh-ctl delete`

Delete a resource.

```
mesh-ctl delete <resource-type> <name> [-n namespace] [--force] [--grace-period seconds]
```

| Flag | Description |
|------|-------------|
| `--force` | Skip graceful shutdown |
| `--grace-period` | Seconds to wait for graceful shutdown (default: 30) |

```bash
# Delete a pod gracefully
mesh-ctl delete pod image-resizer

# Force delete
mesh-ctl delete pod image-resizer --force

# Delete all pods matching a label
mesh-ctl delete pods -l app=old-version
```

### 2.5 `mesh-ctl logs`

Stream logs from a pod.

```
mesh-ctl logs <pod-name> [-f] [--since duration] [--tail lines] [-n namespace]
```

| Flag | Description |
|------|-------------|
| `-f, --follow` | Stream logs in real-time |
| `--since` | Show logs since duration (e.g., `5m`, `1h`) |
| `--tail` | Number of recent lines to show (default: 100) |

```bash
# Last 100 lines
mesh-ctl logs image-resizer

# Follow live logs
mesh-ctl logs image-resizer -f

# Last 5 minutes
mesh-ctl logs image-resizer --since 5m
```

### 2.6 `mesh-ctl port-forward`

Forward a local port to a pod's service.

```
mesh-ctl port-forward <pod-name> <local-port>:<remote-port> [-n namespace]
```

```bash
# Forward local 8080 to pod's port 80
mesh-ctl port-forward web-server 8080:80
```

### 2.7 `mesh-ctl top`

Show resource usage for pods.

```
mesh-ctl top <pods|services> [-n namespace] [--sort-by field]
```

```bash
mesh-ctl top pods
```

Output:
```
NAME             CPU(ms)   MEM(MB)   SESSIONS   MSG/s   UPTIME
image-resizer    120       8.4       3          45      5m32s
data-processor   340       12.1      5          120     12m
```

### 2.8 `mesh-ctl exec`

Execute a command in a pod context.

```
mesh-ctl exec <pod-name> -- <command> [args...]
```

```bash
# Send a request to a pod
mesh-ctl exec image-resizer -- request compute/run '{"input": "test"}'

# Check pod state
mesh-ctl exec image-resizer -- state
```

### 2.9 `mesh-ctl debug`

Generate debug artifacts for a pod.

```
mesh-ctl debug <pod-name> [--as-curl] [--as-fetch] [--method method] [--args json]
```

| Flag | Description |
|------|-------------|
| `--as-curl` | Generate a cURL command equivalent |
| `--as-fetch` | Generate a `fetch()` code snippet |
| `--method` | Service method to target |
| `--args` | JSON arguments for the request |

```bash
# Generate cURL for a compute request
mesh-ctl debug image-resizer --as-curl --method compute/run --args '{"input":"test"}'
```

Output:
```
curl -X POST 'http://localhost:3000/mesh/a1b2c3/compute/run' \
  -H 'Content-Type: application/cbor' \
  -H 'X-Mesh-Pod-Id: d4e5f6...' \
  -H 'X-Mesh-Trace-Id: abc123' \
  -d '{"input":"test"}'
```

```bash
# Generate fetch() code
mesh-ctl debug image-resizer --as-fetch --method compute/run --args '{"input":"test"}'
```

Output:
```javascript
await fetch('http://localhost:3000/mesh/a1b2c3/compute/run', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/cbor',
    'X-Mesh-Pod-Id': 'd4e5f6...',
    'X-Mesh-Trace-Id': 'abc123',
  },
  body: JSON.stringify({"input":"test"}),
});
```

### 2.10 `mesh-ctl capture`

Record and replay mesh traffic in HAR format (see [observability.md](../operations/observability.md) Section 11).

```
mesh-ctl capture <start|stop|export|replay> [options]
```

| Subcommand | Description |
|------------|-------------|
| `start` | Start recording traffic |
| `stop` | Stop recording |
| `export` | Export captured traffic as HAR JSON |
| `replay` | Replay a HAR file against the mesh |

```bash
# Start capturing traffic
mesh-ctl capture start

# Stop capturing
mesh-ctl capture stop

# Export to HAR file
mesh-ctl capture export -o traffic.har

# Replay captured traffic
mesh-ctl capture replay traffic.har --target image-resizer
```

Export output:
```
Captured 47 request/response pairs over 5m12s
Exported to traffic.har (124 KB)
```

Replay output:
```
Replaying 47 requests against image-resizer...
  ✓ compute/run (45ms)
  ✓ compute/run (38ms)
  ✗ storage/read (timeout after 30000ms)
Results: 46/47 passed, 1 failed
```

## 3. Output Formats

All `get` and `describe` commands support multiple output formats:

| Format | Flag | Description |
|--------|------|-------------|
| Table | `-o table` (default) | Human-readable columns |
| Wide | `-o wide` | Table with additional columns |
| JSON | `-o json` | Machine-readable JSON |
| YAML | `-o yaml` | YAML representation |

### JSON Output

```bash
mesh-ctl get pod image-resizer -o json
```

```json
{
  "apiVersion": "browsermesh/v1",
  "kind": "Pod",
  "metadata": {
    "name": "image-resizer",
    "namespace": "default",
    "labels": { "app": "image-resizer" },
    "createdAt": "2026-02-16T10:30:00Z"
  },
  "spec": {
    "kind": "worker",
    "module": "./workers/image-resizer.js",
    "capabilities": ["compute/run", "storage/read"]
  },
  "status": {
    "phase": "Running",
    "podId": "a1b2c3d4e5f6...",
    "activeSessions": 3
  }
}
```

## 4. Resource Targeting

Resources are targeted using the format:

```
<resource-type>[/<name>][.<namespace>]
```

| Example | Meaning |
|---------|---------|
| `pods` | All pods in current namespace |
| `pod/image-resizer` | Specific pod |
| `pods.production` | All pods in `production` namespace |
| `service/compute.staging` | Specific service in `staging` |

### Resource Types

| Type | Aliases | Description |
|------|---------|-------------|
| `pod` | `pods`, `po` | Pod resources |
| `service` | `services`, `svc` | Service resources |
| `deployment` | `deployments`, `deploy` | Deployment resources |
| `configmap` | `configmaps`, `cm` | ConfigMap resources |
| `capabilitytoken` | `capabilitytokens`, `ct` | Capability tokens |
| `trafficsplit` | `trafficsplits`, `ts` | Traffic splits |

## 5. Configuration

### 5.1 Config File

```yaml
# ~/.browsermesh/config
apiVersion: browsermesh/v1
kind: Config

current-context: local

contexts:
  - name: local
    runtime:
      type: browser
      url: http://localhost:3000
  - name: staging
    runtime:
      type: server
      url: wss://staging.example.com/mesh

preferences:
  output: table
  namespace: default
  color: true
```

### 5.2 Context Management

```bash
# List contexts
mesh-ctl config get-contexts

# Switch context
mesh-ctl config use-context staging

# Set default namespace
mesh-ctl config set-context local --namespace=production
```

## 6. Plugin System

mesh-ctl supports plugins for extended functionality. Plugins are executable files named `mesh-ctl-<name>` in the PATH.

```bash
# A plugin named mesh-ctl-debug in PATH
mesh-ctl debug pod/image-resizer

# List installed plugins
mesh-ctl plugin list
```

### Plugin Discovery

```
mesh-ctl plugin list
```

Output:
```
NAME      PATH                           VERSION
debug     /usr/local/bin/mesh-ctl-debug  0.1.0
monitor   ~/.mesh-plugins/mesh-ctl-monitor 0.2.1
```

## 7. Integration with Client API

mesh-ctl connects to the mesh runtime using the client API (see [client-api.md](client-api.md)):

```typescript
// Internal: mesh-ctl uses MeshClient to communicate with the runtime
import { createClient } from '@browsermesh/client';

const client = createClient(configFromContext());
await client.runtime.boot();

// mesh-ctl get pods → client.request({ service: 'control-plane' }, 'list-pods')
const pods = await client.request(
  { service: 'control-plane' },
  'resources/list',
  { kind: 'Pod', namespace: currentNamespace }
);
```

## 8. Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments |
| 3 | Resource not found |
| 4 | Permission denied |
| 5 | Connection failed |
| 6 | Timeout |
