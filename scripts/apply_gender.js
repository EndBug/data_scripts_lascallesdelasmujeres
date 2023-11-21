'use strict';

const filters = require('./filters').filters;
const fs = require('fs/promises');
const path = require('path');
const csv = require('csv');

function cleanRoadName(roadName, lang = 'es') {
  const filterList = filters[lang].filter01;
  const filterList2 = filters[lang].filter02;

  for (var i = 0; i < filterList.length; i++) {
    if (roadName.indexOf(filterList[i]) !== -1) {
      var name = roadName.replace(filterList[i], '').trim();

      for (var j = 0; j < filterList2.length; j++) {
        if (name.indexOf(filterList2[j]) !== -1) {
          name = name.replace(filterList2[j], '').trim();
        }
      }

      return name;
    }
  }
  return roadName;
}

async function prepareListCSV(folder, currentLangs) {
  const dir = path.join(__dirname, `/../data/${folder}`),
    fn = path.join(dir, 'list.csv');
  // eslint-disable-next-line no-unused-vars
  let numNoName = 0;

  await fs.mkdir(dir, { recursive: true });

  const fd = await fs.open(fn, 'w').catch((err) => {
    console.error('Error opening list file.');
    throw err;
  });

  const logStream = fd.createWriteStream({
    encoding: 'utf8',
    flags: 'a',
  });
  const namesSet = new Set();

  const data = await fs
    .readFile(path.join(dir, `${folder}_streets.geojson`), 'utf8')
    .catch((err) => {
      console.error('Error reading geojson file.');
      throw err;
    });

  const geojson = JSON.parse(data);
  for (const feature of geojson.features) {
    if (feature.properties && feature.properties.name) {
      namesSet.add(feature.properties.name);
    } else {
      numNoName++;
    }
  }

  const stringifier = csv.stringify({
    delimiter: ';',
    header: true,
    columns: ['streetName', 'cleanName'],
  });

  namesSet.forEach((streetName) => {
    const cleanName = currentLangs.reduce((name, lang) => cleanRoadName(name, lang), streetName);
    stringifier.write([streetName, cleanName]);
  });

  return new Promise((res, rej) => {
    stringifier
      .on('error', (err) => {
        console.error('Error on strigifier stream.');
        rej(err);
      })
      .end()
      .pipe(logStream);

    logStream
      .on('error', (err) => {
        console.error('Error on log stream.');
        rej(err);
      })
      .on('finish', () => {
        fd.close();
        console.log('Finished writing list file.');
        console.log('Number of streets without name: ', numNoName);
        res();
      });
  });
}

async function applyGender(folder, currentLangs = ['es']) {
  prepareListCSV(folder, currentLangs);
}

module.exports = {
  applyGender,
};
