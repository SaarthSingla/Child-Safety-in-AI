import { networkInterfaces } from 'node:os';

import { createApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const app = createApp(config);

// One line per call from a child's phone, so a phone that cannot reach the
// server is easy to tell apart from one the server turned away.
app.server.on('request', (req, res) => {
  if (!req.url?.startsWith('/api/device/')) return;
  res.on('finish', () => console.log(`${new Date().toISOString()}  phone ${req.socket.remoteAddress}  ${req.method} ${req.url?.split('?')[0]}  ${res.statusCode}`));
});

app.server.listen(config.port, config.host, () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i!.address}:${config.port}`);

  console.log(`
NLPPS is running
  local:       http://localhost:${config.port}
  network:     ${lan.join(', ') || '(none)'}
  public URL:  ${config.publicUrl ?? '(derived from each request; set PUBLIC_URL to a tunnel URL)'}
  translator:  ${app.translator.name}
  public key:  ${JSON.stringify(app.key.publicJwk)}
`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.server.close();
    app.db.close();
    process.exit(0);
  });
}
