const { Pool, types } = require('pg');
const { auditContext, beginAudit, finishAudit } = require('./audit');
const { pythonTransaction } = require('./python-client');

class LibraryDatabase {
  constructor({ configStore, poolOptions = {} }) {
    this.configStore = configStore;
    this.poolOptions = poolOptions;
    this.pool = null;
    this.activeConfig = null;
  }

  static toPublicConfig(config) {
    if (!config) {
      return null;
    }

    return {
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user
    };
  }

  get publicConfig() {
    return LibraryDatabase.toPublicConfig(this.activeConfig);
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
    }
    this.pool = null;
    this.activeConfig = null;
  }

  async connect(config) {
    await this.close();

    const nextPool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      max: 5,
      idleTimeoutMillis: 30000,
      types: { getTypeParser: (oid, format) => oid === 1082 ? (value) => value : types.getTypeParser(oid, format) },
      ...this.poolOptions
    });

    const client = await nextPool.connect();
    try {
      await client.query('SELECT 1');
    } finally {
      client.release();
    }

    this.pool = nextPool;
    this.activeConfig = config;
  }

  async ensure() {
    if (this.pool) {
      return;
    }

    const savedConfig = await this.configStore.readDatabaseConfig();
    if (!savedConfig) {
      const error = new Error('No database configuration has been saved.');
      error.status = 401;
      throw error;
    }

    await this.connect(savedConfig);
  }

  async query(sql, params = []) {
    return this.transaction(async (client) => (await client.query(sql, params)).rows, { readOnly: /^\s*SELECT\b/i.test(sql) });
  }

  async tableExists(tableName) {
    const rows = await this.query('SELECT to_regclass($1) AS relation', [`public.${tableName}`]);
    return Boolean(rows[0]?.relation);
  }

  async transaction(callback, { readOnly = false } = {}) {
    await this.ensure();
    const metadata = readOnly ? null : auditContext.getStore();
    if (metadata && (!metadata.changedBy?.trim() || !metadata.reason?.trim())) throw new Error('Audit actor and reason are required.');
    if (metadata?.python) return pythonTransaction(this.activeConfig, metadata, callback);
    const client = await this.pool.connect();
    try {
      await client.query(metadata ? 'BEGIN' : 'BEGIN READ ONLY');
      if (metadata) await beginAudit(client);
      const result = await callback(client);
      if (metadata) await finishAudit(client, metadata);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = {
  LibraryDatabase
};
