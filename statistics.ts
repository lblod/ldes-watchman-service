import { querySudo } from '@lblod/mu-auth-sudo';
import { config } from './config/config';
import { Filters } from './types';
import { sparqlEscapeDateTime, sparqlEscapeUri } from 'mu';

export async function getStatistics(
  streamUri: string,
  filters: Filters,
  type?: string,
) {
  let timeDistribution:
    Awaited<ReturnType<typeof getTimeDistribution>> | undefined = undefined;
  if (filters.from || filters.to) {
    timeDistribution = await getTimeDistribution(streamUri, filters, type);
  }
  return {
    instanceCount: await getInstanceCount(streamUri, filters, type),
    typeDistribution: await getTypeDistribution(streamUri, filters),
    timeDistribution,
    pagesProcessed: await getPagesProcessed(streamUri, filters),
    errorCount: await getErrorCount(streamUri, filters),
    lastProcessedPage: await getLastProcessedPage(streamUri),
    averageLoadDuration: await getAverageLoadDuration(streamUri, filters),
    averageProcessingDuration: await getAverageProcessingDuration(
      streamUri,
      filters,
    ),
  };
}

function buildTimeFilters({ from, to }: Filters) {
  let fromFilter = '';
  if (from) {
    fromFilter = `FILTER(?time >= ${sparqlEscapeDateTime(from)})`;
  }
  let toFilter = '';
  if (to) {
    toFilter = `FILTER(?time <= ${sparqlEscapeDateTime(to)})`;
  }
  return { fromFilter, toFilter };
}

const DAY = 24 * 60 * 60 * 1000;
const MONTH = 30 * DAY;

/**
 * Size of the queried interval in milliseconds.
 * A missing bound counts as "now".
 */
function getInterval({ from, to }: Filters) {
  const now = new Date();
  return (to || now).getTime() - (from || now).getTime();
}

/**
 * Merge daily buckets into weekly buckets (weeks starting Monday),
 * using only ordinal date arithmetic to avoid virtuoso specific functions
 *
 */
function groupDailyBucketsIntoWeeks(
  buckets: { bucket: string; count: number }[],
) {
  const weeks = new Map<string, number>();

  for (const { bucket, count } of buckets) {
    const [year, month, day] = bucket
      .split('-')
      .map((value) => parseInt(value));
    const date = new Date(Date.UTC(year, month - 1, day));
    const daysSinceMonday = (date.getUTCDay() + 6) % 7;
    const weekStart = new Date(date.getTime() - daysSinceMonday * DAY);
    const weekBucket = weekStart.toISOString().slice(0, 10);
    weeks.set(weekBucket, (weeks.get(weekBucket) || 0) + count);
  }

  return [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, count]) => ({ bucket, count }));
}

/**
 * Total number of instances (LDES members) harvested in the period,
 * optionally counted for one specific instance type only.
 */
