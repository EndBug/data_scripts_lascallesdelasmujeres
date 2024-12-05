import * as path from 'path';
import * as fs from 'fs';

import overpass from 'query-overpass';
import booleanContains from '@turf/boolean-contains';
import flatten from '@turf/flatten';
import bbox from '@turf/bbox';
import bboxPolygon from '@turf/bbox-polygon';
import centerOfMass from '@turf/center-of-mass';
import type {
  Feature,
  FeatureCollection,
  LineString,
  Point,
  Polygon,
  BBox,
} from 'geojson';
import * as bboxSplit from 'boundingbox-split';
import {writeFeatures} from './geoJSON';

/**
 * Gets the boundary of a city from OpenStreetMap
 * @param id The ID of the relation to get
 * @returns A promise with the relation feature
 */
function getBoundary(
  id: string
): Promise<Feature<Polygon | LineString | Point>> {
  const query = `relation(${id});(._;>;);out;`;
  console.log('Requestind data to the Overpass API...');
  console.log('query: ', query);

  return new Promise((res, rej) => {
    overpass(query, (error: unknown, data: FeatureCollection) => {
      if (error) {
        console.log('Something happened', error);
        rej(error);
      }

      const relationFeatures = data.features.filter(
        el => el.properties?.['type'] === 'relation'
      );

      if (relationFeatures.length === 0) {
        rej(new Error('No features on this relation'));
      }

      res(relationFeatures[0] as Feature<Polygon | LineString | Point>);
    });
  });
}

function getOverPassData(
  squareBBOX: bboxSplit.BBox,
  index: number,
  city: string,
  language: string,
  generatePartialGridFile = false
): Promise<Feature[]> {
  return new Promise((resolve, reject) => {
    const query = `
      way(${squareBBOX.minLat},${squareBBOX.minLng},${squareBBOX.maxLat},${squareBBOX.maxLng})
			[highway~"^(pedestrian|footway|residential|unclassified|trunk|service|bridge|path|living_street|primary|secondary|tertiary)$"];
			(._;>;);
      out;
    `;

    const overpassResults = overpass(
      query,
      async (error: unknown, data: FeatureCollection) => {
        if (error) {
          console.log(
            `Something happenned with request ${index}:${overpassResults}`,
            error
          );
          reject(error);
        } else {
          const relationFeatures = data.features.reduce((acc, feature) => {
            if (
              feature.geometry.type === 'LineString' ||
              feature.geometry.type === 'Polygon'
            ) {
              acc = [
                ...acc,
                {
                  ...feature,
                  properties: {
                    name:
                      feature.properties?.['tags'][`name:${language}`] ||
                      feature.properties?.['tags'].name,
                    id: feature.properties?.['id'],
                    wikipedia_link: '',
                    gender: 'unknown',
                  },
                },
              ];
            }
            return acc;
          }, [] as Feature[]);

          if (generatePartialGridFile) {
            const geojsonPath = path.join(
              __dirname,
              `../data/${city}/${city}_streets_grid${index}.geojson`
            );
            writeFeatures(geojsonPath, relationFeatures);
          }
          resolve(relationFeatures);
        }
      }
    );
  });
}

async function getGrid(bboxCity: BBox, splitFactor = 1) {
  const polygon = bboxPolygon(bboxCity);
  const center = centerOfMass(polygon);

  const boxParameters = {
    centerLat: center.geometry.coordinates[1],
    centerLng: center.geometry.coordinates[0],
    maxLat: bboxCity[3],
    minLat: bboxCity[1],
    maxLng: bboxCity[2],
    minLng: bboxCity[0],
  };

  const grid = await bboxSplit.boundingBoxCutting(boxParameters, splitFactor);
  return grid;
}

async function getStreetsByBBOX(
  bboxCity: BBox,
  city = 'city',
  language = 'es'
): Promise<Feature[]> {
  const grid = await getGrid(bboxCity);

  console.log(`Number of squares: ${grid.length}`);

  const features: Feature[] = [];
  for (let index = 0; index < grid.length; index++) {
    const square = grid[index];

    console.log(`Sending request number ${index}`);
    const overpassResults = await getOverPassData(
      square,
      index,
      city,
      language
    );
    console.log(`result ${index}: ${overpassResults.length} features`);

    features.push(...overpassResults);

    if (index < grid.length - 1) {
      console.log('waiting 10s before next request to overpass...');
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }

  return features;
}

export async function processCity(
  city: string,
  relationId: string,
  language: string
) {
  try {
    const cityBoundaries = flatten(await getBoundary(relationId)).features;
    const cityFolder = path.join(process.cwd(), 'data', city);
    // If it doesn't exist, create the folder
    if (!fs.existsSync(cityFolder)) fs.mkdirSync(cityFolder, {recursive: true});

    const cityFilePath = path.join(cityFolder, city + '_boundary.geojson');
    writeFeatures(cityFilePath, cityBoundaries);

    const cityBBOX = bbox({
      type: 'FeatureCollection',
      features: cityBoundaries,
    });
    const features = await getStreetsByBBOX(cityBBOX, city, language);
    console.log(`${features.length} features on your GeoJSON file`);

    // Find if a feature intersects with any of the city boundaries
    const filteredFeatures = features.filter(feature => {
      return cityBoundaries.find(boundary => {
        return booleanContains(boundary, feature);
      });
    });

    console.log('Filtered features: ', filteredFeatures.length);

    const filteredFeaturesPath = path.join(
      process.cwd(),
      'data',
      city,
      city + '_streets.geojson'
    );
    console.log('Writing the result at: ', filteredFeaturesPath);

    writeFeatures(filteredFeaturesPath, filteredFeatures);

    return true;
  } catch (err) {
    console.error('ProcessCity error', err);
    return false;
  }
}
