import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js');
const destination = resolve(root, 'public/assets/simplewebauthn-browser-14.0.0.min.js');
const packageJSON = JSON.parse(await readFile(resolve(root, 'node_modules/@simplewebauthn/browser/package.json'), 'utf8'));
if (packageJSON.version !== '14.0.0') throw new Error('Unexpected @simplewebauthn/browser version');
await copyFile(source, destination);
const contents = await readFile(destination, 'utf8');
if (!contents.includes('@simplewebauthn/browser@14.0.0')) throw new Error('Copied browser bundle failed its version marker check');
await writeFile(destination, contents, { encoding: 'utf8', mode: 0o644 });
