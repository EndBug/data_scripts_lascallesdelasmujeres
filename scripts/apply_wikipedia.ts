'use strict';

import * as path from 'path';
import * as csv from 'csv';
import yargs from 'yargs';
import {hideBin} from 'yargs/helpers';
import LineByLineReader from 'line-by-line';
import wikidataLookup from 'wikidata-entity-lookup';
import {WikibaseEntityReader} from 'wikidata-entity-reader';
import axios from 'axios';
import {
  type Cache,
  Gender,
  cachePerson,
  cachedMen,
  cachedWomen,
  writeCache,
} from './commons';
import {type Language, isLanguage} from './languages';
import {createWriteStream} from 'fs';
import {AsyncTransform} from './utils';

/**
 * An object where the key is the recognized gender, and the value is an array
 * of Wikidata IDs associated with that gender.
 * @todo To the bigger scope of this project, should we distinct cisgender men
 * from transgender ones?
 */
const genderClassifiers: Record<Gender.Woman | Gender.Man, string[]> = {
  [Gender.Woman]: ['Q6581072', 'Q1052281'],
  [Gender.Man]: ['Q6581097', 'Q2449503'],
};

/**
 *
 * @param name The "cleaned" name of the street to classify
 * @returns A tuple containing the ID (if any), and the classified gender
 */
async function classifyName(
  name: string
): Promise<[undefined, Gender.Unknown] | [string, Gender.Woman | Gender.Man]> {
  const ids = await getWikidataIds(name);
  if (!ids || ids.length === 0) {
    console.log(`No wikidata ID found for ${name}`);
    return [undefined, Gender.Unknown];
  }

  let maleEntry: string | undefined;
  for (const id of ids) {
    const res = await classifyWikidataEntry(id);

    if (res === Gender.Woman) return [id, res];
    if (res === Gender.Man) maleEntry = id;
  }

  if (maleEntry !== undefined) return [maleEntry, Gender.Man];
  else return [undefined, Gender.Unknown];
}

/**
 * Gets the Wikidata IDs for a given name
 * @param name The name to search on Wikidata
 * @returns An array of Wikidata IDs that match the name query
 */
async function getWikidataIds(name: string): Promise<string[]> {
  const results =
    (await wikidataLookup.findPerson(name).catch((err: Error) => {
      console.error('Issue in getting');
      console.error(err);
    })) || [];

  return results.map(r => r.id.split('/').pop() ?? '');
}

/**
 * Queries the Wikidata API to get claims for a given ID, then checks for the "sex or gender" claim (P21)
 */
async function classifyWikidataEntry(id: string): Promise<Gender> {
  if (cachedWomen[id] !== undefined) return Gender.Woman;
  if (cachedMen.includes(id)) return Gender.Man;

  const response = await axios
    .get(
      `https://www.wikidata.org/w/api.php?action=wbgetclaims&format=json&entity=${id}&formatversion=2`
    )
    .catch(err => {
      console.error(`Error getting claims for ${id}`);
      console.error(err);
    });

  if (!response) return Gender.Unknown;

  const reader = new WikibaseEntityReader(response.data, 'en');

  const isWoman = reader
    .claim('P21')
    .some(
      claim =>
        claim.mainsnak.datavalue?.type === 'wikibase-entityid' &&
        genderClassifiers[Gender.Woman].includes(
          claim.mainsnak.datavalue?.value.id
        )
    );

  const isMan = reader
    .claim('P21')
    .some(
      claim =>
        claim.mainsnak.datavalue?.type === 'wikibase-entityid' &&
        genderClassifiers[Gender.Man].includes(
          claim.mainsnak.datavalue?.value.id
        )
    );

  const conclusion = isWoman
    ? Gender.Woman
    : isMan
      ? Gender.Man
      : Gender.Unknown;

  return conclusion;
}

/**
 * Gets the Wikipedia links for a given entity
 * @param wikidataID The ID of the entity to look up
 * @param languages The languages to get links for
 * @returns The data for a cached woman entry
 */
async function getEntityLinks(
  wikidataID: string,
  languages: Language[]
): Promise<Cache<Gender.Woman>[string]> {
  const response = await axios.get(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&ids=${wikidataID}&props=sitelinks/urls`
  );

  const links: Record<
    string,
    {site: string; title: string; badges: unknown[]; url: string}
  > = response.data.entities[wikidataID].sitelinks;

  const res = {} as Cache<Gender.Woman>[string];

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

(async () => {
  const args = await yargs(hideBin(process.argv))
    .usage(
      'WIKIPEDIA STEP: Pass a city name and the flag --keepUnknown in case you want to keep the unclassified streets. '
    )
    .epilog('GeoChicas OSM 2020')
    .alias('h', 'help')
    .alias('c', 'city')
    .alias('lang', 'language')
    .alias('ku', 'keepUnknown')
    .describe('c', 'City in your data folder')
    .describe('ku', 'To keep unclassified streets')
    .describe('lang', 'main language of the streets names')
    .demandOption(['c', 'lang']).argv;

  const langs: Language[] = [];
  if (isLanguage(args.lang)) langs.push(args.lang);
  if (!langs.includes('en')) langs.push('en');

  const listFn = path.join(__dirname, `../data/${args['city']}/list.csv`);
  const foundFn = path.join(__dirname, `../data/${args['city']}/list_wiki.csv`);
  const unsureFn = path.join(
    __dirname,
    `../data/${args['city']}/list_unsure.csv`
  );

  const lr = new LineByLineReader(listFn);
  const parser = csv.parse({delimiter: ';', fromLine: 2});

  const recordProcessor = new AsyncTransform<
    [string, string],
    {
      identified: boolean;
      record: [string, string, string];
    }
  >(async record => {
    const name = record[1];

    const [id, gender] = await classifyName(name);

    if (gender === Gender.Unknown)
      return {identified: false, record: [...record, '']};
    else if (gender === Gender.Man) {
      cachePerson(id, gender);
      return {identified: true, record: [record[0], gender, '']};
    } else {
      const links = await getEntityLinks(id, langs);
      cachePerson(id, gender, links);
      return {
        identified: true,
        record: [record[0], gender, JSON.stringify(links)],
      };
    }
  });

  const foundStringifier = csv.stringify({
    delimiter: ';',
    header: true,
    columns: ['streetName', 'gender', 'wikiJSON'],
  });
  const unsureStringifier = csv.stringify({
    delimiter: ';',
    header: true,
    columns: ['streetName', 'cleanName'],
  });

  const foundFileStream = createWriteStream(foundFn, 'utf-8');
  const unsureFileStream = createWriteStream(unsureFn, 'utf-8');

  foundStringifier.on('error', err => {
    console.error('Error writing found file.');
    throw err;
  });
  unsureStringifier.on('error', err => {
    console.error('Error writing unsure file.');
    throw err;
  });

  lr.on('line', line => parser.write(line + '\n'))
    .on('end', () => {
      console.log('List file read correctly.');
      parser.end();
    })
    .on('error', err => {
      console.error('Error reading list file.');
      throw err;
    });

  foundStringifier.pipe(foundFileStream);
  unsureStringifier.pipe(unsureFileStream);

  parser
    .pipe(recordProcessor)
    .on('data', data => {
      if (data.identified) foundStringifier.write(data.record);
      else unsureStringifier.write(data.record);
    })
    .on('error', err => {
      console.error('Error processing records.', err);
    })
    .on('end', () => {
      console.log('List classified.');
      writeCache();
      foundStringifier.end();
      unsureStringifier.end();
      // eslint-disable-next-line no-process-exit
      process.exit(0);
    });
})();
