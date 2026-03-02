/**
 * clawser-ui-identity-editor.js — Full AIEOS v1.1 identity editor.
 *
 * Renders fields for all identity facets: names, bio, psychology,
 * linguistics, motivations, capabilities, physicality.
 * Includes template picker, avatar preview, and JSON import/export.
 */
import { $, esc, state, lsKey } from './clawser-state.js';
import { addMsg } from './clawser-ui-chat.js';

const IDENTITY_TEMPLATES = {
  assistant: {
    label: 'Helpful Assistant',
    identity: {
      version: '1.1',
      names: { display: 'Assistant', aliases: [] },
      bio: 'A helpful, harmless, and honest AI assistant.',
      psychology: { traits: ['helpful', 'patient', 'thorough'], values: ['accuracy', 'helpfulness'] },
      linguistics: { tone: 'friendly and clear', vocabulary: 'general', formality: 'moderate' },
      motivations: { primary: 'Help users accomplish their goals', secondary: ['Learn from interactions'] },
      capabilities: { strengths: ['reasoning', 'coding', 'writing'], limitations: ['no internet access in sandbox'] },
      physicality: { avatar_url: '' },
    },
  },
  coder: {
    label: 'Code Expert',
    identity: {
      version: '1.1',
      names: { display: 'CodeBot', aliases: ['dev'] },
      bio: 'A specialized coding assistant focused on software engineering.',
      psychology: { traits: ['precise', 'analytical', 'detail-oriented'], values: ['correctness', 'clean code'] },
      linguistics: { tone: 'technical and concise', vocabulary: 'technical', formality: 'low' },
      motivations: { primary: 'Write excellent code', secondary: ['Teach best practices'] },
      capabilities: { strengths: ['debugging', 'architecture', 'refactoring'], limitations: [] },
      physicality: { avatar_url: '' },
    },
  },
  creative: {
    label: 'Creative Writer',
    identity: {
      version: '1.1',
      names: { display: 'Muse', aliases: [] },
      bio: 'A creative writing partner with vivid imagination.',
      psychology: { traits: ['imaginative', 'expressive', 'empathetic'], values: ['originality', 'storytelling'] },
      linguistics: { tone: 'warm and evocative', vocabulary: 'rich', formality: 'varies' },
      motivations: { primary: 'Inspire and co-create', secondary: ['Explore new perspectives'] },
      capabilities: { strengths: ['storytelling', 'poetry', 'worldbuilding'], limitations: [] },
      physicality: { avatar_url: '' },
    },
  },
};

/**
 * Render the full identity editor into a container.
 * @param {HTMLElement} container
 */
