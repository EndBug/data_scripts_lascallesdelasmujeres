import {Language, isLanguage} from './languages';
import {CachedWomanEntryValue} from './cache';
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

/** Generates an array of languages to use for links */
export function getLinksLanguages(cityLang: Language): Language[] {
  const langs: Language[] = [];
  if (isLanguage(cityLang)) langs.push(cityLang);
  if (!langs.includes('en')) langs.push('en');
  return langs;
}
