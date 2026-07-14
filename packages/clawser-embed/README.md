# clawser-embed

Embeddable Clawser agent pod — drop a Clawser-powered agent into any web app.

`EmbeddedPod` extends `browsermesh-pod`'s `Pod` with a minimal messaging API
(`sendMessage`, `on`/`off`/`emit`) and a lazy-attached agent slot, so a host
app can wire up its own `ClawserAgent` instance (from the main
[clawser](https://github.com/johnhenry/clawser) repo) and drive it through a
stable embedding surface without depending on the full Clawser UI.

## Install

```bash
npm install clawser-embed browsermesh-pod
```

## Usage

```js
import { EmbeddedPod } from 'clawser-embed'

const pod = new EmbeddedPod({ containerId: 'my-agent', agent: myClawserAgent })

pod.on('response', (msg) => console.log(msg))

const { content, toolCalls } = await pod.sendMessage('Summarize this page')
```

`config.agent` accepts any object shaped like `clawser-agent.js`'s
`ClawserAgent` — this package doesn't depend on the main Clawser codebase,
so the agent instance is duck-typed (`sendMessage`, `getEventLog().query()`,
`run()`).

## Backward compatibility

`ClawserEmbed` is exported as an alias of `EmbeddedPod` for callers migrating
from an earlier naming.