export function renderIdentityEditor(container) {
  if (!container) return;

  const wsId = state.agent?.getWorkspace() || 'default';
  const saved = _loadIdentity(wsId);

  container.innerHTML = `
    <div class="identity-editor">
      <div class="ide-section">
        <label class="ide-label">Template</label>
        <select class="ide-select" id="ideTemplate">
          <option value="">Custom</option>
          ${Object.entries(IDENTITY_TEMPLATES).map(([k, v]) =>
            `<option value="${k}">${esc(v.label)}</option>`
          ).join('')}
        </select>
      </div>

      <div class="ide-section">
        <label class="ide-label">Display Name</label>
        <input type="text" id="ideDisplayName" class="ide-input" value="${esc(saved?.names?.display || '')}" />
      </div>
      <div class="ide-section">
        <label class="ide-label">Aliases (comma-separated)</label>
        <input type="text" id="ideAliases" class="ide-input" value="${esc((saved?.names?.aliases || []).join(', '))}" />
      </div>
      <div class="ide-section">
        <label class="ide-label">Bio</label>
        <textarea id="ideBio" class="ide-textarea" rows="2">${esc(saved?.bio || '')}</textarea>
      </div>

      <div class="ide-section ide-group">
        <div class="ide-group-title">Psychology</div>
        <label class="ide-label">Traits (comma-separated)</label>
        <input type="text" id="ideTraits" class="ide-input" value="${esc((saved?.psychology?.traits || []).join(', '))}" />
        <label class="ide-label">Values</label>
        <input type="text" id="ideValues" class="ide-input" value="${esc((saved?.psychology?.values || []).join(', '))}" />
      </div>

      <div class="ide-section ide-group">
        <div class="ide-group-title">Linguistics</div>
        <label class="ide-label">Tone</label>
        <input type="text" id="ideTone" class="ide-input" value="${esc(saved?.linguistics?.tone || '')}" />
        <label class="ide-label">Vocabulary</label>
        <input type="text" id="ideVocab" class="ide-input" value="${esc(saved?.linguistics?.vocabulary || '')}" />
        <label class="ide-label">Formality</label>
        <select id="ideFormality" class="ide-select">
          <option value="low" ${saved?.linguistics?.formality === 'low' ? 'selected' : ''}>Low</option>
          <option value="moderate" ${saved?.linguistics?.formality === 'moderate' || !saved?.linguistics?.formality ? 'selected' : ''}>Moderate</option>
          <option value="high" ${saved?.linguistics?.formality === 'high' ? 'selected' : ''}>High</option>
          <option value="varies" ${saved?.linguistics?.formality === 'varies' ? 'selected' : ''}>Varies</option>
        </select>
      </div>

      <div class="ide-section ide-group">
        <div class="ide-group-title">Motivations</div>
        <label class="ide-label">Primary</label>
        <input type="text" id="ideMotivPrimary" class="ide-input" value="${esc(saved?.motivations?.primary || '')}" />
        <label class="ide-label">Secondary (comma-separated)</label>
        <input type="text" id="ideMotivSecondary" class="ide-input" value="${esc((saved?.motivations?.secondary || []).join(', '))}" />
      </div>

      <div class="ide-section ide-group">
        <div class="ide-group-title">Capabilities</div>
        <label class="ide-label">Strengths</label>
        <input type="text" id="ideStrengths" class="ide-input" value="${esc((saved?.capabilities?.strengths || []).join(', '))}" />
        <label class="ide-label">Limitations</label>
        <input type="text" id="ideLimitations" class="ide-input" value="${esc((saved?.capabilities?.limitations || []).join(', '))}" />
      </div>

      <div class="ide-section ide-group">
        <div class="ide-group-title">Physicality</div>
        <label class="ide-label">Avatar URL</label>
        <input type="text" id="ideAvatarUrl" class="ide-input" value="${esc(saved?.physicality?.avatar_url || '')}" />
        <div class="ide-avatar-preview" id="ideAvatarPreview">
          ${saved?.physicality?.avatar_url ? `<img src="${esc(saved.physicality.avatar_url)}" alt="avatar" />` : '<span class="ide-no-avatar">No avatar</span>'}
        </div>
      </div>

      <div class="ide-actions">
        <button class="btn-sm" id="ideApply">Apply</button>
        <button class="btn-sm btn-surface2" id="ideExportJson">Export JSON</button>
        <label class="btn-sm btn-surface2 ide-import-label">
          Import JSON <input type="file" id="ideImportJson" accept=".json" style="display:none;" />
        </label>
      </div>
    </div>
  `;

  // Template picker
  container.querySelector('#ideTemplate').addEventListener('change', (e) => {
    const key = e.target.value;
    if (key && IDENTITY_TEMPLATES[key]) {
      _populateFromIdentity(container, IDENTITY_TEMPLATES[key].identity);
    }
  });

  // Avatar preview
  container.querySelector('#ideAvatarUrl').addEventListener('input', (e) => {
    const preview = container.querySelector('#ideAvatarPreview');
    const url = e.target.value.trim();
    preview.innerHTML = url ? `<img src="${esc(url)}" alt="avatar" />` : '<span class="ide-no-avatar">No avatar</span>';
  });

  // Apply
  container.querySelector('#ideApply').addEventListener('click', () => {
    const identity = _collectIdentity(container);
    _saveIdentity(wsId, identity);
    _applyIdentity(identity);
    addMsg('system', 'Identity applied.');
  });

  // Export
  container.querySelector('#ideExportJson').addEventListener('click', () => {
    const identity = _collectIdentity(container);
    const blob = new Blob([JSON.stringify(identity, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `identity-${identity.names?.display || 'export'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // Import
  container.querySelector('#ideImportJson').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const identity = JSON.parse(text);
      _populateFromIdentity(container, identity);
      addMsg('system', 'Identity imported. Click Apply to activate.');
    } catch (err) {
      addMsg('error', `Import failed: ${err.message}`);
    }
  });
}

function _splitCsv(s) {
  return s ? s.split(',').map(x => x.trim()).filter(Boolean) : [];
}

function _collectIdentity(container) {
  return {
    version: '1.1',
    names: {
      display: container.querySelector('#ideDisplayName')?.value || '',
      aliases: _splitCsv(container.querySelector('#ideAliases')?.value),
    },
    bio: container.querySelector('#ideBio')?.value || '',
    psychology: {
      traits: _splitCsv(container.querySelector('#ideTraits')?.value),
      values: _splitCsv(container.querySelector('#ideValues')?.value),
    },
    linguistics: {
      tone: container.querySelector('#ideTone')?.value || '',
      vocabulary: container.querySelector('#ideVocab')?.value || '',
      formality: container.querySelector('#ideFormality')?.value || 'moderate',
    },
    motivations: {
      primary: container.querySelector('#ideMotivPrimary')?.value || '',
      secondary: _splitCsv(container.querySelector('#ideMotivSecondary')?.value),
    },
    capabilities: {
      strengths: _splitCsv(container.querySelector('#ideStrengths')?.value),
      limitations: _splitCsv(container.querySelector('#ideLimitations')?.value),
    },
    physicality: {
      avatar_url: container.querySelector('#ideAvatarUrl')?.value || '',
    },
  };
}

function _populateFromIdentity(container, identity) {
  const set = (id, val) => { const el = container.querySelector(`#${id}`); if (el) el.value = val; };
  set('ideDisplayName', identity.names?.display || '');
  set('ideAliases', (identity.names?.aliases || []).join(', '));
  set('ideBio', identity.bio || '');
  set('ideTraits', (identity.psychology?.traits || []).join(', '));
  set('ideValues', (identity.psychology?.values || []).join(', '));
  set('ideTone', identity.linguistics?.tone || '');
  set('ideVocab', identity.linguistics?.vocabulary || '');
  set('ideFormality', identity.linguistics?.formality || 'moderate');
  set('ideMotivPrimary', identity.motivations?.primary || '');
  set('ideMotivSecondary', (identity.motivations?.secondary || []).join(', '));
  set('ideStrengths', (identity.capabilities?.strengths || []).join(', '));
  set('ideLimitations', (identity.capabilities?.limitations || []).join(', '));
  set('ideAvatarUrl', identity.physicality?.avatar_url || '');
  // Update avatar preview
  const preview = container.querySelector('#ideAvatarPreview');
  const url = identity.physicality?.avatar_url || '';
  if (preview) preview.innerHTML = url ? `<img src="${esc(url)}" alt="avatar" />` : '<span class="ide-no-avatar">No avatar</span>';
}

function _loadIdentity(wsId) {
  try {
    const raw = localStorage.getItem(`clawser_identity_full_${wsId}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function _saveIdentity(wsId, identity) {
  localStorage.setItem(`clawser_identity_full_${wsId}`, JSON.stringify(identity));
}

function _applyIdentity(identity) {
  if (!state.identityManager) return;
  try {
    state.identityManager.load(identity);
    const compiled = state.identityManager.compile();
    if (compiled && state.agent) state.agent.setSystemPrompt(compiled);
  } catch (e) {
    console.warn('[clawser] identity apply failed', e);
  }
}

export { IDENTITY_TEMPLATES };
