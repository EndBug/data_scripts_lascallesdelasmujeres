import OpenAI from 'openai';
import * as csvSync from 'csv/sync';
import * as csv from 'csv';
import {createWriteStream, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import {get_encoding} from '@dqbd/tiktoken';
import {confirm, input, password, rawlist, select} from '@inquirer/prompts';
import yargs from 'yargs';
import {hideBin} from 'yargs/helpers';
import {Language} from './utils/languages';
import ProgressBar from 'progress';
import clipboard from 'clipboardy';
import {
  Gender,
  getEntityLinks,
  getLinksLanguages,
  isGender,
} from './utils/wiki';
import {cachePerson, cacheStreet, writeCache} from './utils/cache';

const TOKEN_LIMIT = 4000;

const encoding = get_encoding('cl100k_base');
function countTokens(text: string) {
  if (typeof text !== 'string') {
    throw new Error('text must be a string');
  }

  return encoding.encode(text).length;
}
function splitListByTokens(words: string[]) {
  const chunks: string[] = [];
  let currentChunk: string[] = [];

  for (const word of words) {
    // Temporarily add the word to the current chunk and encode
    const tempChunk = [...currentChunk, word];
    const tokenCount = countTokens(tempChunk.join(';'));

    if (tokenCount > TOKEN_LIMIT) {
      // If the current chunk exceeds max tokens, finalize the chunk
      chunks.push(currentChunk.join(';'));
      currentChunk = [word]; // Start a new chunk with the current word
    } else {
      currentChunk.push(word);
    }
  }

  // Add any remaining words as the last chunk
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(';'));
  }

  return chunks;
}

const prompts: Partial<Record<Language, string>> = {
  it: `
Sei un assistente che legge delle liste di nomi di vie, e che risponde unicamente utilizzando il formato specificato. 
Non rispondere con nessun altro testo, per nessuna ragione: non importa se sia un consiglio, un suggerimento, un'osservazione, ecc.
Di questi nomi di vie in italiano, quali pensi siano dedicati a delle persone (ovvero non a oggetti, luoghi, ect.)?
Rispondi unicamente con una lista di nomeVia;genere uno per riga
Per genere usa ${Gender.Man} per maschile, ${Gender.Woman} per femminile, ${Gender.Unknown} per sconosciuto.
Rispondi solamente con nomi che appartengono alla lista fornita, non inventarti degli elementi per alcuna ragione.
`.trim(),
  en: `
You are an assistant made to classify street names, and that will only reply using the specified format.
Do not reply with anything else, for any reason: it doesn't matter if it's a suggestion, a tip, an observation, etc.
Of these street names in English, which ones do you think are dedicated to people (i.e. not objects, places, etc.)?
Reply only with a list of streetName;gender one per line.
For the gender use ${Gender.Man} for male, ${Gender.Woman} for female, ${Gender.Unknown} for unknown.
Reply only with names that belong to the list provided, do not invent any elements for any reason.
  `.trim(),
};

enum ReEvaluationMode {
  CHATGPT_API,
  CHATGPT_FREE,
  MANUAL,
}

const modes: Record<
  ReEvaluationMode,
  (lang: Language, inputRecords: string[][]) => Promise<[string, Gender][]>
> = {
  [ReEvaluationMode.CHATGPT_API]: ChatGPTAPIReevaluation,
  [ReEvaluationMode.CHATGPT_FREE]: async () => [],
  [ReEvaluationMode.MANUAL]: async () => [],
};

async function ChatGPTAPIReevaluation(
  lang: Language,
  inputRecords: string[][]
) {
  const prompt = prompts[lang];
  if (!prompt) {
    console.error(`No prompt available for ${lang}`);
    return [];
  }

  const messages = splitListByTokens(inputRecords.map(r => r[0])).map(
    chunk => ({
      role: 'user' as const,
      content: chunk,
    })
  );
  const totalTokenCount =
    messages
      .map(m => countTokens(m.content as string))
      .reduce((acc, curr) => acc + curr, 0) +
    countTokens(prompt) * messages.length;

  console.log(`Total token count: ${totalTokenCount}`);
  console.log(
    `Estimated cost: ${((totalTokenCount / 1000000) * 5).toFixed(4)} USD`
  );
  console.log(`Resulting calls: ${messages.length}`);

  const confirmed = await confirm({message: 'Do you want to proceed?'});
  if (!confirmed) {
    console.log('Aborting...');
    return [];
  }

  let token = process.env.OPENAI_API_KEY;
  if (!token) {
    token = await password({
      message:
        'No OPENAI_API_KEY en variable found. To avoid having to enter it manually ' +
        'every time, create a .env file containing you token. Please enter your API key:',
    });
  }

  console.log(`Sending request with ${messages.length} messages...`);
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const outputRecords: [string, string][] = [];
  const progressBar = new ProgressBar(
    'Progress: [:bar] :current/:total :percent :etas',
    messages.length
  );
  progressBar.tick(0);

  // Query OpenAI's API
  for (const message of messages) {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{role: 'system', content: prompt}, message],
    });
    progressBar.tick();

    // Push the (quickly parsed) records to the output
    outputRecords.push(
      ...(response.choices[0].message.content
        ?.trim()
        .split('\n')
        .map(word => word.trim().split(';').slice(0, 2) as [string, string]) ??
        [])
    );
  }

  const filteredOutputRecords: [string, Gender][] = (
    outputRecords
      // Filter only the ones that have a valid gender tag
      .filter(record => isGender(record[1])) as [string, Gender][]
  )
    // Filter only the ones that actually were in the original list
    .filter(record => inputRecords.some(r => r[0] === record[0]));
  console.log(
    `${filteredOutputRecords.length} records need confirmation. There were ${outputRecords.length - filteredOutputRecords.length} invalid records.`
  );

  return filteredOutputRecords;
}

