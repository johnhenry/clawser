/**
 * clawser-fs-kernel.mjs — Phase 8: Kernel Filesystem Integration
 *
 * Exposes kernel state through the virtual filesystem:
 *   - /proc/kernel/tenants/  — one file per tenant with capabilities
 *   - /sys/services/         — registered kernel services (svc://*)
 *   - /sys/kernel/trace      — kernel tracer output
 *   - /sys/kernel/clock      — kernel clock value
 *   - /sys/kernel/signals/   — active signals
 *
 * Registers these as proc generators in the ProcFileHandler.
 *
 * @module clawser-fs-kernel
 *
 * @example
 *   import { registerKernelProcGenerators, registerKernelSysGenerators } from './clawser-fs-kernel.mjs';
 *   registerKernelProcGenerators(procHandler, kernelIntegration);
 *   registerKernelSysGenerators(procHandler, kernelIntegration);
 */

/**
 * Register /proc/kernel/* virtual file generators.
 *
 * @param {import('./clawser-proc.js').ProcFileHandler} handler
 * @param {import('./clawser-kernel-integration.js').KernelIntegration} ki
 *
 * @example
 *   registerKernelProcGenerators(procHandler, kernelIntegration);
 *   // Now: cat /proc/kernel/tenants → lists all tenants
 */
export const registerKernelProcGenerators = (handler, ki) => {
  const kernel = ki?.kernel;

  // /proc/kernel/tenants — directory listing of all tenants
  handler.register('/proc/kernel/tenants', () => {
    if (!kernel) return '(kernel not active)\n';
    const tenants = kernel.tenants ?? [];
    if (typeof tenants === 'function') {
      // If tenants is a method
      const list = tenants();
      return formatTenantList(list);
    }
    if (tenants.list) {
      return formatTenantList(tenants.list());
    }
    if (tenants[Symbol.iterator]) {
      return formatTenantList([...tenants]);
    }
    return '(no tenants)\n';
  });

  // Register individual tenant files dynamically
  // We use a pattern: /proc/kernel/tenants/{id} generates on demand
  // Since ProcFileHandler uses exact path matches, we register a parent
  // and use listDir for discovery. Individual reads go through a wrapper.
  handler.register('/proc/kernel/status', () => {
    if (!kernel) return JSON.stringify({ active: false }, null, 2) + '\n';
    return JSON.stringify({
      active: true,
      uptime: kernel.clock ? kernel.clock.nowWall() - (kernel._startTime || 0) : 0,
      tenantCount: countTenants(kernel),
      serviceCount: countServices(kernel),
    }, null, 2) + '\n';
  });
};

/**
 * Register /sys/kernel/* and /sys/services/* virtual file generators.
 * The /sys/ namespace supports both reads and writes (sysfs semantics).
 *
 * @param {import('./clawser-proc.js').ProcFileHandler} handler
 * @param {import('./clawser-kernel-integration.js').KernelIntegration} ki
 *
 * @example
 *   registerKernelSysGenerators(procHandler, kernelIntegration);
 *   // Now: cat /sys/kernel/clock → current kernel clock value
 */
export const registerKernelSysGenerators = (handler, ki) => {
  const kernel = ki?.kernel;

  // /sys/kernel/clock — current wall clock value
  handler.register('/sys/kernel/clock', () => {
    if (!kernel?.clock) return '0\n';
    return `${kernel.clock.nowWall()}\n`;
  });

  // /sys/kernel/trace — recent tracer output
  handler.register('/sys/kernel/trace', () => {
    if (!kernel?.tracer) return '(tracer not active)\n';
    const events = kernel.tracer.events ?? kernel.tracer.drain?.() ?? [];
    if (typeof events === 'function') {
      return formatTraceEvents(events());
    }
    if (events[Symbol.iterator]) {
      return formatTraceEvents([...events]);
    }
    return '(no trace events)\n';
  });

  // /sys/kernel/signals — list active signal controllers
  handler.register('/sys/kernel/signals', () => {
    if (!kernel) return '(kernel not active)\n';
    // Signals are typically per-tenant; list what we know
    const signals = [];
    if (kernel.signals) {
      for (const [name, sig] of Object.entries(kernel.signals)) {
        signals.push(`${name}\t${sig.pending ? 'pending' : 'clear'}`);
      }
    }
    if (signals.length === 0) return '(no active signals)\n';
    return signals.join('\n') + '\n';
  });

  // /sys/services — list registered kernel services
  handler.register('/sys/services', () => {
    if (!kernel?.services) return '(no service registry)\n';
    const services = listServices(kernel);
    if (services.length === 0) return '(no services registered)\n';
    return services.map(s => {
      const meta = s.metadata ? JSON.stringify(s.metadata) : '';
      return `svc://${s.name}\t${meta}`;
    }).join('\n') + '\n';
  });
};

