import * as fs from 'fs';
import * as path from 'path';
import {Gender} from './wiki';
import {Language} from './languages';

export type PersonCache<T extends Gender> = T extends Gender.Woman
  ? Map<string, CachedWomanEntryValue>
  : T extends Gender.Man
    ? string[]
    : never;
export type CachedWomanEntryValue = Partial<
  Record<Language, {label: string; wikipedia: string}>
>;

export type StreetCache = Map<string, CachedStreetEntryValue>;
export type CachedStreetEntryValue = {
  gender: Gender;
  wikidataId?: string;
};

import cachedWomenData from '../../cache/women-wikidata.json';
import cachedMenData from '../../cache/men-wikidata.json';
import cachedStreetsData from '../../cache/streets.json';
/** Map<wikidataID, entry> */
export const cachedWomen: PersonCache<Gender.Woman> = new Map(
    Object.entries(cachedWomenData)
  ),
  /** Array<wikidataID> */
  cachedMen: PersonCache<Gender.Man> = cachedMenData,
  cachedStreets: StreetCache = new Map(
    Object.entries(cachedStreetsData)
  ) as StreetCache;

/**
 * Stores a person in the local cache. Call {@link writeCache} to write the cache to disk
 * @param wikidataID The ID of the Wikidata entry to cache
 * @param gender The concluded gender of the entry to cache
 * @param data For women, the data to store
 */
export function cachePerson(
  wikidataID: string,
  gender: Gender.Woman,
  data: CachedWomanEntryValue
): void;
export function cachePerson(wikidataID: string, gender: Gender.Man): void;
export function cachePerson(
  wikidataID: string,
  gender: Gender.Woman | Gender.Man,
  data?: CachedWomanEntryValue
): void {
  if (gender === Gender.Woman) {
    cachedWomen.set(wikidataID, {
      ...(cachedWomen.get(wikidataID) || {}),
      ...(data ?? {}),
    });
  } else {
    cachedMen.push(wikidataID);
  }
}

/** Caches the resolution of a street name */
export function cacheStreet(
  streetName: string,
  gender: Gender,
  wikidataId?: string
): void {
  cachedStreets.set(streetName, {gender, wikidataId});
}

/** Saves caches to disk */
export function writeCache() {
  fs.writeFileSync(
    path.join(__dirname, '../../cache/women-wikidata.json'),
    JSON.stringify(Object.fromEntries(cachedWomen.entries()), null, 2),
    'utf-8'
  );
  fs.writeFileSync(
    path.join(__dirname, '../../cache/men-wikidata.json'),
    JSON.stringify(cachedMen, null, 2),
    'utf-8'
  );
  fs.writeFileSync(
    path.join(__dirname, '../../cache/streets.json'),
    JSON.stringify(Object.fromEntries(cachedStreets.entries()), null, 2),
    'utf-8'
  );
}
