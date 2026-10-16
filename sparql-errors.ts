import { v4 } from 'uuid';
import { CronJob } from 'cron';
import dayjs from 'dayjs';
import { updateSudo, querySudo } from '@lblod/mu-auth-sudo';
import { sparqlEscapeDateTime, sparqlEscapeString, sparqlEscapeUri } from 'mu';
import { config } from './config/config';
import {
  incrementErrorCounter,
  incrementErrorCounterFor,
  setGauge,
} from './metrics';

const CRON_PATTERN = process.env.SPARQL_VERIFY_CRON_PATTERN || '15 * * * *';

/**
 * Record a sparql verification error for a stream.
 * An ext:Error is stored in the status graph of the stream and
 * an error metric is pushed to the pushgateway.
 * The error is identified by the combination of stream and error name.
 */
export async function onSparqlError(
  streamUri: string,
  name: string,
  result: unknown,
) {
  const status = config.streams[streamUri].status;
  const errorUri = `${status}/sparql-errors/${v4()}`;

  await updateSudo(`
    INSERT DATA {
      GRAPH ${sparqlEscapeUri(status)} {
        ${sparqlEscapeUri(errorUri)} a <http://mu.semte.ch/vocabularies/ext/Error> ;
          <http://mu.semte.ch/vocabularies/ext/error-name> ${sparqlEscapeString(name)} ;
          <http://mu.semte.ch/vocabularies/ext/stream> ${sparqlEscapeUri(streamUri)} ;
          <http://mu.semte.ch/vocabularies/ext/result> ${sparqlEscapeString(
            JSON.stringify(result),
          )} ;
          <http://purl.org/dc/terms/created> ${sparqlEscapeDateTime(
            dayjs().toDate(),
          )} .
      }
    }
  `);

  const streamName = config.streams[streamUri].name;
  await incrementErrorCounter(streamName);
  await incrementErrorCounterFor(name, streamName);
  await setGauge(
    'ldes_watchman_last_sparql_error_timestamp_seconds',
    new Date().getTime() / 1000,
    streamName,
  );
  console.log('sent sparql error metrics');
}

/**
 * The most recent ext:Error per error name for a stream in the period.
 */
export async function getMostRecentErrors(
  streamUri: string,
  from?: Date,
  to?: Date,
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
    SELECT ?error ?name ?latest ?result WHERE {
      {
        SELECT ?name (MAX(?time) AS ?latest) WHERE {
          GRAPH ${sparqlEscapeUri(status)} {
            ?e a <http://mu.semte.ch/vocabularies/ext/Error> ;
              <http://mu.semte.ch/vocabularies/ext/error-name> ?name ;
              <http://mu.semte.ch/vocabularies/ext/stream> ${sparqlEscapeUri(streamUri)} ;
              <http://purl.org/dc/terms/created> ?time .
          }
          ${fromFilter}
          ${toFilter}
        } GROUP BY ?name
      }
      GRAPH ${sparqlEscapeUri(status)} {
        ?error a <http://mu.semte.ch/vocabularies/ext/Error> ;
          <http://mu.semte.ch/vocabularies/ext/error-name> ?name ;
          <http://mu.semte.ch/vocabularies/ext/result> ?result ;
          <http://purl.org/dc/terms/created> ?latest .
      }
    } ORDER BY DESC(?latest)
  `);

  const bindings = results?.results.bindings || [];
  const errors = new Map<string, unknown>();
  for (const binding of bindings) {
    if (errors.has(binding.name.value)) {
      continue;
    }
    errors.set(binding.name.value, {
      name: binding.name.value,
      time: binding.latest.value,
      result: binding.result?.value,
    });
  }
  return Array.from(errors.values());
}

/**
 * Run the sparqlVerify function of every stream that provides one.
 * Does nothing if a previous run is still in progress.
 */
let verifying = false;

export async function verifyStreams() {
  if (verifying) {
    return;
  }
  verifying = true;
  try {
    for (const [streamUri, stream] of Object.entries(config.streams)) {
      if (stream.sparqlVerify) {
        await stream.sparqlVerify(streamUri, stream.content);
      }
    }
  } finally {
    verifying = false;
  }
}

export function startSparqlVerifyCronjob() {
  const job = new CronJob(CRON_PATTERN, async function () {
    await verifyStreams();
  });
  job.start();
  return job;
}
