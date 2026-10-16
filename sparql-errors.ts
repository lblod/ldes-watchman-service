import { v4 } from 'uuid';
import { CronJob } from 'cron';
import dayjs from 'dayjs';
import { updateSudo } from '@lblod/mu-auth-sudo';
import { sparqlEscapeDateTime, sparqlEscapeString, sparqlEscapeUri } from 'mu';
import { config } from './config/config';
import {
  incrementErrorCounter,
  incrementErrorCounterFor,
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
}

/**
 * Run the sparqlVerify function of every stream that provides one.
 */
export async function verifyStreams() {
  for (const [streamUri, stream] of Object.entries(config.streams)) {
    if (stream.sparqlVerify) {
      await stream.sparqlVerify(streamUri, stream.content);
    }
  }
}

export function startSparqlVerifyCronjob() {
  const job = new CronJob(CRON_PATTERN, async function () {
    await verifyStreams();
  });
  job.start();
  return job;
}
