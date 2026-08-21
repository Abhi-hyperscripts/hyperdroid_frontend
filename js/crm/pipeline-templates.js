/**
 * CRM Settings → Pipeline → Start from a template
 * ----------------------------------------------------------------------------
 * The generic Qualification → Proposal → Negotiation pipeline describes nothing
 * a loan DSA or an insurance desk actually does: their deal moves through an
 * APPLICATION — submitted, under underwriting, sanctioned, disbursed — and each
 * of those is a different conversation with a different next action.
 *
 *   GET  /crm/deal-stages/templates       the catalogue + pipelines already in use
 *   POST /crm/deal-stages/apply-template  create one
 *
 * Applying a template creates a NEW pipeline. It is refused on a pipeline that
 * already has stages — merging would leave two closing stages and make which one
 * closes a deal depend on row order.
 */

let pipelineTemplateCatalogue = null;
let pipelineTemplateExisting = [];

function pltpEsc(t) {
    return String(t ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function openPipelineTemplates() {
    const box = document.getElementById('pipelineTemplatesBox');
    if (!box) return;

    // Toggle: a second click on the same button closes it again, so the
    // stage list is never permanently pushed down the page.
    if (box.style.display !== 'none' && pipelineTemplateCatalogue) {
        box.style.display = 'none';
        return;
    }

    box.style.display = '';
    document.getElementById('pipelineTemplatesGrid').innerHTML =
        '<div class="crm-loading"><div class="crm-loading-spinner"></div></div>';

    try {
        const res = await api.request('/crm/deal-stages/templates');
        pipelineTemplateCatalogue = (res && res.templates) || [];
        pipelineTemplateExisting = (res && res.existing_pipelines) || [];
        renderPipelineTemplates();
    } catch (e) {
        console.error('Failed to load pipeline templates:', e);
        Toast.error(e.message || 'Could not load the templates');
        box.style.display = 'none';
    }
}

function renderPipelineTemplates() {
    const grid = document.getElementById('pipelineTemplatesGrid');
    if (!grid) return;

    grid.innerHTML = pipelineTemplateCatalogue.map(t => {
        // A template whose suggested name is taken is shown as ALREADY IN USE
        // rather than hidden: the admin needs to know it exists, and can still
        // apply it under a different name.
        const taken = pipelineTemplateExisting.includes(t.default_pipeline_name);
        return `
        <article class="pltp-card">
            <h4>${pltpEsc(t.label)}</h4>
            <p class="pltp-desc">${pltpEsc(t.description)}</p>
            <div class="pltp-stages">
                ${(t.stages || []).map(s => `
                    <span class="pltp-stage${s.type === 'won' ? ' is-won' : s.type === 'lost' ? ' is-lost' : ''}">
                        ${pltpEsc(s.name)}
                    </span>`).join('')}
            </div>
            <div class="pltp-foot">
                <span class="pltp-exists">${taken
                    ? `“${pltpEsc(t.default_pipeline_name)}” already exists`
                    : `Creates “${pltpEsc(t.default_pipeline_name)}”`}</span>
                <button type="button" class="btn btn-sm btn-primary"
                        data-pltp-apply="${pltpEsc(t.key)}">Use this</button>
            </div>
        </article>`;
    }).join('');

    // Delegated once per render — the grid is replaced wholesale, so the
    // previous handler goes with the nodes it was attached to.
    grid.onclick = async (e) => {
        const btn = e.target.closest('[data-pltp-apply]');
        if (btn) await applyPipelineTemplate(btn.getAttribute('data-pltp-apply'), btn);
    };
}

async function applyPipelineTemplate(key, btn) {
    const template = pipelineTemplateCatalogue.find(t => t.key === key);
    if (!template) return;

    let pipelineName = template.default_pipeline_name;
    if (pipelineTemplateExisting.includes(pipelineName)) {
        // Ask BEFORE the round trip. The server refuses either way, but a
        // refusal the admin could have avoided reads as a bug in the product.
        const chosen = await Prompt.show({
            title: 'Name this pipeline',
            message: `A pipeline called “${pipelineName}” already exists. Give this one a different name.`,
            defaultValue: `${pipelineName} 2`,
            confirmText: 'Create',
        });
        if (chosen === null) return;
        if (!String(chosen).trim()) { Toast.error('A pipeline needs a name'); return; }
        pipelineName = String(chosen).trim();
    }

    if (btn) btn.disabled = true;
    try {
        const stages = await api.request('/crm/deal-stages/apply-template', {
            method: 'POST',
            body: JSON.stringify({ template: key, pipeline_name: pipelineName }),
        });
        Toast.success(`“${pipelineName}” created with ${stages.length} stages`);

        // Refresh BOTH: the stage list below, and the catalogue's
        // already-in-use markers, which are now stale.
        pipelineTemplateExisting.push(pipelineName);
        renderPipelineTemplates();
        if (typeof loadDealStages === 'function') await loadDealStages();
    } catch (e) {
        console.error('Failed to apply the pipeline template:', e);
        Toast.error(e.message || 'Could not create the pipeline');
    } finally {
        if (btn) btn.disabled = false;
    }
}
