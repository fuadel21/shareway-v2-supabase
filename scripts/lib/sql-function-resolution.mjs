const FUNCTION_DEFINITION = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi;

export const collectFunctionDefinitions = (sql) => {
  const definitions = new Map();
  const matches = [...sql.matchAll(FUNCTION_DEFINITION)];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const name = match[1].toLowerCase();
    const start = match.index;
    const end = matches[index + 1]?.index ?? sql.length;
    const entry = {
      name,
      index: start,
      body: sql.slice(start, end),
    };

    const existing = definitions.get(name) ?? [];
    existing.push(entry);
    definitions.set(name, existing);
  }

  return definitions;
};

export const getEffectiveFunctionBody = (definitions, name) => {
  const entries = definitions.get(String(name).toLowerCase()) ?? [];
  return entries.at(-1)?.body ?? '';
};

const referencedFunctionNames = (body) => {
  const references = new Set();
  const callPattern = /(?:select|perform|return\s+query\s+select)\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi;

  for (const match of body.matchAll(callPattern)) {
    references.add(match[1].toLowerCase());
  }

  return [...references];
};

export const resolveEffectiveFunctionChain = (definitions, rootName, seen = new Set()) => {
  const normalizedName = String(rootName).toLowerCase();
  if (seen.has(normalizedName)) return '';

  const body = getEffectiveFunctionBody(definitions, normalizedName);
  if (!body) return '';

  const nextSeen = new Set(seen);
  nextSeen.add(normalizedName);

  const delegatedBodies = referencedFunctionNames(body)
    .filter((name) => definitions.has(name))
    .map((name) => resolveEffectiveFunctionChain(definitions, name, nextSeen))
    .filter(Boolean);

  return [body, ...delegatedBodies].join('\n\n-- RESOLVED DELEGATE --\n');
};
