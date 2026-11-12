// Walk every path before execution, including paths not selected by current telemetry.
export function sequenceReferences(steps, out = []) {
  for (const step of steps) {
    if (step.type === 'runSaved') out.push(step);
    if (step.type === 'if') { sequenceReferences(step.then, out); sequenceReferences(step.else || [], out); }
  }
  return out;
}
export function snapshotSequence(root, resolve, validate = (value) => value) {
  const dependencies = new Map();
  let work = 0;
  const visit = (definition, ancestry, depth) => {
    if (depth > 8) throw new Error('Sequence nesting limit exceeded');
    if (definition.id && ancestry.includes(definition.id)) throw new Error('Recursive saved sequence reference');
    const next = [...ancestry, definition.id];
    const walk = (steps, level) => {
      if (level > 8) throw new Error('Sequence nesting limit exceeded');
      for (const step of steps) {
        if (++work > 1000) throw new Error('Expanded sequence work limit exceeded');
        if (step.type === 'if') { walk(step.then, level + 1); walk(step.else || [], level + 1); }
        if (step.type === 'runSaved') {
          if (next.includes(step.sequenceId)) throw new Error('Recursive saved sequence reference');
          const key = `${step.sequenceId}@${step.revision}`;
          const child = dependencies.get(key) || validate(resolve(step.sequenceId, step.revision));
          if (!child || child.id !== step.sequenceId || child.revision !== step.revision) throw new Error('Missing saved sequence revision');
          dependencies.set(key, child);
          visit(child, next, level + 1);
        }
      }
    };
    walk(definition.steps, depth);
  };
  const validated = validate(root);
  visit(validated, [], 0);
  const snapshot = structuredClone({ ...validated, dependencies: [...dependencies.values()] });
  if (Buffer.byteLength(JSON.stringify(snapshot)) > 1_048_576) throw new Error('Sequence dependency snapshot is too large');
  return snapshot;
}
