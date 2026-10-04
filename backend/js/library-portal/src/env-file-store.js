const fs = require('node:fs/promises');

function parseEnv(content) {
  const values = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separator = trimmed.indexOf('=');
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
      value = value.slice(1, -1);
    }
    values[key] = value.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }

  return values;
}

function serializeEnv(values) {
  return Object.entries(values)
    .map(([key, value]) => `${key}=${JSON.stringify(String(value ?? ''))}`)
    .join('\n') + '\n';
}

class EnvFileStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async readValues() {
    try {
      return parseEnv(await fs.readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') {
        return {};
      }
      throw error;
    }
  }

  async writeValues(values) {
    await fs.writeFile(this.filePath, serializeEnv(values), 'utf8');
  }

  async readDatabaseConfig() {
    const env = await this.readValues();
    if (!env.DB_HOST || !env.DB_NAME || !env.DB_USER || !env.DB_PASSWORD) {
      return null;
    }

    return {
      host: env.DB_HOST,
      database: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      port: Number(env.DB_PORT || 5432)
    };
  }

  async saveDatabaseConfig(config) {
    const existing = await this.readValues();
    await this.writeValues({
      ...existing,
      DB_HOST: config.host,
      DB_PORT: config.port,
      DB_NAME: config.database,
      DB_USER: config.user,
      DB_PASSWORD: config.password
    });
  }

  async readUiSettings() {
    const env = await this.readValues();
    const settings = {};

    if (env.UI_CHANGELOG_COLUMN_WIDTHS) {
      try {
        settings.changelogColumnWidths = JSON.parse(env.UI_CHANGELOG_COLUMN_WIDTHS);
      } catch (_error) {
        settings.changelogColumnWidths = null;
      }
    }
    if (env.UI_TABLE_COLUMN_WIDTHS) {
      try {
        settings.tableColumnWidths = JSON.parse(env.UI_TABLE_COLUMN_WIDTHS);
      } catch (_error) {
        settings.tableColumnWidths = null;
      }
    }

    return settings;
  }

  async saveUiSettings(settings) {
    const nextEnv = { ...await this.readValues() };

    if (settings.changelogColumnWidths && typeof settings.changelogColumnWidths === 'object') {
      nextEnv.UI_CHANGELOG_COLUMN_WIDTHS = JSON.stringify(settings.changelogColumnWidths);
    }
    if (settings.tableColumnWidths && typeof settings.tableColumnWidths === 'object') {
      nextEnv.UI_TABLE_COLUMN_WIDTHS = JSON.stringify(settings.tableColumnWidths);
    }

    await this.writeValues(nextEnv);
  }

  async delete() {
    await fs.rm(this.filePath, { force: true });
  }
}

module.exports = {
  EnvFileStore,
  parseEnv,
  serializeEnv
};