async function getInstanceCount(
  streamUri: string,
  filters: Filters,
  type?: string,
) {
  const graph = config.streams[streamUri].content;
  const { fromFilter, toFilter } = buildTimeFilters(filters);

  const typePattern = type ? `?s a ${sparqlEscapeUri(type)} .` : '';

  const results = await querySudo(`
    SELECT (COUNT(DISTINCT ?s) AS ?count) WHERE {
      GRAPH ${sparqlEscapeUri(graph)} {
        ?s <http://www.w3.org/ns/prov#generatedAtTime> ?time .
        ${typePattern}
      }
      ${fromFilter}
      ${toFilter}
    }
  `);

  return parseInt(results?.results.bindings[0]?.count?.value || '0');
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

/**
 * Distribution of instances over the period.
 * The bucket size depends on the size of the interval:
 * hourly for intervals up to 1 day, daily up to 1 month
 * and weekly for larger intervals.
 * Optionally filtered by one specific instance type.
 */
export async function getTimeDistribution(
  streamUri: string,
  filters: Filters,
  type?: string,
) {
  const graph = config.streams[streamUri].content;
  const { fromFilter, toFilter } = buildTimeFilters(filters);
  const interval = getInterval(filters);
  const bucketSize = interval > DAY ? 10 : 13; // daily or hourly
  const bucketBind = `BIND(SUBSTR(STR(?time), 1, ${bucketSize}) AS ?bucket)`;

  let typeFilter = '';
  if (type) {
    typeFilter = `FILTER(?thing = ${sparqlEscapeUri(type)})`;
  }

  const results = await querySudo(`
    SELECT ?bucket (COUNT(DISTINCT ?s) AS ?count) WHERE {
      GRAPH ${sparqlEscapeUri(graph)} {
        ?s a ?thing .
        ?s <http://www.w3.org/ns/prov#generatedAtTime> ?time .
      }
      ${bucketBind}
      ${fromFilter}
      ${toFilter}
      ${typeFilter}
    } GROUP BY ?bucket ORDER BY ?bucket
  `);

  const dailyBuckets = results?.results.bindings.map((binding) => ({
    bucket: binding.bucket.value,
    count: parseInt(binding.count.value),
  }));

  if (interval > MONTH) {
    return groupDailyBucketsIntoWeeks(dailyBuckets || []);
  }
  return dailyBuckets;
}

/**
 * Number of pages of the LDES stream that were processed in the period.
 * One observation is recorded per processed page.
 */
async function getPagesProcessed(streamUri: string, { from, to }: Filters) {
  const status = config.streams[streamUri].status;

  let fromFilter = '';
  if (from) {
    fromFilter = `FILTER(?time >= ${sparqlEscapeDateTime(from)})`;
  }
  let toFilter = '';
  if (to) {
    toFilter = `FILTER(?time <= ${sparqlEscapeDateTime(to)})`;
  }

  const results = await querySudo(`
    SELECT (COUNT(DISTINCT ?obs) AS ?count) WHERE {
      GRAPH ${sparqlEscapeUri(status)} {
        ?obs a <http://www.w3.org/ns/sosa/Observation> ;
             <http://www.w3.org/ns/sosa/hasFeatureOfInterest> ${sparqlEscapeUri(
               streamUri,
             )} ;
             <http://www.w3.org/ns/sosa/resultTime> ?time .
      }
      ${fromFilter}
      ${toFilter}
    }
  `);

  return parseInt(results?.results.bindings[0]?.count?.value || '0');
}

/**
 * Number of errors that were recorded for the stream in the period.
 * Errors are linked to the observation of the page that caused the error,
 * so they are filtered by the result time of that observation.
 */
async function getErrorCount(streamUri: string, { from, to }: Filters) {
  const status = config.streams[streamUri].status;

  let fromFilter = '';
  if (from) {
    fromFilter = `FILTER(?time >= ${sparqlEscapeDateTime(from)})`;
  }
  let toFilter = '';
  if (to) {
    toFilter = `FILTER(?time <= ${sparqlEscapeDateTime(to)})`;
  }

  const results = await querySudo(`
    SELECT (COUNT(DISTINCT ?error) AS ?count) WHERE {
      GRAPH ${sparqlEscapeUri(status)} {
        ?obs a <http://www.w3.org/ns/sosa/Observation> ;
             <http://www.w3.org/ns/sosa/hasFeatureOfInterest> ${sparqlEscapeUri(
               streamUri,
             )} ;
             <http://www.w3.org/ns/sosa/hasResult> ?error ;
             <http://www.w3.org/ns/sosa/resultTime> ?time .
        ?error a <http://open-services.net/ns/core#Error> .
      }
      ${fromFilter}
      ${toFilter}
    }
  `);

  return parseInt(results?.results.bindings[0]?.count?.value || '0');
}

/**
 * The most recent page of the stream that was processed
 * and the time at which it was processed.
 */
async function getLastProcessedPage(streamUri: string) {
  const status = config.streams[streamUri].status;

  const results = await querySudo(`
    SELECT ?page ?time WHERE {
      GRAPH ${sparqlEscapeUri(status)} {
        ?obs a <http://www.w3.org/ns/sosa/Observation> ;
             <http://www.w3.org/ns/sosa/observedProperty> ?page ;
             <http://www.w3.org/ns/sosa/hasFeatureOfInterest> ${sparqlEscapeUri(
               streamUri,
             )} ;
             <http://www.w3.org/ns/sosa/resultTime> ?time .
      }
    } ORDER BY DESC(?time) LIMIT 1
  `);

  const binding = results?.results.bindings[0];
  if (!binding) {
    return null;
  }
  return {
    page: binding.page.value,
    time: binding.time.value,
  };
}

/**
 * Average time it took to load a page of the stream (in ms)
 * for pages processed in the period.
 */
async function getAverageLoadDuration(
  streamUri: string,
  { from, to }: Filters,
) {
  const status = config.streams[streamUri].status;

  let fromFilter = '';
  if (from) {
    fromFilter = `FILTER(?time >= ${sparqlEscapeDateTime(from)})`;
  }
  let toFilter = '';
  if (to) {
    toFilter = `FILTER(?time <= ${sparqlEscapeDateTime(to)})`;
  }

  const results = await querySudo(`
    SELECT (AVG(?load) AS ?average) WHERE {
      GRAPH ${sparqlEscapeUri(status)} {
        ?obs a <http://www.w3.org/ns/sosa/Observation> ;
             <http://www.w3.org/ns/sosa/hasFeatureOfInterest> ${sparqlEscapeUri(
               streamUri,
             )} ;
             <http://www.w3.org/ns/sosa/hasResult> ?res ;
             <http://www.w3.org/ns/sosa/resultTime> ?time .
        ?res <http://mu.semte.ch/vocabularies/ext/durationLoad> ?load .
      }
      ${fromFilter}
      ${toFilter}
    }
  `);

  return parseFloat(results?.results.bindings[0]?.average?.value || '0');
}

/**
 * Average time it took to process a page of the stream (in ms)
 * (total duration minus load duration)
 * for pages processed in the period.
 */
async function getAverageProcessingDuration(
  streamUri: string,
  { from, to }: Filters,
) {
  const status = config.streams[streamUri].status;

  let fromFilter = '';
  if (from) {
    fromFilter = `FILTER(?time >= ${sparqlEscapeDateTime(from)})`;
  }
  let toFilter = '';
  if (to) {
    toFilter = `FILTER(?time <= ${sparqlEscapeDateTime(to)})`;
  }

  const results = await querySudo(`
    SELECT (AVG(?complete - ?load) AS ?average) WHERE {
      GRAPH ${sparqlEscapeUri(status)} {
        ?obs a <http://www.w3.org/ns/sosa/Observation> ;
             <http://www.w3.org/ns/sosa/hasFeatureOfInterest> ${sparqlEscapeUri(
               streamUri,
             )} ;
             <http://www.w3.org/ns/sosa/hasResult> ?res ;
             <http://www.w3.org/ns/sosa/resultTime> ?time .
        ?res <http://mu.semte.ch/vocabularies/ext/durationLoad> ?load .
        ?res <http://mu.semte.ch/vocabularies/ext/durationComplete> ?complete .
      }
      ${fromFilter}
      ${toFilter}
    }
  `);

  return parseFloat(results?.results.bindings[0]?.average?.value || '0');
}
