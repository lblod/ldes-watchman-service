// see https://github.com/mu-semtech/mu-javascript-template for more info

import { app, errorHandler } from 'mu';
import { getStatistics, getTimeDistribution } from './statistics';
import { getShape } from './shape';
import dayjs from 'dayjs';
import { Filters } from './types';
import { config } from './config/config';
import { getShapeDiff, startShapeCronjob } from './shapes-cron';
import { startSparqlVerifyCronjob } from './sparql-errors';

app.get('/status', function (_req, res) {
  res.send('ok');
});

app.get('/statistics', async function (req, res) {
  const streamUri = req.query.streamUri;
  if (!streamUri || typeof streamUri != 'string') {
    res.status(400).send('streamUri is required');
    return;
  }
  if (!config.streams[streamUri as string]) {
    res.status(404).send('unknown stream uri');
    return;
  }
  const filters = {
    from: req.query.from && dayjs(req.query.from as string).toDate(),
    to: req.query.to && dayjs(req.query.to as string).toDate(),
  } as Filters;
  const type = typeof req.query.type == 'string' && req.query.type;
  const statistics = await getStatistics(
    streamUri as string,
    filters,
    type || undefined,
  );
  res.send(statistics);
});

app.get('/statistics/time-distribution', async function (req, res) {
  const streamUri = req.query.streamUri;
  if (!streamUri || typeof streamUri != 'string') {
    res.status(400).send('streamUri is required');
    return;
  }
  if (!config.streams[streamUri as string]) {
    res.status(404).send('unknown stream uri');
    return;
  }
  const filters = {
    from: req.query.from && dayjs(req.query.from as string).toDate(),
    to: req.query.to && dayjs(req.query.to as string).toDate(),
  } as Filters;
  const type = typeof req.query.type == 'string' && req.query.type;
  const timeDistribution = await getTimeDistribution(
    streamUri as string,
    filters,
    type || undefined,
  );
  res.send(timeDistribution);
});

app.get('/shape', async function (req, res) {
  const streamUri = req.query.streamUri;
  if (!streamUri || typeof streamUri != 'string') {
    res.status(400).send('streamUri is required');
    return;
  }
  if (!config.streams[streamUri as string]) {
    res.status(404).send('unknown stream uri');
    return;
  }
  const shape = await getShape(streamUri as string);
  res.send(shape);
});

app.get('/shape/diff', async function (req, res) {
  const streamUri = req.query.streamUri;
  if (!streamUri || typeof streamUri != 'string') {
    res.status(400).send('streamUri is required');
    return;
  }
  if (!config.streams[streamUri as string]) {
    res.status(404).send('unknown stream uri');
    return;
  }
  const diff = await getShapeDiff(streamUri as string);
  if (!diff) {
    res.status(404).send('no shape diff available');
    return;
  }
  res.send(diff);
});

app.get('/streams', async function (_req, res) {
  res.send(Object.keys(config.streams));
});

app.use(errorHandler);

startShapeCronjob();
startSparqlVerifyCronjob();
