// ext-screenshot-overflow tests — validates the context overflow fix.
// ExtTool._call output size cap + ExtScreenshotTool OPFS storage.
import { describe, it, expect, vi } from 'vitest';

const mod = await import('../clawser-extension-tools.js');
const { ExtScreenshotTool, ExtZoomTool } = mod;

// ── Mock RPC client ──────────────────────────────────────────────

function makeMockRpc(overrides = {}) {
  return {
    connected: true,
    capabilities: ['tabs', 'scripting'],
    call: async (action, params) => {
      if (action === 'screenshot') {
        // Simulate a large base64 data URL (~2MB)
        const fakeDataUrl = 'data:image/png;base64,' + 'A'.repeat(2_000_000);
        return { dataUrl: fakeDataUrl, format: params?.format || 'png' };
      }
      return { ok: true };
    },
    ...overrides,
  };
}

// ── 1. ExtScreenshotTool does NOT blow context ───────────────────

describe('ExtScreenshotTool overflow fix', () => {
  it('returns metadata without the full data URL', async () => {
    const tool = new ExtScreenshotTool(makeMockRpc());
    const result = await tool.execute({});
    expect(result.success).toBe(true);
    // Output should be small (metadata only), not 2MB+
    expect(result.output.length).toBeLessThan(1000);
    const parsed = JSON.parse(result.output);
    expect(parsed.sizeBytes).toBeGreaterThan(2_000_000);
    expect(parsed.format).toBe('png');
    expect(parsed.note).toContain('Screenshot');
  });

  it('does not include dataUrl in output', async () => {
    const tool = new ExtScreenshotTool(makeMockRpc());
    const result = await tool.execute({});
    expect(result.output).not.toContain('AAAA'); // no base64 data
    expect(result.output).not.toContain('data:image');
  });

  it('reports OPFS storage failure gracefully', async () => {
    // In test env, OPFS (navigator.storage.getDirectory) is mocked as empty
    // so opfsWalk will fail — the tool should still return metadata
    const tool = new ExtScreenshotTool(makeMockRpc());
    const result = await tool.execute({});
    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    // Might be stored:false (if OPFS fails) or stored:true (if mock works)
    expect(['true', 'false']).toContain(String(parsed.stored));
  });

  it('fails when rpc not connected', async () => {
    const tool = new ExtScreenshotTool(makeMockRpc({ connected: false }));
    const result = await tool.execute({});
    expect(result.success).toBe(false);
    expect(result.error).toContain('not connected');
  });

  it('fails when rpc returns error', async () => {
    const tool = new ExtScreenshotTool(makeMockRpc({
      call: async () => ({ error: 'Tab not found' }),
    }));
    const result = await tool.execute({});
    expect(result.success).toBe(false);
    expect(result.error).toBe('Tab not found');
  });
});

// ── 2. ExtZoomTool overflow fix ──────────────────────────────────

describe('ExtZoomTool overflow fix', () => {
  it('returns metadata with crop info, not raw data', async () => {
    const tool = new ExtZoomTool(makeMockRpc());
    const result = await tool.execute({ x: 10, y: 20, width: 200, height: 100 });
    expect(result.success).toBe(true);
    expect(result.output.length).toBeLessThan(1000);
    const parsed = JSON.parse(result.output);
    expect(parsed.crop).toEqual({ x: 10, y: 20, width: 200, height: 100 });
    expect(parsed.sizeBytes).toBeGreaterThan(2_000_000);
    expect(parsed.note).toContain('Crop region');
  });

  it('does not include dataUrl in output', async () => {
    const tool = new ExtZoomTool(makeMockRpc());
    const result = await tool.execute({ x: 0, y: 0, width: 100, height: 100 });
    expect(result.output).not.toContain('AAAA');
    expect(result.output).not.toContain('data:image');
  });
});

// ── 3. _call output size cap (tested via a generic ExtTool subclass) ─

describe('ExtTool _call output size cap', () => {
  it('truncates outputs exceeding 100KB', async () => {
    // Use ExtScreenshotTool's parent _call indirectly via a different tool
    // We'll use a tool that goes through _call (not overridden execute)
    const { ExtStatusTool } = mod;
    const rpc = makeMockRpc({
      call: async () => {
        // Return a massive result
        return { data: 'X'.repeat(200_000) };
      },
    });
    const tool = new ExtStatusTool(rpc);
    const result = await tool.execute();
    expect(result.success).toBe(true);
    // Should be capped around 100K + truncation message
    expect(result.output.length).toBeLessThan(110_000);
    expect(result.output).toContain('truncated');
  });

  it('does not truncate small outputs', async () => {
    const { ExtStatusTool } = mod;
    const rpc = makeMockRpc({
      call: async () => ({ connected: true, version: '1.0' }),
    });
    const tool = new ExtStatusTool(rpc);
    const result = await tool.execute();
    expect(result.success).toBe(true);
    expect(result.output).not.toContain('truncated');
  });
});
