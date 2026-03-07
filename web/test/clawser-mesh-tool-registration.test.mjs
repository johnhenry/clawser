/**
 * Mesh tool registration integration test.
 * Verifies that registerMeshTools and registerIdentityTools register
 * the expected tools into a registry.
 *
 * Run: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-mesh-tool-registration.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { registerMeshTools } from '../clawser-mesh-tools.js'
import { registerIdentityTools } from '../clawser-mesh-identity-tools.js'
import { StreamMultiplexer } from '../clawser-mesh-streams.js'
import { MeshFileTransfer } from '../clawser-mesh-files.js'

describe('registerMeshTools — integration', () => {
  it('registers 15 mesh tools into a registry', () => {
    const registered = []
    const registry = { register(tool) { registered.push(tool) } }

    registerMeshTools(registry)

    assert.equal(registered.length, 15)

    const names = registered.map(t => t.name)
    assert.ok(names.includes('mesh_stream_open'), 'should include mesh_stream_open')
    assert.ok(names.includes('mesh_file_send'), 'should include mesh_file_send')
    assert.ok(names.includes('dht_store'), 'should include dht_store')
    assert.ok(names.includes('gpu_train_start'), 'should include gpu_train_start')
    assert.ok(names.includes('iot_list'), 'should include iot_list')
  })

  it('injects multiplexer and fileTransfer context', () => {
    const registry = { register() {} }
    const mux = new StreamMultiplexer()
    const ft = new MeshFileTransfer()

    registerMeshTools(registry, mux, ft)

    // If no error, injection succeeded
    assert.ok(true)
  })
})

describe('registerIdentityTools — integration', () => {
  it('registers 8 identity tools into a registry', () => {
    const registered = []
    const registry = { register(tool) { registered.push(tool) } }

    registerIdentityTools(registry)

    assert.equal(registered.length, 8)

    const names = registered.map(t => t.name)
    assert.ok(names.includes('identity_create'), 'should include identity_create')
    assert.ok(names.includes('identity_list'), 'should include identity_list')
    assert.ok(names.includes('identity_switch'), 'should include identity_switch')
    assert.ok(names.includes('identity_export'), 'should include identity_export')
    assert.ok(names.includes('identity_import'), 'should include identity_import')
    assert.ok(names.includes('identity_delete'), 'should include identity_delete')
    assert.ok(names.includes('identity_link'), 'should include identity_link')
    assert.ok(names.includes('identity_select_rule'), 'should include identity_select_rule')
  })
})

describe('Combined registration', () => {
  it('mesh + identity = 23 total tools, no name collisions', () => {
    const registered = []
    const registry = { register(tool) { registered.push(tool) } }

    registerMeshTools(registry)
    registerIdentityTools(registry)

    assert.equal(registered.length, 23)

    const names = registered.map(t => t.name)
    const unique = new Set(names)
    assert.equal(unique.size, 23, 'All tool names should be unique')
  })
})
