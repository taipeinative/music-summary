const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { EnvFileStore } = require('../src/env-file-store');

async function createFixture() {
  if (!process.env.PORTAL_TEST_ENV) throw new Error('Set PORTAL_TEST_ENV to an explicit test PostgreSQL connection env file.');
  const config = await new EnvFileStore(process.env.PORTAL_TEST_ENV).readDatabaseConfig();
  if (!config) throw new Error('Set PORTAL_TEST_ENV to a PostgreSQL connection env file. Tests create a separate disposable database.');
  const name = `portal_test_${Date.now()}_${process.pid}`;
  const admin = new Pool(config);
  try { await admin.query(`CREATE DATABASE ${name}`); } catch (error) { await admin.end(); throw error; }
  const pool = new Pool({ ...config, database: name });
  async function dispose() {
    await pool.end();
    await admin.query(`DROP DATABASE ${name}`);
    await admin.end();
  }
  try {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../py/music_db/schema.py'), 'utf8');
    const ddl = Object.fromEntries([...source.matchAll(/^(\w+) = """([\s\S]*?)"""/gm)].map((m) => [m[1], m[2]]));
    const first = ['ALBUMS_TABLE', 'ARTISTS_TABLE', 'SONGS_TABLE', 'SOURCES_TABLE', 'ENTRIES_TABLE', 'ENTRY_ISSUES_TABLE', 'ENTRY_GROUP_TABLE'];
    for (const key of [...first, ...Object.keys(ddl).filter((k) => !first.includes(k) && !k.endsWith('_OVERVIEW')), ...Object.keys(ddl).filter((k) => k.endsWith('_OVERVIEW'))]) await pool.query(ddl[key]);
    await pool.query(`INSERT INTO artists(artist_tag) SELECT 3 FROM generate_series(1,3);
      INSERT INTO artist_titles(artist_id,locale,title,normalized_title,fallback) VALUES (1,1,'A','a',true),(2,1,'C','c',true),(3,1,'B','b',true),(1,2,'English A','english a',false),(1,32768,'繁體藝人','繁體藝人',false);
      INSERT INTO artist_relations VALUES (1,2,1);
      INSERT INTO artist_alias VALUES (1,'Alias A','alias a');
      INSERT INTO albums(album_type,disc_count,release_date) VALUES(2,2,'2024-01-02');
      INSERT INTO album_titles(album_id,locale,title,normalized_title,fallback) VALUES(1,1,'Test Album','test album',true);
      INSERT INTO album_track_counts VALUES(1,1,8),(1,2,7);
      INSERT INTO album_artists VALUES(1,1,0),(1,2,1),(1,3,2);
      INSERT INTO songs(duration,genre_tag,genre_info,media_tag,vocal,release_date) SELECT 180000 + i,3,0,0,4,'2024-01-02' FROM generate_series(1,125) i;
      INSERT INTO song_titles(song_id,locale,title,normalized_title,fallback) SELECT song_id,1,'Song ' || song_id,'song ' || song_id,true FROM songs;
      INSERT INTO song_titles(song_id,locale,title,normalized_title,fallback) VALUES(1,2,'English Song','english song',false),(1,32768,'繁體歌曲','繁體歌曲',false);
      INSERT INTO song_artists VALUES(1,1,0,NULL,0),(1,2,1,NULL,1),(1,3,2,NULL,1);
      INSERT INTO song_artists VALUES(2,3,0,NULL,0),(2,1,1,NULL,0),(2,2,2,NULL,0),(3,1,0,NULL,0),(3,3,1,NULL,1);
      INSERT INTO album_tracks VALUES(1,1,1,1);
      INSERT INTO song_locales(song_id,locale,is_primary) VALUES(1,32768,true),(1,2,false),(1,64,false);
      INSERT INTO sources(export_date,import_date,source_file,source_type) VALUES('2024-01-01','2024-01-02','portal-fixture.json',1);
      INSERT INTO entries(source_id,source_item_id,normalized_album,normalized_artist,normalized_title,raw_album,raw_artist,raw_duration,raw_json,raw_title)
      SELECT 1,i,'test album','a','song '||i,'Test Album','A',180000,'{}'::json,'Song '||i FROM generate_series(1,4) i;
      INSERT INTO entry_mapping(entry_id,song_id,confidence,match_method,status) VALUES(1,1,1,3,0),(2,2,1,3,1),(3,3,1,3,0);
      INSERT INTO entry_issues(entry_id,reason,resolved_at) VALUES(1,'NO_CANDIDATE',NULL),(2,'TITLE_CONFLICT',NULL),(3,'NO_CANDIDATE',NULL),(4,'NO_CANDIDATE',now());
      INSERT INTO entry_group(status,details) SELECT 0,'{}'::jsonb FROM generate_series(1,3);
      INSERT INTO entry_group_entries(group_id,entry_id) VALUES(1,1),(2,2),(3,3);
      INSERT INTO entry_group_issues VALUES(1,1),(2,2),(3,3);`);
    return { pool, config: { ...config, database: name }, dispose };
  } catch (error) { console.error('Fixture setup failed:', error.message); await dispose(); throw error; }
}
module.exports = { createFixture };
