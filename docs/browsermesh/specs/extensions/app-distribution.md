# App Distribution

## Overview

The app distribution module provides a full decentralized app lifecycle for BrowserMesh: manifest definition, installation with permission checking, a distributed app store with publish/search/popularity tracking, inter-app RPC, and pub/sub eventing. Apps have well-defined state machines and peer management for multi-node execution.

Source: `web/clawser-mesh-apps.js`

## Wire Codes

Defined locally in the module (not in the canonical registry):

| Name            | Code   | Description                      |
|-----------------|--------|----------------------------------|
| APP_MANIFEST    | `0x98` | App manifest announcement        |
| APP_INSTALL     | `0x99` | App installation signal          |
| APP_UNINSTALL   | `0x9A` | App uninstallation signal        |
| APP_STATE_SYNC  | `0x9B` | App state synchronization        |
| APP_RPC         | `0x9C` | Inter-app RPC message            |
| APP_EVENT       | `0x9D` | App event broadcast              |

These codes are in the `0x98-0x9D` range, below the core mesh protocol range (`0xA0+`).

## API Surface

### AppManifest

Describes a mesh-distributed app. Constructor fields: `id`, `name`, `version` (semver x.y.z), `description?`, `author?`, `permissions` (string[]), `entryPoint`, `dependencies` (`{id, minVersion?}[]`), `minPeers` (default 1), `maxPeers?`, `metadata`, `publishedAt?`, `signature?`. Valid permissions: `net`, `fs`, `identity`, `mesh`, `payment`, `compute`, `storage`. Methods: `validate()`, `satisfiesDependency(dep)`, `toJSON()`, `fromJSON()`.

### AppInstance

A running instance with state machine. States: `installed` -> `starting` -> `running` -> `paused` -> `stopping` -> `stopped` | `error`. Constructor: `manifest`, `installedBy`, `installedAt?`, `state?`, `data?`, `peers?`. Getters: `id`, `name`, `state`, `data`, `peers`. Methods: `start()`, `pause()`, `stop()`, `setError(error)`, `updateData(patch)`, `addPeer(podId)`, `removePeer(podId)`, `hasPeer(podId)`, `toJSON()`, `fromJSON()`.

### AppPermissionChecker

Validates permissions against a granted set. Methods: `check(permission)` -> boolean, `checkAll(permissions)` -> `{granted[], denied[]}`, `grant(permission)`, `revoke(permission)`, `listGranted()`.

### AppRegistry

Manages installed apps for a local pod with lifecycle callbacks.

| Method / Property                          | Returns           | Description                                    |
|--------------------------------------------|-------------------|------------------------------------------------|
| `constructor({ localPodId })`              | --                | Initialize for a pod                           |
| `install(manifest, grantPermissions?)`     | `AppInstance`     | Install app; validates manifest first          |
| `uninstall(appId)`                         | `void`            | Stop and remove app                            |
| `get(appId)`                               | `AppInstance\|undefined` | Lookup by ID                              |
| `list(filter?)`                            | `AppInstance[]`   | Filter by `state`, `author`, `name` substring  |
| `start(appId)` / `pause(appId)` / `stop(appId)` | `void`     | Lifecycle transitions with callbacks           |
| `update(appId, newManifest)`               | `void`            | Hot-update: stops, replaces, optionally restarts |
| `getByPermission(permission)`              | `AppInstance[]`   | Apps requesting a specific permission          |
| `onInstall(cb)` / `onUninstall(cb)` / `onStateChange(cb)` | `void` | Event registration              |
| `getStats()`                               | `{ totalInstalled, running, paused, stopped }` | Aggregate counts |
| `toJSON()` / `fromJSON(data)`              | `object` / `AppRegistry` | Serialization round-trip              |

### AppStore

Distributed app store with search, popularity, and author management.

| Method / Property                 | Returns           | Description                                    |
|-----------------------------------|-------------------|------------------------------------------------|
| `constructor({ localPodId })`     | --                | Initialize for a pod                           |
| `publish(manifest)`               | `void`            | Add or update a manifest                       |
| `unpublish(appId, requesterPodId)`| `void`            | Remove; only author may unpublish              |
| `search(query)`                   | `AppManifest[]`   | Text search on name and description            |
| `getById(appId)`                  | `AppManifest\|undefined` | Lookup by ID                              |
| `getByAuthor(authorPodId)`        | `AppManifest[]`   | All apps by an author                          |
| `getPopular(limit?)`              | `AppManifest[]`   | Sorted by install count descending             |
| `addInstallCount(appId)`          | `void`            | Increment install counter                      |
| `getCategories()`                 | `string[]`        | Distinct categories from metadata              |
| `onPublish(cb)` / `onUpdate(cb)`  | `void`           | Event registration                             |
| `toJSON()` / `fromJSON(data)`     | `object` / `AppStore` | Serialization round-trip                  |

### AppRPC

Inter-app and cross-pod remote procedure calls.

| Method / Property                          | Returns          | Description                                    |
|--------------------------------------------|------------------|------------------------------------------------|
| `constructor({ appId, localPodId })`       | --               | Initialize for an app on a pod                 |
| `register(method, handler)`                | `void`           | Register an RPC method                         |
| `unregister(method)`                       | `void`           | Remove an RPC method                           |
| `call(targetPodId, method, params?)`       | `Promise<*>`     | Call remote method; returns promise             |
| `listMethods()`                            | `string[]`       | Registered method names                        |
| `handleIncoming(message)`                  | `object\|undefined` | Dispatch request or resolve response        |
| `onCall(cb)`                               | `void`           | Callback for outgoing calls (transport hook)   |

### AppEventBus

Pub/sub event system scoped to an app.

| Method / Property                 | Returns                              | Description                          |
|-----------------------------------|--------------------------------------|--------------------------------------|
| `constructor({ appId })`          | --                                   | Initialize for an app                |
| `emit(eventType, data)`           | `void`                               | Publish event to subscribers         |
| `on(eventType, cb)`               | `void`                               | Subscribe                            |
| `off(eventType, cb)`              | `void`                               | Unsubscribe                          |
| `once(eventType, cb)`             | `void`                               | Subscribe for one event only         |
| `listEventTypes()`                | `Array<{ eventType, count }>`        | Active types with subscriber counts  |
| `removeAllListeners(eventType?)`  | `void`                               | Clear listeners                      |

## Implementation Status

**Status: Implemented, not wired to app bootstrap.**

- All seven classes are fully implemented with validation, serialization, state machines, and event callbacks.
- Wire codes are defined but no transport integration sends or receives these message types.
- No integration with `ClawserPod.initMesh()` or any bootstrap path.
- The RPC layer stores outgoing messages and exposes `onCall()` for transport hookup, but no transport is connected.
- Test file: `web/test/clawser-mesh-apps.test.mjs`

## Source File Reference

`web/clawser-mesh-apps.js` -- 1368 lines, pure ES module, no browser-only imports.
