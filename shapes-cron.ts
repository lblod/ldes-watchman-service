import { readdir, readFile, writeFile } from 'fs/promises';
import { CronJob } from 'cron';
import dayjs from 'dayjs';
import { config } from './config/config';
import { getShape } from './shape';

const SHAPE_DIR = '/data';
const SHAPE_PREFIX = 'shape-';
const SHAPE_SUFFIX = '.json';
const CRON_PATTERN = process.env.SHAPE_CRON_PATTERN || '5 * * * *';

export type ShapeReport = {
  timestamp: Date;
  streamUri: string;
  shape: unknown;
};

/**
 * Store the shape of every configured stream unless it is identical
 * to the most recently stored shape of that stream.
 * Returns the streamUri for every shape that was stored.
 */
export async function storeShapes() {
  const storedStreams = [] as string[];
  for (const streamUri of Object.keys(config.streams)) {
    const stored = await getMostRecentShape(streamUri);
    const shape = await getShape(streamUri);
    if (JSON.stringify(shape) == JSON.stringify(stored?.shape)) {
      continue;
    }
    const timestamp = dayjs().toDate();
    const path = `${SHAPE_DIR}/${SHAPE_PREFIX}${timestamp.toISOString()}${SHAPE_SUFFIX}`;
    const report: ShapeReport = { timestamp, streamUri, shape };
    await writeFile(path, JSON.stringify(report, null, 2));
    storedStreams.push(streamUri);
  }
  return storedStreams;
}

/**
 * All shape reports stored on disk, ordered from old to new.
 * Optionally filtered by stream.
 */
export async function getShapeReports(streamUri?: string) {
  const filenames = (await readdir(SHAPE_DIR))
    .filter(
      (filename) =>
        filename.startsWith(SHAPE_PREFIX) && filename.endsWith(SHAPE_SUFFIX),
    )
    .sort();

  const reports = [] as ShapeReport[];
  for (const filename of filenames) {
    const report = JSON.parse(
      await readFile(`${SHAPE_DIR}/${filename}`, 'utf-8'),
    );
    reports.push({
      timestamp: dayjs(report.timestamp).toDate(),
      streamUri: report.streamUri,
      shape: report.shape,
    });
  }
  return reports.filter(
    (report) => !streamUri || report.streamUri == streamUri,
  );
}

export async function getMostRecentShape(streamUri: string) {
  const reports = await getShapeReports(streamUri);
  return reports[reports.length - 1];
}

/**
 * The two most recent shape reports of a stream.
 * A new report is only stored when the shape changed,
 * so these differ unless no two shapes have been stored yet.
 */
export async function getShapeDiff(streamUri: string) {
  const reports = await getShapeReports(streamUri);
  const oldReport = reports[reports.length - 2];
  const newReport = reports[reports.length - 1];
  if (!oldReport || !newReport) {
    return null;
  }
  return {
    timestampOld: oldReport.timestamp,
    timestampNew: newReport.timestamp,
    oldShape: oldReport.shape,
    newShape: newReport.shape,
  };
}

export function startShapeCronjob() {
  const job = new CronJob(CRON_PATTERN, async function () {
    await storeShapes();
  });
  job.start();
  return job;
}
