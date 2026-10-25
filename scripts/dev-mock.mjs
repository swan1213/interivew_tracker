// Starts the dev server with a fake Google, so the Gmail flow can be tried without credentials.
// Data is kept in server/data-mock so it never mixes with a real account.
process.env.GOOGLE_MOCK = '1';
process.env.IFLOW_DATA_DIR = process.env.IFLOW_DATA_DIR || 'server/data-mock';
const port = parseInt(process.env.PORT || '5173', 10);
process.env.APP_URL = process.env.APP_URL || 'http://localhost:' + port;

const { createServer } = await import('vite');
const server = await createServer({ server: { port, strictPort: true, host: '127.0.0.1' } });
await server.listen();
server.printUrls();
console.log('  Google: MOCK (sign-in succeeds instantly; mailbox = demo data in Gmail format)');
