import { readFile, writeFile } from 'node:fs/promises';
import { parse } from 'dotenv';

// Copy only the two supported secrets. Never upload local PORT, HOST, APP_ORIGIN,
// or unrelated environment entries; never print any secret values.
try {
  const existing = await readFile('.dev.vars', 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (existing !== null) {
    if (!parse(existing).OPENAI_API_KEY?.trim()) throw new Error('Įrašykite OPENAI_API_KEY į esamą .dev.vars failą. Failas nebuvo pakeistas.');
    console.log('Naudosime esamą .dev.vars. Paslaptys nepakeistos.');
  } else {
    const source = parse(await readFile('.env', 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; }));
    const key = source.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    if (!key?.trim()) throw new Error('Pirmiausia įrašykite OPENAI_API_KEY į .env arba nukopijuokite .dev.vars.example į .dev.vars ir įrašykite raktą ten.');
    const secrets = { OPENAI_API_KEY: key, ...(source.TRIP_ACCESS_TOKEN ? { TRIP_ACCESS_TOKEN: source.TRIP_ACCESS_TOKEN } : {}) };
    const content = Object.entries(secrets).map(([name, value]) => `${name}=${JSON.stringify(value)}`).join('\n') + '\n';
    await writeFile('.dev.vars', content, { flag: 'wx', mode: 0o600 });
    console.log('Paruoštas privatus .dev.vars failas. API raktas nebus įtrauktas į svetainės failus ar Git.');
  }
  console.log('Diegimas: npx wrangler login, tada npm run cf:deploy.');
} catch (error) {
  console.error(error.code === 'EEXIST' ? '.dev.vars jau yra; failas nebuvo pakeistas.' : error instanceof Error && !('code' in error) ? error.message : 'Nepavyko paruošti .dev.vars. Patikrinkite failo teises ir bandykite dar kartą.');
  process.exitCode = 1;
}
