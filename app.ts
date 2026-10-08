// see https://github.com/mu-semtech/mu-javascript-template for more info

import { app, errorHandler } from 'mu';
import { getStatistics } from './statistics';
import dayjs from 'dayjs';
import { Filters } from './types';
import { config } from './config/config';

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
  const statistics = await getStatistics(streamUri as string, filters);
  res.send(statistics);
});

app.use(errorHandler);