(async () => {
  const args = await yargs(hideBin(process.argv))
    .usage(
      `
      This steps aims to re-evaluate the list of unsure streets. There are three modes available:
      1) Use OpenAI's GPT-4o-mini model to re-evaluate the list automatically via the API (requires an API key and sufficient credits)
      2) Use the free version of ChatGPT to copy-paste prompts and responses (requires an account but no credits are needed)
      3) Manually sort through all the entries (very slow, but it's an option)
      `.trim()
    )
    .alias('c', 'city')
    .alias('lang', 'language')
    .describe('c', 'City in your data folder')
    .describe('lang', 'main language of the streets names')
    .demandOption(['c', 'lang']).argv;

  const lang = args.lang as Language,
    city = args.city as string;

  const Mode = await rawlist({
    choices: [
      {
        value: ReEvaluationMode.CHATGPT_API,
        name: 'Use OpenAI API (requires an API key and sufficient credits)',
      },
      {
        value: ReEvaluationMode.CHATGPT_FREE,
        name: 'Use ChatGPT free version',
      },
      {value: ReEvaluationMode.MANUAL, name: 'Re-evaluate everything'},
    ],
    message: 'How do you want to filter the possible missed entries?',
  });

  const cityFolder = join(__dirname, '../data', city);
  const inputFile = readFileSync(join(cityFolder, 'list_unsure.csv'), 'utf8');
  // .split('\n')
  // .slice(0, 1000)
  // .join('\n');

  const inputRecords: string[][] = csvSync.parse(inputFile, {
    delimiter: ';',
    from_line: 2,
  });

  const reEvaluatedRecords = await modes[Mode](lang, inputRecords);
  if (reEvaluatedRecords.length === 0) {
    console.log('No records found, exiting.');
    return;
  }

  writeFileSync(
    join(cityFolder, 'list_unsure_reevaluated_tbc.csv'),
    csvSync.stringify(reEvaluatedRecords, {
      columns: ['streetName', 'gender'],
      header: true,
      delimiter: ';',
    })
  );

  /** [streetName, gender, wikiJSON] */
  const resultStringifier = csv.stringify({
    delimiter: ';',
    header: true,
    columns: ['streetName', 'gender', 'wikiJSON'],
  });
  resultStringifier.on('error', err => {
    console.error('Error writing found file.');
    throw err;
  });

  const resultFn = join(cityFolder, 'list_unsure_confirmed.csv');
  const resultFileStream = createWriteStream(resultFn, 'utf-8');
  resultStringifier.pipe(resultFileStream);

  const progressBar = new ProgressBar(
    'Progress: [:bar] :current/:total :percent',
    reEvaluatedRecords.length
  );
  progressBar.tick(0);

  for (const [streetName, proposedGender] of reEvaluatedRecords) {
    console.log(
      `
    Street name: ${streetName}
    Possible gender: ${proposedGender}
    `.trim()
    );

    const gender = await select({
      choices: [
        {value: Gender.Man, name: 'Male'},
        {value: Gender.Woman, name: 'Female'},
        {value: Gender.Unknown, name: 'Not a person'},
        {value: null, name: 'Skip entry'},
      ],
      message: 'What is the gender of this street?',
      default: proposedGender,
    });

    if (gender === Gender.Unknown) {
      // Mark this entry as a confirmed non-person entry
      cacheStreet(streetName, gender);
    } else if (gender !== null) {
      // Copy the street name to the clipboard
      clipboard.writeSync(streetName);

      const linksLangs = getLinksLanguages(lang);

      const wikidataId = (
        await input({
          message:
            'What is the Wikidata ID for this person? (leave blank if unknown)',
          validate: str =>
            !str ||
            str.startsWith('Q') ||
            'This is not a Wikidata ID: Wikidata IDs are the identifiers that start with a Q, you can find them in the page URL',
          transformer: str => str.trim().toUpperCase(),
        })
      )
        .trim()
        .toUpperCase();

      cacheStreet(streetName, gender, wikidataId || undefined);

      if (wikidataId) {
        if (gender === Gender.Man) {
          cachePerson(wikidataId, Gender.Man);
          resultStringifier.write([streetName, Gender.Man, '']);
        } else {
          const links = await getEntityLinks(wikidataId, linksLangs);
          cachePerson(wikidataId, gender, links);
          resultStringifier.write([streetName, gender, JSON.stringify(links)]);
        }
      }
    }

    progressBar.tick();
    // This process is slow, so writing at every entry is worth it.
    writeCache();
  }

  resultStringifier.end();
})();
