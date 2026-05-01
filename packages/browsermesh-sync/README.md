# browsermesh-sync

CRDT sync engine, delta sync, file transfer, and real-time collaboration for BrowserMesh.

## Modules

| Module | Key Exports |
|--------|-------------|
| sync | `SyncDocument`, `MeshSyncEngine`, `InMemorySyncStorage` |
| delta-sync | `SyncCoordinator`, `DeltaLog`, `DeltaEncoder`, `DeltaDecoder`, `DeltaBranch` |
| migration | `MigrationEngine`, `MigrationPlan`, `DualActiveWindow` |
| files | `MeshFileTransfer`, `ChunkStore`, `FileDescriptor`, `TransferOffer` |
| collab | `CollabSession`, `YjsAdapter`, `AwarenessState` |
| collab-bridge | `CollabBridge`, `CollabManager` |
| memory-sync | `AgentMemorySync`, `MemoryEntry`, `ConflictEntry` |

## Install

```bash
npm install browsermesh-sync browsermesh-primitives
```

## Usage

```js
import { MeshSyncEngine, MeshFileTransfer, CollabSession } from 'browsermesh-sync';
```

## License

MIT
