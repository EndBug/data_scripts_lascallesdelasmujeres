'use strict';

import * as path from 'path';
import * as csv from 'csv';
import LineByLineReader from 'line-by-line';
import wikidataLookup from 'wikidata-entity-lookup';
import {WikibaseEntityReader} from 'wikidata-entity-reader';
import axios from 'axios';
import {Gender, cachedMen, cachedWomen} from './commons';

const args = require('yargs')
  .usage(
    'WIKIPEDIA STEP: Pass a city name and the flag --keepUnknown in case you want to keep the unclassified streets. '
  )
  .epilog('GeoChicas OSM 2020')
  .alias('h', 'help')
  .alias('c', 'city')
  .alias('ku', 'keepUnknown')
  .describe('c', 'City in your data folder')
  .describe('ku', 'To keep unclassified streets')
  .demandOption(['c']).argv;

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

  return results.map((r: any) => r.id.split('/').pop());
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

(() => {
  const listFn = path.join(__dirname, `../data/${args.city}/list.csv`);

  const lr = new LineByLineReader(listFn);
  const parser = csv.parse({delimiter: ';', fromLine: 2});

  lr.on('line', line => parser.write(line + '\n'))
    .on('end', () => {
      console.log('List file read correctly.');
      parser.end();
    })
    .on('error', err => {
      console.error('Error reading list file.');
      throw err;
    });

  parser
    .on('err', err => {
      console.error('Error parsing list file.');
      throw err;
    })
    .on('readable', async () => {
      let record: [string, string];

      while ((record = parser.read()) !== null) {
        const name = record[1];

        const [id, gender] = await classifyName(name);
      }
    });
})();
