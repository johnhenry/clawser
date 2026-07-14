---
title: "Deployment & the mesh networking dependency"
---

Clawser itself is a static, server-free app — everything in this guide runs entirely client-side. **One feature is the exception**, and it's worth being upfront about it rather than leaving it as a surprise in the source.

## What needs a server

Cross-origin pod discovery and relay — letting a Clawser pod on one origin find and talk to a pod on another origin — can't happen with pure client-side code; two browser tabs on different origins have no way to find each other without *something* in the middle. That's the only part of Clawser that isn't fully client-side.

Today that "something in the middle" is two small WebSocket services, deployed on [Fly.io](https://fly.io):

| Service | URL | Role |
|---|---|---|
| Signaling | `wss://browsermesh-signaling.fly.dev` | Pods announce themselves and discover peers |
| Relay | `wss://browsermesh-relay.fly.dev` | Forwards messages between pods that can't reach each other directly |

Source: [browsermesh-servers](https://github.com/johnhenry/browsermesh-servers).

## What still works without them

Everything **within** a single origin — the agent runtime, memory, tools, goals, scheduled tasks, and the ~100 built-in tools — has no dependency on these services at all. If the signaling/relay endpoints are unreachable, a single Clawser pod keeps working; you only lose the ability to discover and mesh with pods running elsewhere.

## Self-hosting the signaling/relay layer

If you'd rather not depend on the erisera-hosted instances, both services are open source and small enough to run yourself:

```sh
git clone https://github.com/johnhenry/browsermesh-servers
cd browsermesh-servers
# see that repo's README for the signaling and relay server setup
```

Point your own Clawser build's `signalingUrl` / `relayUrl` config at your self-hosted instances instead of the defaults.

## What this means for erisera.com hosting

`clawser.erisera.com` (the app) and its docs (this site, at `clawser.erisera.com/docs`) are both static and deploy the same way as the rest of the erisera family — Cloudflare Workers static assets, no server-side component. The Fly.io services are a separate piece of infrastructure the *app* talks to at runtime from the browser; they are not part of the erisera.com deploy pipeline and aren't required for the app or its docs to load and serve correctly.
