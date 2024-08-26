'use strict';

import * as path from 'path';
import * as csv from 'csv';
import yargs from 'yargs';
import {hideBin} from 'yargs/helpers';
import wikidataLookup from 'wikidata-entity-lookup';
import {WikibaseEntityReader} from 'wikidata-entity-reader';
import axios from 'axios';
import {type Language} from './utils/languages';
import {createWriteStream, readFileSync} from 'fs';
import {AsyncTransform} from './utils/stream';
import ProgressBar from 'progress';
import {Gender, getEntityLinks, getLinksLanguages} from './utils/wiki';
import {
  cachePerson,
  cacheStreet,
  cachedMen,
  cachedStreets,
  cachedWomen,
  writeCache,
} from './utils/cache';

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
): Promise<
  | [undefined, Gender.Unknown, false]
  | [string, Gender.Woman | Gender.Man, boolean]
> {
  const ids = await getWikidataIds(name);
  if (!ids || ids.length === 0) {
    // console.log(`No wikidata ID found for ${name}`);
    return [undefined, Gender.Unknown, false];
  }

  let maleEntry: string | undefined;
  let maleEntryCached = false;
  for (const id of ids) {
    const {gender: res, cached} = await classifyWikidataEntry(id);

    if (res === Gender.Woman) return [id, res, cached];
    if (res === Gender.Man) {
      maleEntry = id;
      maleEntryCached = cached;
    }
  }

  if (maleEntry !== undefined) return [maleEntry, Gender.Man, maleEntryCached];
  else return [undefined, Gender.Unknown, false];
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
async function classifyWikidataEntry(
  id: string
): Promise<{gender: Gender; cached: boolean}> {
  if (cachedWomen.get(id) !== undefined)
    return {gender: Gender.Woman, cached: true};
  if (cachedMen.includes(id)) return {gender: Gender.Man, cached: true};

  const response = await axios
    .get(
      `https://www.wikidata.org/w/api.php?action=wbgetclaims&format=json&entity=${id}&formatversion=2`
    )
    .catch(err => {
      console.error(`Error getting claims for ${id}`);
      console.error(err);
    });

  if (!response) return {gender: Gender.Unknown, cached: false};

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

  return {gender: conclusion, cached: false};
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
    .alias('q', 'quick')
    .describe('c', 'City in your data folder')
    .describe('lang', 'main language of the streets names')
    .describe('q', 'CHeck street cache before checking for wikidata ids')
    .boolean('q')
    .default('q', true)
    .demandOption(['c', 'lang']).argv;

  const langs = getLinksLanguages(args.lang as Language);
  const quick = args.q;

  const listFn = path.join(__dirname, `../data/${args['city']}/list.csv`);
  const foundFn = path.join(__dirname, `../data/${args['city']}/list_wiki.csv`);
  const unsureFn = path.join(
    __dirname,
    `../data/${args['city']}/list_unsure.csv`
  );

  const lines = readFileSync(listFn, 'utf-8').split('\n');
  const parser = csv.parse({delimiter: ';'});

  let foundCounter = 0,
    cacheHitsCounter = 0;

  const recordProcessor = new AsyncTransform<
    [string, string],
    {
      identified: boolean;
      /** streetName, gender, wikiJSON */
      record: [string, string, string];
      wikidataId?: string;
    }
  >(async record => {
    const name = record[1];

    let id: string | undefined;
    let gender: Gender;
    let cached = false;

    const cachedStreet = cachedStreets.get(record[0]);

    if (quick && cachedStreet) {
      id = cachedStreet.wikidataId;
      gender = cachedStreet.gender;
      cached = true;
    } else {
      [id, gender, cached] = await classifyName(name);

      if (gender === Gender.Unknown && cachedStreet) {
        id = cachedStreet.wikidataId;
        gender = cachedStreet.gender;
        cached = true;
      }
    }

    if (cached) cacheHitsCounter++;

    if (gender === Gender.Unknown)
      return {identified: false, record: [...record, '']};
    else {
      if (id) {
        if (gender === Gender.Man) {
          cachePerson(id, gender);
          return {
            identified: true,
            record: [record[0], gender, ''],
            wikidataId: id,
          };
        } else {
          const links = await getEntityLinks(id, langs);
          cachePerson(id, gender, links);
          return {
            identified: true,
            record: [record[0], gender, JSON.stringify(links)],
            wikidataId: id,
          };
        }
      } else return {identified: true, record: [record[0], gender, '']};
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

  const progressBar = new ProgressBar(
    'Progress: [:bar] :current/:total :percent :etas | Cache hits: :cacheHits',
    {
      total: lines.length - 1,
      complete: '=',
      incomplete: ' ',
      width: 50,
    }
  );

  foundStringifier.pipe(foundFileStream);
  unsureStringifier.pipe(unsureFileStream);

  parser
    .pipe(recordProcessor)
    .on('data', data => {
      if (data.identified) {
        foundStringifier.write(data.record);
        cacheStreet(data.record[0], data.record[1] as Gender, data.wikidataId);

        foundCounter++;
        if (foundCounter % 5 === 0) writeCache();
      } else unsureStringifier.write(data.record);
      progressBar.tick({cacheHits: cacheHitsCounter});
    })
    .on('error', err => {
      console.error('Error processing records.', err);
    })
    .on('end', () => {
      console.log('List classified.');
      writeCache();
      foundStringifier.end();
      unsureStringifier.end();
    });

  lines.slice(1).forEach(line => parser.write(line + '\n'));
})().catch(console.error);
