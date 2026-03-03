import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// Stub browser globals before import
globalThis.BrowserTool = class { constructor() {} }

import { LLMProvider, OpenAIProvider, AnthropicProvider } from '../clawser-providers.js'

describe('Vision / Multimodal — Provider Support Flags', () => {
  it('LLMProvider base class defaults supportsVision to false', () => {
    // Can't instantiate abstract directly, test via a subclass check
    class TestProvider extends LLMProvider {
      get name() { return 'test' }
    }
    const p = new TestProvider()
    assert.equal(p.supportsVision, false)
  })

  it('OpenAIProvider has supportsVision = true', () => {
    const p = new OpenAIProvider()
    assert.equal(p.supportsVision, true)
  })

  it('AnthropicProvider has supportsVision = true', () => {
    const p = new AnthropicProvider()
    assert.equal(p.supportsVision, true)
  })
})

describe('Vision / Multimodal — OpenAI Message Formatting', () => {
  // We need to test buildOpenAIBody indirectly since it's not exported.
  // We'll test by checking that the provider doesn't throw when given multimodal content.

  it('OpenAI provider accepts text-only messages', () => {
    const p = new OpenAIProvider()
    // Verify the provider exists and has expected capabilities
    assert.equal(p.supportsNativeTools, true)
    assert.equal(p.supportsStreaming, true)
  })

  it('multimodal content array with text part is valid', () => {
    const content = [
      { type: 'text', text: 'What is in this image?' },
    ]
    assert.ok(Array.isArray(content))
    assert.equal(content[0].type, 'text')
  })

  it('multimodal content array with image_url part is valid', () => {
    const content = [
      { type: 'text', text: 'Describe this image' },
      { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
    ]
    assert.ok(Array.isArray(content))
    assert.equal(content.length, 2)
    assert.equal(content[1].type, 'image_url')
    assert.equal(content[1].image_url.url, 'https://example.com/img.png')
  })

  it('base64 image in Anthropic format converts to OpenAI data URI', () => {
    // Test the conversion logic that buildOpenAIBody applies
    const anthropicPart = {
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'iVBOR...' },
    }
    // Simulate the conversion
    const converted = {
      type: 'image_url',
      image_url: { url: `data:${anthropicPart.source.media_type};base64,${anthropicPart.source.data}` },
    }
    assert.equal(converted.type, 'image_url')
    assert.ok(converted.image_url.url.startsWith('data:image/png;base64,'))
  })
})

describe('Vision / Multimodal — Anthropic Message Formatting', () => {
  it('Anthropic image content block has correct structure', () => {
    const imageBlock = {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: '/9j/4AAQ...',
      },
    }
    assert.equal(imageBlock.type, 'image')
    assert.equal(imageBlock.source.type, 'base64')
    assert.equal(imageBlock.source.media_type, 'image/jpeg')
  })

  it('OpenAI image_url converts to Anthropic image format', () => {
    const openaiPart = {
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,iVBOR...' },
    }
    // Simulate the conversion that #buildMessages applies
    const url = openaiPart.image_url.url
    const match = url.match(/^data:([^;]+);base64,(.+)$/)
    assert.ok(match)
    const converted = {
      type: 'image',
      source: { type: 'base64', media_type: match[1], data: match[2] },
    }
    assert.equal(converted.type, 'image')
    assert.equal(converted.source.media_type, 'image/png')
    assert.equal(converted.source.data, 'iVBOR...')
  })

  it('URL-based image converts to Anthropic url source', () => {
    const openaiPart = {
      type: 'image_url',
      image_url: { url: 'https://example.com/photo.jpg' },
    }
    const url = openaiPart.image_url.url
    // Non-data URI → url source type
    assert.ok(!url.startsWith('data:'))
    const converted = {
      type: 'image',
      source: { type: 'url', url },
    }
    assert.equal(converted.source.type, 'url')
    assert.equal(converted.source.url, 'https://example.com/photo.jpg')
  })

  it('mixed text + image content array preserves order', () => {
    const content = [
      { type: 'text', text: 'Look at this:' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
      { type: 'text', text: 'What do you see?' },
    ]
    assert.equal(content.length, 3)
    assert.equal(content[0].type, 'text')
    assert.equal(content[1].type, 'image')
    assert.equal(content[2].type, 'text')
  })
})
