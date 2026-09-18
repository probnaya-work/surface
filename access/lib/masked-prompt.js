// Read one secret from a real terminal without terminal echo. Never pass the
// connection URL on a command line or through a persistent shell export.
export function readMaskedLine({ input = process.stdin, output = process.stderr, prompt = 'access_operator DATABASE_URL: ' } = {}) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') {
    return Promise.reject(new Error('A terminal is required for the masked database credential prompt'));
  }
  return new Promise((resolve, reject) => {
    let value = '';
    const wasRaw = input.isRaw === true;
    const finish = (error) => {
      input.off('data', onData);
      input.off('error', onError);
      input.setRawMode(wasRaw);
      input.pause();
      output.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onError = () => finish(new Error('Credential input failed'));
    const onData = (chunk) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u0003' || character === '\u0004') return finish(new Error('Credential input cancelled'));
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
        } else if (character >= ' ' && character !== '\u007f') {
          value += character;
          if (value.length > 4096) return finish(new Error('Credential input is too long'));
        }
      }
    };
    output.write(prompt);
    input.setRawMode(true);
    input.on('data', onData);
    input.on('error', onError);
    input.resume();
  });
}
