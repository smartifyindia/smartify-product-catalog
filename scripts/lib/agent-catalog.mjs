const SCHEMA_VERSION = 'smartify.agent-catalog.v1';
const SENSITIVE_PATH = /(?:^|\.)(?:dealer|cost|margin|wholesale)[^.]*/i;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])])
    );
  }
  return value;
}

function readPath(source, path) {
  return path.split('.').reduce((value, key) => value?.[key], source);
}

function approvedFacts(product) {
  const paths = product.agent?.approved_fact_paths;
  if (!Array.isArray(paths)) {
    throw new Error(`${product.sku}: agent.approved_fact_paths is required`);
  }

  return paths.map((path) => {
    if (SENSITIVE_PATH.test(path)) throw new Error(`${path} is not allowed for agent facts`);
    const value = readPath(product, path);
    if (value === undefined || value === null || value === '') {
      throw new Error(`${product.sku}: approved fact ${path} is missing`);
    }
    return { fact_id: `${product.sku}:${path}`, path, value };
  });
}

export function buildAgentCatalog(products) {
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error('agent catalog requires at least one product');
  }

  const artifactProducts = products
    .map((product) => {
      const { agent, ...publicProduct } = product;
      if (!product.sku) throw new Error('agent catalog product is missing sku');
      if (!Array.isArray(agent?.aliases)) {
        throw new Error(`${product.sku}: agent.aliases is required`);
      }
      return {
        ...publicProduct,
        aliases: [...agent.aliases],
        approved_facts: approvedFacts(product),
      };
    })
    .sort((a, b) => a.sku.localeCompare(b.sku));

  return stableValue({ schema_version: SCHEMA_VERSION, products: artifactProducts });
}

export function serializeAgentCatalog(artifact) {
  return `${JSON.stringify(stableValue(artifact), null, 2)}\n`;
}
