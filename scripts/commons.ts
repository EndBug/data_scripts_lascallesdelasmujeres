import * as fs from 'fs';
import * as path from 'path';
import {type Feature} from 'geojson';
import {isLanguage, type Language} from './languages';
import axios from 'axios';

/** An enum, where genders are initialized with the respective Wikidata entity IDs (see claim P21) */
export enum Gender {
  // Use keyboard keys
  Woman = 'F',
  Man = 'M',
  Unknown = 'X',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const isGender = (value: any): value is Gender =>
  typeof value === 'string' &&
  value.length === 1 &&
  (Object.values(Gender) as string[]).includes(value);

export type Cache<T extends Gender> = T extends Gender.Woman
  ? Map<string, CachedWomanEntryValue>
  : T extends Gender.Man
    ? string[]
    : Map<string, CachedUnknownEntryValue>;
export type CachedWomanEntryValue = Partial<
  Record<Language, {label: string; wikipedia: string}>
>;
export type CachedUnknownEntryValue = {
  gender: Gender;
  wikidataId?: string;
};

import cachedWomenData from '../cache/women-wikidata.json';
import cachedMenData from '../cache/men-wikidata.json';
import cachedUnknownData from '../cache/unknown.json';
export const cachedWomen: Cache<Gender.Woman> = new Map(
    Object.entries(cachedWomenData)
  ),
  cachedMen: Cache<Gender.Man> = cachedMenData,
  cachedUnknown: Cache<Gender.Unknown> = new Map(
    Object.entries(cachedUnknownData)
  );

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

/** Caches the resolution of an unknown entity */
export function cacheUnknown(streetName: string, gender: Gender.Unknown): void;
export function cacheUnknown(
  streetName: string,
  gender: Gender.Woman | Gender.Man,
  wikidataId: string | undefined
): void;
export function cacheUnknown(
  streetName: string,
  gender: Gender,
  wikidataId?: string
): void {
  cachedUnknown.set(streetName, {gender, wikidataId});
}

/**
 * Gets the Wikipedia links for a given entity
 * @param wikidataID The ID of the entity to look up
 * @param languages The languages to get links for
 * @returns The data for a cached woman entry
 */
export async function getEntityLinks(
  wikidataID: string,
  languages: Language[]
): Promise<CachedWomanEntryValue> {
  const response = await axios.get(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&ids=${wikidataID}&props=sitelinks/urls`
  );

  const links: Record<
    string,
    {site: string; title: string; badges: unknown[]; url: string}
  > = response.data.entities[wikidataID].sitelinks;

  const res = {} as CachedWomanEntryValue;

  languages.forEach(lang => {
    const langData = links[`${lang}wiki`];

    if (langData) {
      res[lang] = {
        label: langData.title,
        wikipedia: langData.url,
      };
    }
  });

  return res;
}

/** Saves caches to disk */
export function writeCache() {
  fs.writeFileSync(
    path.join(__dirname, '../cache/women-wikidata.json'),
    // eslint-disable-next-line n/no-unsupported-features/es-builtins
    JSON.stringify(Object.fromEntries(cachedWomen.entries()), null, 2),
    'utf-8'
  );
  fs.writeFileSync(
    path.join(__dirname, '../cache/men-wikidata.json'),
    JSON.stringify(cachedMen, null, 2),
    'utf-8'
  );
  fs.writeFileSync(
    path.join(__dirname, '../cache/unknown.json'),
    // eslint-disable-next-line n/no-unsupported-features/es-builtins
    JSON.stringify(Object.fromEntries(cachedUnknown.entries()), null, 2),
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

/** Generates an array of languages to use for links */
export function getLinksLanguages(cityLang: Language): Language[] {
  const langs: Language[] = [];
  if (isLanguage(cityLang)) langs.push(cityLang);
  if (!langs.includes('en')) langs.push('en');
  return langs;
}
