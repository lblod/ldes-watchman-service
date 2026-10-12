import { incrementCounter, setGauge } from '../metrics';
export const config = {
  streams: {
    'https://mandatenbeheer.lokaalbestuur.vlaanderen.be/streams/ldes/public': {
      name: 'Public Stream default',
      content: 'http://mu.semte.ch/graphs/ldes-validation/content',
      status: 'http://mu.semte.ch/graphs/ldes-validation/status',
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
    }
  >;
};
