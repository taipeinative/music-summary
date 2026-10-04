// Disposable real-database UI fixture. Ctrl+C closes it and drops its database.
const { createFixture } = require('./database-fixture');
(async () => {
  const fixture = await createFixture();
  const { app, database } = require('../server');
  let savedConfig = fixture.config;
  database.configStore.readDatabaseConfig = async () => savedConfig;
  database.configStore.saveDatabaseConfig = async (config) => { savedConfig = config; };
  database.configStore.delete = async () => { savedConfig = null; };
  await database.connect(fixture.config);
  const server = app.listen(Number(process.env.PORT || 3005), '127.0.0.1', () => {
    console.log('Fixture preview: http://localhost:' + server.address().port);
    console.log('Preview database: ' + fixture.config.database);
  });
  server.on('error', async (error) => { console.error(error.message); await database.close(); await fixture.dispose(); process.exitCode = 1; });
  async function close() {
    await new Promise((resolve) => server.close(resolve)); await database.close(); await fixture.dispose(); process.exit(0);
  }
  process.on('SIGINT', close); process.on('SIGTERM', close);
})().catch((error) => { console.error(error); process.exitCode = 1; });
