'use strict';

const filters = require('./filters').filters;
const fs = require('fs/promises');
const path = require('path');

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
  const linesSet = new Set();

  const data = await fs
    .readFile(path.join(dir, `${folder}_streets.geojson`), 'utf8')
    .catch((err) => {
      console.error('Error reading geojson file.');
      throw err;
    });

  const geojson = JSON.parse(data);
  for (const feature of geojson.features) {
    if (feature.properties && feature.properties.name) {
      const roadName = feature.properties.name;
      const cleanName = currentLangs.reduce((name, lang) => cleanRoadName(name, lang), roadName);

      linesSet.add(`${feature.properties.name};${cleanName}\n`);
    } else {
      numNoName++;
    }
  }

  linesSet.forEach((line) => logStream.write(line));
  logStream.end();
  await fd.close();

  console.log(`Number of streets without name: ${numNoName}`);
}

async function applyGender(folder, currentLangs = ['es']) {
  prepareListCSV(folder, currentLangs);
}

module.exports = {
  applyGender,
};
