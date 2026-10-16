import { querySudo } from '@lblod/mu-auth-sudo';
import { sparqlEscapeUri } from 'mu';
import { incrementCounter, setGauge } from '../metrics';
import { onSparqlError } from '../sparql-errors';
export const config = {
  streams: {
    'https://mandatenbeheer.lokaalbestuur.vlaanderen.be/streams/ldes/public': {
      name: 'Public Stream',
      content: 'http://mu.semte.ch/graphs/ldes-validation/public/content',
      status: 'http://mu.semte.ch/graphs/ldes-validation/public/status',
      onShapeChange: async (streamUri, _path) => {
        await incrementCounter(
          'ldes_watchman_shape_changes_total',
          config.streams[streamUri].name,
        );
        await setGauge(
          'ldes_watchman_last_shape_change_timestamp_seconds',
          new Date().getTime() / 1000,
          config.streams[streamUri].name,
        );
      },
      sparqlVerify: async (streamUri, content) => {
        const results = await querySudo(`
          SELECT (COUNT(?membership) AS ?count) WHERE {
            {
              SELECT ?membership WHERE {
                GRAPH ${sparqlEscapeUri(content)} {
                  ?membership a <http://www.w3.org/ns/org#Membership> ;
                    <http://www.w3.org/ns/org#organisation> ?organisation .
                }
              } GROUP BY ?membership HAVING (COUNT(DISTINCT ?organisation) > 1)
            }
          }
        `);
        const count = parseInt(
          results?.results.bindings[0]?.count?.value || '0',
        );
        if (count > 0) {
          await onSparqlError(
            streamUri,
            'membership-multiple-organisations',
            { count },
          );
        }
      },
    },
  },
} as Config;

export type Config = {
  streams: Record<
    string,
    {
      name: string;
      content: string;
      status: string;
      onShapeChange?: (streamUri: string, path: String) => Promise<void>;
      sparqlVerify?: (streamUri: string, content: string) => Promise<void>;
    }
  >;
};