/**
 * Convenience function to register all kernel filesystem generators at once.
 *
 * @param {import('./clawser-proc.js').ProcFileHandler} handler
 * @param {import('./clawser-kernel-integration.js').KernelIntegration} ki
 *
 * @example
 *   registerAllKernelGenerators(procHandler, kernelIntegration);
 */
export const registerAllKernelGenerators = (handler, ki) => {
  registerKernelProcGenerators(handler, ki);
  registerKernelSysGenerators(handler, ki);
};

// ── Internal helpers ────────────────────────────────────────────────

/**
 * Format a list of tenant objects into a tab-separated string.
 * @param {Array<{id: string, caps?: object, env?: object}>} tenants
 * @returns {string}
 */
const formatTenantList = (tenants) => {
  if (!tenants || tenants.length === 0) return '(no tenants)\n';
  return tenants.map(t => {
    const id = t.id ?? 'unknown';
    const caps = t.caps?._granted ?? t.capabilities ?? [];
    const capsStr = Array.isArray(caps) ? caps.join(',') : String(caps);
    const env = t.env ?? {};
    const role = env.ROLE || env.WORKSPACE_ID || '';
    return `${id}\t${capsStr}\t${role}`;
  }).join('\n') + '\n';
};

/**
 * Format trace events into a human-readable log.
 * @param {Array<object>} events
 * @returns {string}
 */
const formatTraceEvents = (events) => {
  if (!events || events.length === 0) return '(no trace events)\n';
  // Show last 100 events, most recent last
  const recent = events.slice(-100);
  return recent.map(e => {
    const ts = e.timestamp ?? e.ts ?? '';
    const type = e.type ?? 'unknown';
    const rest = { ...e };
    delete rest.timestamp;
    delete rest.ts;
    delete rest.type;
    const detail = Object.keys(rest).length > 0 ? '\t' + JSON.stringify(rest) : '';
    return `${ts}\t${type}${detail}`;
  }).join('\n') + '\n';
};

/**
 * Count tenants from kernel (handles various API shapes).
 * @param {object} kernel
 * @returns {number}
 */
const countTenants = (kernel) => {
  if (!kernel) return 0;
  if (kernel.tenants?.size) return kernel.tenants.size;
  if (kernel.tenants?.list) return kernel.tenants.list().length;
  if (Array.isArray(kernel.tenants)) return kernel.tenants.length;
  return 0;
};

/**
 * List services from the kernel service registry.
 * @param {object} kernel
 * @returns {Array<{name: string, metadata?: object}>}
 */
const listServices = (kernel) => {
  if (!kernel?.services) return [];
  // ServiceRegistry may have .list(), .entries(), or be iterable
  if (typeof kernel.services.list === 'function') {
    return kernel.services.list();
  }
  if (typeof kernel.services.entries === 'function') {
    const result = [];
    for (const [name, entry] of kernel.services.entries()) {
      result.push({ name, metadata: entry.metadata ?? null });
    }
    return result;
  }
  if (kernel.services[Symbol.iterator]) {
    return [...kernel.services].map(s => ({ name: s.name ?? s, metadata: s.metadata ?? null }));
  }
  return [];
};

/**
 * Count services from the kernel service registry.
 * @param {object} kernel
 * @returns {number}
 */
const countServices = (kernel) => {
  return listServices(kernel).length;
};
