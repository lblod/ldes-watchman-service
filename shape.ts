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
    SELECT ?type ?predicate (STR(?datatype) AS ?datatype) WHERE {
      GRAPH ${sparqlEscapeUri(graph)} {
        ?s a ?type .
        ?s ?predicate ?object .
        BIND(IF(ISLITERAL(?object), STR(DATATYPE(?object)), IF(ISBLANK(?object), "blank node", "uri")) AS ?datatype)
      }
    } GROUP BY ?type ?predicate ?datatype ORDER BY ?type ?predicate ?datatype
  `);

  return groupShapes(streamUri, results?.results.bindings || []);
}

/**
 * Nest the sorted query results, one entry per type,
 * one entry per predicate within a type and one datatype per predicate.
 */
export function groupShapes(streamUri: string, bindings: ShapeBinding[]) {
  const types = [];
  let currentType: ShapeType | undefined = undefined;
  let currentPredicate: ShapePredicate | undefined = undefined;

  for (const binding of bindings) {
    if (binding.type?.value != currentType?.type) {
      currentType = { type: binding.type?.value, predicates: [] };
      types.push(currentType);
      currentPredicate = undefined;
    }
    if (binding.predicate?.value != currentPredicate?.predicate) {
      currentPredicate = { predicate: binding.predicate?.value, datatypes: [] };
      currentType?.predicates.push(currentPredicate);
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
  datatypes: unknown[];
};

export type ShapeBinding = {
  type?: { value?: unknown };
  predicate?: { value?: unknown };
  datatype?: { value?: unknown };
};
