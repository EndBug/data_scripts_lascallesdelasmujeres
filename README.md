# [WIP] Mapping scripts for LasCallesDeLasMujeres

> [!WARNING]
> This project is still under research and development. Its code and general structure may change at any time.

## Overview

This is a fork of [geochicasosm/data_scripts_lascallesdelasmujeres](https://github.com/geochicasosm/data_scripts_lascallesdelasmujeres), aimed at extending this project to more countries around the globe.

This reasearch is being conducted in collaboration with the [Geoinformatics department](https://www.geoinformatics.polimi.it/) at [Politecnico di Milano](https://polimi.it).

## Steps

### 1. `npm run street-list -- --city=CITY --language=LANG --relation=REL`

Gets the streets from OpenStreetMap and creates a CSV with the names, and the "clean" names (without language-specific prefixes and suffixes).

Requires the following parameters:

- `--city`: the city name, which will match the folder in `/data`
- `--language`: the language of the street names, see [this file](scripts/utils/languages.ts) for a list of supported languages
- `--relation`: the relation ID obtained from [OSM](https://www.openstreetmap.org/)

### 2. `npm run wikipedia-step -- --city=milano --language=it`

Classifies the streets from the previous step by querying Wikidata and Wikipedia.

Requried parameters match the ones from step 1.

### 3. `npm run inspect-unsure -- --city=milano --lang=it`

Inspects the streets that were classified as "unsure" by the previous step.

You will be provided with a list of modes to choose from. If you want to use the OpenAI API, create a `.env` file with the following structure:

```env
OPENAI_API_KEY=YOUR_API_KEY
```

> [!NOTE]
> On average, manual classification takes around ~17 seconds/record.

### 4. `npm run finalize -- --city=milano --lang=it`

Generates the final GeoJSON file you can then use in the website.
