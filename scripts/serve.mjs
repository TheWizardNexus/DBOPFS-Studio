import path from 'node:path';
import { createStaticServer } from './static-server.mjs';
import { isMainModule, pagesRoot, resolveFromProject } from './project.mjs';

function readOption(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

export async function serve() {
  const rootValue = readOption('--root', pagesRoot);
  const root = path.isAbsolute(rootValue) ? rootValue : resolveFromProject(rootValue);
  const host = readOption('--host', '127.0.0.1');
  const port = Number(readOption('--port', process.env.PORT || 4173));
  const running = await createStaticServer({ root, host, port });
  console.log(`Serving ${path.relative(process.cwd(), root) || '.'} at ${running.origin}`);
  console.log('Press Ctrl+C to stop.');
  return running;
}

if (isMainModule(import.meta.url)) {
  serve().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
