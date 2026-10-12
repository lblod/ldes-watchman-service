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

export async function setGauge(name: string, value: number, stream?: string) {
  const key = stream || 'default';
  gauges[name] = value;
  await pushInstance('default', key, exposition());
}
