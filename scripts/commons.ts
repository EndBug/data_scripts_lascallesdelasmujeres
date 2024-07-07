import * as fs from 'fs';
import * as path from 'path';
import {type Feature} from 'geojson';
import {type Language} from './languages';

/** An enum, where genders are initialized with the respective Wikidata entity IDs (see claim P21) */
export enum Gender {
  Woman = 'F',
  Man = 'M',
  Unknown = '?',
}

export type Cache<T extends Gender> = T extends Gender.Woman
  ? {
      [wikidataID: string]: Record<
        Language,
        {
          label: string;
          wikipedia: string;
        }
      >;
    }
  : string[];

import cachedWomenData from '../cache/women-wikidata.json';
import cachedMenData from '../cache/men-wikidata.json';
export const cachedWomen = cachedWomenData as Cache<Gender.Woman>,
  cachedMen = cachedMenData as Cache<Gender.Man>;

/**
 * Stores a person in the local cache. Call {@link writeCache} to write the cache to disk
 * @param wikidataID The ID of the Wikidata entry to cache
 * @param gender The concluded gender of the entry to cache
 * @param data For women, the data to store
 */
export function cachePerson(
  wikidataID: string,
  gender: Gender.Woman,
  data: Cache<Gender.Woman>[string]
): void;
export function cachePerson(wikidataID: string, gender: Gender.Man): void;
export function cachePerson(
  wikidataID: string,
  gender: Gender.Woman | Gender.Man,
  data?: Cache<Gender.Woman>[string]
): void {
  if (gender === Gender.Woman) {
    cachedWomen[wikidataID] = {
      ...(cachedWomen[wikidataID] || {}),
      ...(data ?? {}),
    };
  } else {
    cachedMen.push(wikidataID);
  }
}

/** Saves caches to disk */
export function writeCache() {
  fs.writeFileSync(
    path.join(__dirname, '../cache/women-wikidata.json'),
    JSON.stringify(cachedWomen, null, 2),
    'utf-8'
  );
  fs.writeFileSync(
    path.join(__dirname, '../cache/men-wikidata.json'),
    JSON.stringify(cachedMen, null, 2),
    'utf-8'
  );
}

/** Writes a GeoJSON into the passed file path */
export function writeFeatures(outputPath: string, features: Feature[]) {
  const jsonString = JSON.stringify({
    type: 'FeatureCollection',
    features: features,
  });

  fs.writeFileSync(outputPath, jsonString);
}
