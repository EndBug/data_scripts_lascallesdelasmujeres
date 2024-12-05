import yargs from 'yargs';
import {hideBin} from 'yargs/helpers';
import {isLanguage} from './utils/languages';
import * as csvSync from 'csv/sync';
import {readFileSync, writeFileSync} from 'fs';
import * as path from 'path';
import {Gender} from './utils/wiki';
import {Geometry} from 'geojson';
import {CachedWomanEntryValue} from './utils/cache';

type GeoJSONProperties = {
  links: CachedWomanEntryValue;
  gender: Gender.Man | Gender.Woman;
};

type LegacyGeoJSONProperties = {
  gender: string;
  scale: '';
};

const getLegacyGender = (gender: Gender) => {
  return gender === Gender.Woman
    ? 'Female'
    : gender === Gender.Man
      ? 'Male'
      : 'unknown';
};

(async () => {
  const args = await yargs(hideBin(process.argv))
    .usage(
      `
      Finalizes the entries found in the previous steps, and compiles the file to be used on the website.
      `.trim()
    )
    .alias('c', 'city')
    .alias('lang', 'language')
    .describe('c', 'City in your data folder')
    .describe('lang', 'main language of the streets names')
    .demandOption(['c', 'lang']).argv;

  const city = args.c as string;
  const lang = args.lang;
  const cityFolder = path.join(__dirname, '../data', city);

  if (!isLanguage(lang)) {
    throw new Error(`Language ${lang} not supported`);
  }

  /** streetName, gender, wikiJSON */
  const originalRecords = csvSync.parse(
    readFileSync(path.join(cityFolder, 'list_wiki.csv'), {encoding: 'utf8'}),
    {
      delimiter: ';',
      fromLine: 2,
    }
  ) as [string, Gender, string][];

  /** streetName, gender, wikiJSON */
  const confimedRecords = csvSync.parse(
    readFileSync(path.join(cityFolder, 'list_unsure_confirmed.csv'), {
      encoding: 'utf8',
    }),
    {
      delimiter: ';',
      fromLine: 2,
    }
  ) as [string, Gender, string][];

  /** streetName, gender, wikiJSON */
  const combinedRecords = [...originalRecords, ...confimedRecords];

  const mappedToStreetName = Object.fromEntries(
    combinedRecords.map(([streetName, gender, wikiJSON]) => [
      streetName,
      {
        gender,
        links: (wikiJSON ? JSON.parse(wikiJSON) : {}) as CachedWomanEntryValue,
      },
    ])
  );

  const inputGeoJSON: GeoJSON.FeatureCollection = JSON.parse(
    readFileSync(path.join(cityFolder, `${city}_streets.geojson`), {
      encoding: 'utf8',
    })
  );

  const outputGeoJSON: GeoJSON.FeatureCollection<Geometry, GeoJSONProperties> =
    {
      type: 'FeatureCollection',
      features: [],
    };

  const streetNames = new Set();
  const noLinkList = new Set();
  const stats = {
    numLink: 0,
    pcLink: '0.0',
    numNoLink: 0,
    pcNoLink: '0.0',
    numFemale: 0,
    pcFemale: '0.0',
    numMale: 0,
    pcMale: '0.0',
    totalNames: 0,
  };

  for (const feature of inputGeoJSON.features) {
    const entry =
      feature.properties && mappedToStreetName[feature.properties.name];

    if (
      entry &&
      (entry.gender === Gender.Woman || entry.gender === Gender.Man)
    ) {
      outputGeoJSON.features.push({
        ...feature,
        properties: {
          ...feature.properties,
          gender: entry.gender,
          links: entry.links,
        },
      });

      if (!streetNames.has(feature.properties!.name)) {
        streetNames.add(feature.properties!.name);

        if (entry.gender === Gender.Woman) {
          stats.numFemale++;

          const hasLinks = Object.values(entry.links).length > 0;
          if (hasLinks) stats.numLink++;
          else {
            stats.numNoLink++;
            noLinkList.add(feature.properties!.name);
          }
        } else {
          stats.numMale++;
        }
      }
    }
  }

  stats.totalNames = stats.numFemale + stats.numMale;
  stats.pcMale = ((stats.numMale * 100) / stats.totalNames).toFixed(1);
  stats.pcFemale = ((stats.numFemale * 100) / stats.totalNames).toFixed(1);

  const totalLinks = stats.numLink + stats.numNoLink;
  stats.pcLink = ((stats.numLink * 100) / totalLinks).toFixed(1);
  stats.pcNoLink = ((stats.numNoLink * 100) / totalLinks).toFixed(1);

  const legacyGeoJSON: GeoJSON.FeatureCollection<
    Geometry,
    LegacyGeoJSONProperties
  > = {
    type: 'FeatureCollection',
    features: outputGeoJSON.features.map(feature => ({
      ...feature,
      properties: {
        ...feature.properties,
        gender: getLegacyGender(feature.properties.gender),
        wikipedia_link:
          feature.properties.links[lang]?.wikipedia ??
          feature.properties.links['en']?.wikipedia ??
          Object.values(feature.properties.links)[0]?.wikipedia,
        scale: '',
      },
    })),
  };

  writeFileSync(
    path.join(cityFolder, 'final.geojson'),
    JSON.stringify(outputGeoJSON)
  );
  writeFileSync(
    path.join(cityFolder, 'final_tile.geojson'),
    JSON.stringify(legacyGeoJSON)
  );
  writeFileSync(path.join(cityFolder, 'stats.json'), JSON.stringify(stats));
  writeFileSync(
    path.join(cityFolder, 'noLinkList.txt'),
    [...noLinkList].join('\n')
  );
})();
