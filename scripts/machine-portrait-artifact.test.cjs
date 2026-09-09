const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const surface = path.resolve(__dirname, '..');
const objects = path.resolve(process.env.MPA_OBJECTS_ROOT || path.join(surface, '../objects'));
const artifact = path.join(surface, 'instrument-mpa');
const manifest = JSON.parse(fs.readFileSync(path.join(artifact, 'SOURCE.json')));

test('artifact pins the canonical objects commit and copies every JavaScript byte exactly', () => {
  assert.equal(manifest.commit, execFileSync('git', ['-C', objects, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
  for (const file of manifest.runtimeFiles.filter(file => file.endsWith('.js'))) {
    assert.deepEqual(fs.readFileSync(path.join(artifact, file)), fs.readFileSync(path.join(objects, 'machine-portrait', file)), file);
  }
});

test('all runtime imports are included, especially source-input.js', () => {
  assert.ok(manifest.runtimeFiles.includes('js/source-input.js'));
  for (const file of manifest.runtimeFiles.filter(file => file.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(artifact, file), 'utf8');
    for (const match of source.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
      assert.ok(manifest.runtimeFiles.includes(target), `${file} requires ${target}`);
    }
    assert.doesNotMatch(source, /__decodeCalls|export \{ readSpecimen, state|sk_(?:live|test)_[A-Za-z0-9]+/);
  }
});

test('public artifact contains runtime files only; no tests, fixtures, source photos or server credentials', () => {
  function files(dir, prefix = '') {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name), prefix + entry.name + '/') : [prefix + entry.name]);
  }
  assert.deepEqual(files(artifact).sort(), [...manifest.runtimeFiles, 'SOURCE.json'].sort());
  const script = fs.readFileSync(path.join(surface, 'scripts/sync-machine-portrait.sh'), 'utf8');
  assert.match(script, /Refusing to sync from a modified objects/);
  assert.doesNotMatch(script, /cp\s+-[a-zA-Z]*r|test\/fixtures/);
});

test('both route forms retain the public module base and unchanged measurement/issuance endpoints', () => {
  const html = fs.readFileSync(path.join(artifact, 'index.html'), 'utf8');
  assert.match(html, /<base href="\/instrument-mpa\/">/);
  assert.match(html, /href="\/instruments"/);
  const app = fs.readFileSync(path.join(artifact, 'js/apparatus.js'), 'utf8');
  assert.match(app, /fetch\("\/api\/machine-portrait"/);
  assert.match(app, /const PUBLIC_FRAMINGS = \["asread"\]/);
  assert.match(app, /const PRINCIPAL_MARK = "2c"/);
  assert.match(app, /colorSpaceConversion: "default"/);
});
