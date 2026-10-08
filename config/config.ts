export const config = {
  streams: {
    'https://mandatenbeheer.lokaalbestuur.vlaanderen.be/streams/ldes/public': {
      content: 'http://mu.semte.ch/graphs/ldes-validation/content',
      status: 'http://mu.semte.ch/graphs/ldes-validation/status',
    },
  },
} as Config;

export type Config = {
  streams: Record<
    string,
    {
      content: string;
      status: string;
    }
  >;
};
