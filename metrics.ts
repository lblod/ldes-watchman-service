import http from 'http';

const PUSHGATEWAY_URL =
  process.env.LDES_METRICS_PUSHGATEWAY_URL || 'http://pushgateway:9091';

const counters: Record<string, number> = {};
const gauges: Record<string, number> = {};

function exposition() {
  let body = '';
  for (const [name, value] of Object.entries(counters)) {
    body += `# TYPE ${name} counter\n${name} ${value}\n`;
  }
  for (const [name, value] of Object.entries(gauges)) {
    body += `# TYPE ${name} gauge\n${name} ${value}\n`;
  }
  return body;
}

function pushInstance(instance: string, stream: string, body: string) {
  return new Promise<void>((resolve) => {
    const url = new URL(
      `/metrics/job/ldes-client/instance/${encodeURIComponent(
        instance,
      )}/stream/${encodeURIComponent(stream)}`,
      PUSHGATEWAY_URL,
    );
    const req = http.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain; version=0.0.4',
          Connection: 'close',
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve());
      },
    );
    req.on('error', (err) => {
      console.log(`failed to push metrics to pushgateway: ${err.message}`);
      resolve();
    });
    req.end(body);
  });
}

export async function incrementCounter(name: string, stream?: string) {
  const key = stream || 'default';
  counters[name] = (counters[name] ?? 0) + 1;
  await pushInstance('default', key, exposition());
}

/**
 * The error metrics are counters where the stream label
 * identifies the stream the error occurred on.
 */
function pushErrorCounter(name: string, stream?: string) {
  counters[name] = (counters[name] ?? 0) + 1;
  return pushInstance(
    'default',
    stream || 'default',
    `# TYPE ${name} counter\n${name} ${counters[name]}\n`,
  );
}

/**
 * General counter of sparql verification errors for a stream.
 */
export async function incrementErrorCounter(stream?: string) {
  return pushErrorCounter('ldes_watchman_sparql_errors_total', stream);
}

/**
 * Counter specific to one kind of validation error,
 * with a metric name based on the error name.
 * Metric names only allow alphanumerics, colons and underscores,
 * so any other character in the name is sanitized.
 */
export async function incrementErrorCounterFor(name: string, stream?: string) {
  const sanitised = name.replace(/[^a-zA-Z0-9_:]/g, '_');
  return pushErrorCounter(
    `ldes_watchman_sparql_error_${sanitised}_total`,
    stream,
  );
}

export async function setGauge(name: string, value: number, stream?: string) {
  const key = stream || 'default';
  gauges[name] = value;
  await pushInstance('default', key, exposition());
}
