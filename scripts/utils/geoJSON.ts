import {Feature} from 'geojson';
import * as fs from 'fs';

/** Writes a GeoJSON into the passed file path */
export function writeFeatures(outputPath: string, features: Feature[]) {
  const jsonString = JSON.stringify({
    type: 'FeatureCollection',
    features: features,
  });

  fs.writeFileSync(outputPath, jsonString);
}
