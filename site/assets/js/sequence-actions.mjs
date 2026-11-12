export function hasUnsavedChanges(draft, snapshot) {
  return !!draft && (snapshot ? JSON.stringify(draft) !== snapshot : !!(draft.name || draft.steps?.length || draft.registers?.length));
}
export function confirmDiscard(draft, snapshot, confirm = globalThis.confirm) {
  return !hasUnsavedChanges(draft, snapshot) || confirm(`Discard unsaved changes to "${draft.name || 'Untitled Branch Definition'}"${draft.revision ? ` (based on revision ${draft.revision})` : ''}? Cancel keeps your edits.`);
}
export async function saveDefinition(draft, request, confirm = globalThis.confirm) {
  let content = structuredClone(draft);
  if (content.id && !confirm(`Overwrite "${content.name}" (${content.id}) revision ${content.revision}? This replaces the saved definition with your edits as a new revision. Historical runs and pinned references keep their original snapshots. Cancel keeps your edits.`)) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return (await request(content.id ? `/sequences/${encodeURIComponent(content.id)}` : '/sequences', {
        method: content.id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...content, ...(content.id ? { confirmed_revision: content.revision } : {}) })
      })).sequence;
    } catch (error) {
      if (error.status !== 409 || error.data?.code !== 'revision_conflict' || attempt) throw error;
      const current = error.data.current;
      if (!current || !confirm(`Overwrite "${current.name}" (${current.id}) revision ${current.revision}? It changed since you loaded revision ${draft.revision}. Your edits will replace that saved revision. Historical runs and pinned references remain unchanged. Cancel keeps your edits.`)) return null;
      content = { ...content, revision: current.revision };
    }
  }
}
export async function deleteDefinition(target, request, confirm = globalThis.confirm) {
  if (!confirm(`Delete "${target.name}" (${target.id}) revision ${target.revision}? It will disappear from saved Branch Definitions. Historical runs remain available. Saved definitions that reference it prevent deletion. Editor contents are retained as an unsaved copy. Cancel makes no changes.`)) return false;
  await request(`/sequences/${encodeURIComponent(target.id)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: target.revision, confirmed_revision: target.revision }) });
  return true;
}
