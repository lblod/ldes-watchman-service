import { config } from './config/config';

export const getTimePred = (streamUri: string) => {
  return (
    config.streams[streamUri].timePredicate ||
    'http://www.w3.org/ns/prov#generatedAtTime'
  );
};

export const getVersionPred = (streamUri: string) => {
  return (
    config.streams[streamUri].versionPredicate ||
    'http://purl.org/dc/terms/isVersionOf'
  );
};
