import { querySudo } from '@lblod/mu-auth-sudo';
import { config } from './config/config';
import { Filters } from './types';
import { sparqlEscapeDateTime, sparqlEscapeUri } from 'mu';

export async function getStatistics(streamUri: string, filters: Filters) {
  return {
    typeDistribution: await getTypeDistribution(streamUri, filters),
  };
}

async function getTypeDistribution(streamUri: string, { from, to }: Filters) {
  const graph = config.streams[streamUri].content;

  let fromFilter = '';
  if (from) {
    fromFilter = `FILTER(?time >= ${sparqlEscapeDateTime(from)})`;
  }
  let toFilter = '';
  if (to) {
    toFilter = `FILTER(?time <= ${sparqlEscapeDateTime(to)})`;
  }

  const results = await querySudo(`
    SELECT ?thing (COUNT( DISTINCT ?s) AS ?count) WHERE {
      GRAPH ${sparqlEscapeUri(graph)} {
        ?s a ?thing .
        ?s <http://www.w3.org/ns/prov#generatedAtTime> ?time .
      }
      ${fromFilter}
      ${toFilter}
    } GROUP BY ?thing ORDER BY DESC(?count)
  `);

  return results?.results.bindings.map((binding) => ({
    type: binding.thing.value,
    count: parseInt(binding.count.value),
  }));
}
