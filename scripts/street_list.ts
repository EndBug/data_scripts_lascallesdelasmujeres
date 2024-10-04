'use strict';

const args = require('yargs')
  .usage('INITIAL STEP: Pass a city name and its OSM relation ID')
  .epilog('GeoChicas OSM 2020')
  .alias('h', 'help')
  .alias('c', 'city')
  .alias('r', 'relation')
  .alias('lang', 'language')
  .describe('c', 'City in your data folder')
  .describe('r', 'OSM relation ID for that city')
  .describe('lang', 'main language of the streets names')
  .demandOption(['c', 'r']).argv;

const filters = require('./filters').filters;
import * as fs from 'fs/promises';
import * as path from 'path';
import * as csv from 'csv';
import {processCity} from './utils/overpass';

function printArgs() {
  for (let j = 0; j < args.length; j++) {
    console.log(j + ' -> ' + args[j]);
  }
}

function cleanRoadName(roadName: string, lang = 'es') {
  const filterList = filters[lang].filter01;
  const filterList2 = filters[lang].filter02;

  for (let i = 0; i < filterList.length; i++) {
    if (roadName.indexOf(filterList[i]) !== -1) {
      let name = roadName.replace(filterList[i], '').trim();

      for (let j = 0; j < filterList2.length; j++) {
        if (name.indexOf(filterList2[j]) !== -1) {
          name = name.replace(filterList2[j], '').trim();
        }
      }

      return name;
    }
  }
  return roadName;
}

async function prepareListCSV(
  folder: string,
  currentLangs: string[]
): Promise<void> {
  const dir = path.join(__dirname, `/../data/${folder}`),
    fn = path.join(dir, 'list.csv');
  let numNoName = 0;

  await fs.mkdir(dir, {recursive: true});

  const fd = await fs.open(fn, 'w').catch(err => {
    console.error('Error opening list file.');
    throw err;
  });

  const logStream = fd.createWriteStream({
    encoding: 'utf8',
  });
  const namesSet = new Set<string>();

  const data = await fs
    .readFile(path.join(dir, `${folder}_streets.geojson`), 'utf8')
    .catch(err => {
      console.error('Error reading geojson file.');
      throw err;
    });

  const geojson = JSON.parse(data);

  console.log(
    `Number of streets (including duplicates): ${geojson.features.length}`
  );

  for (const feature of geojson.features) {
    if (feature.properties && feature.properties.name) {
      namesSet.add(feature.properties.name);
    } else {
      numNoName++;
    }
  }

  console.log(
    `Number of street names (so, without duplicates): ${namesSet.size}`
  );
  console.log('Number of streets without name:', numNoName);

  const stringifier = csv.stringify({
    delimiter: ';',
    header: true,
    columns: ['streetName', 'cleanName'],
  });
  stringifier.pipe(logStream);

  namesSet.forEach(streetName => {
    const cleanName = currentLangs.reduce(
      (name: string, lang: string) => cleanRoadName(name, lang),
      streetName
    );
    stringifier.write([streetName, cleanName]);
  });

  return new Promise((res, rej) => {
    stringifier
      .on('error', err => {
        console.error('Error on strigifier stream.');
        rej(err);
      })
      .end();

    logStream
      .on('error', err => {
        console.error('Error on log stream.');
        rej(err);
      })
      .on('finish', () => {
        fd.close();
        console.log('Finished writing list file.');
        res();
      });
  });
}

(async () => {
  printArgs();
  const city = args.city ? args.city : 'city';
  const relationIdOSM = args.relation ? args.relation : 1;
  const language = args.language ? args.language : 'es';

  const getStreetsResult = await processCity(city, relationIdOSM, language);
  if (!getStreetsResult) return;

  console.log('\nGenerating streets list...');
  await prepareListCSV(city, [language]);
})();
