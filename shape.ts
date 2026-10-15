import { querySudo } from '@lblod/mu-auth-sudo';
import { config } from './config/config';
import { sparqlEscapeUri } from 'mu';

/**
 * Returns the shape of the contents of a graph.
 * Not using SHACL here for simplicity and because we want to easily compare the shape to previous versions
 */
export async function getShape(streamUri: string) {
  const graph = config.streams[streamUri].content;

  const results = await querySudo(`
    SELECT ?type ?predicate (STR(?datatype) AS ?datatype) ?cardinality WHERE {
      GRAPH ${sparqlEscapeUri(graph)} {
        ?s a ?type .
        ?s ?predicate ?object .
        BIND(IF(ISLITERAL(?object), STR(DATATYPE(?object)), IF(ISBLANK(?object), "blank node", "uri")) AS ?datatype)
        OPTIONAL {
          ?s ?predicate ?object2.
          FILTER(?object != ?object2)
        }
        BIND(IF(BOUND(?object2), "many", "one") AS ?cardinality)
      }
    } GROUP BY ?type ?predicate ?datatype ?cardinality ORDER BY ?type ?predicate ?datatype
  `);

  return groupShapes(streamUri, results?.results.bindings || []);
}

/**
 * Nest the sorted query results, one entry per type,
 * one entry per predicate within a type and one datatype per predicate.
 */
export function groupShapes(streamUri: string, bindings: ShapeBinding[]) {
  const types = [] as ShapeType[];
  let currentType: ShapeType | undefined = undefined;
  let currentPredicate: ShapePredicate | undefined = undefined;

  for (const binding of bindings) {
    if (binding.type?.value != currentType?.type) {
      currentType = { type: binding.type?.value, predicates: [] };
      types.push(currentType);
      currentPredicate = undefined;
    }
    if (binding.predicate?.value != currentPredicate?.predicate) {
      currentPredicate = {
        predicate: binding.predicate?.value,
        datatypes: [],
        cardinality: binding.cardinality?.value,
      };
      currentType?.predicates.push(currentPredicate);
    } else if (currentPredicate && currentPredicate.cardinality != 'many') {
      currentPredicate.cardinality = 'many';
    }
    currentPredicate?.datatypes.push(binding.datatype?.value);
  }

  return {
    streamUri,
    types,
  };
}

export type ShapeType = {
  type?: unknown;
  predicates: ShapePredicate[];
};

export type ShapePredicate = {
  predicate?: unknown;
  cardinality?: unknown;
  datatypes: unknown[];
};

export type ShapeBinding = {
  type?: { value?: unknown };
  predicate?: { value?: unknown };
  datatype?: { value?: unknown };
  cardinality?: { value?: unknown };
};
