# Backend Scripts

This folder contains the scripts to automate song data collection and assist data tagging.

## Requirements

The requirements are:

* Python >= 3.10
* [beautifulsoup4](https://pypi.org/project/beautifulsoup4/) >= 4.7.0
* [psycopg](https://pypi.org/project/psycopg/) >= 3.2.0
* [Requests](https://pypi.org/project/requests/) >= 2.31.0

Additional requirements when migrating data:

* [openpyxl](https://pypi.org/project/openpyxl/) >= 3.0.10
* [pandas](https://pypi.org/project/pandas/) >= 2.0.0

## Modules

### Fetching Apple Music API

**[fetch.py](py/fetch.py)** accesses [Apple Music API](https://developer.apple.com/documentation/applemusicapi) to collect the metadata of all tracks in a public playlist. The mandatory arguments are the playlist id (`--id`) and output JSON path (`--output`).

Here's an example of fetching [danceXL](https://music.apple.com/us/playlist/pl.6bf4415b83ce4f3789614ac4c3675740) playlist created by Apple Music curators:

```shell
python .\py\fetch.py --id "pl.6bf4415b83ce4f3789614ac4c3675740" --output ..\data\fetch\web.json
```

The user would be prompted to provide their [Apple Music API developer token](https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens) to access the API:

```log
> Input Apple Music API developer token: 
```

> [!NOTE]
>
> To continue without a developer token, add the `--no-token` flag:
>
> ```shell
> python .\py\fetch.py --id "pl.6bf4415b83ce4f3789614ac4c3675740" --output ..\data\fetch\web.json --no-token
> ```
>
> The program would execute in the alternate mode (which is plain web-crawling), and this method could only fetch the first 300 tracks' data from the playlist.

Since tracks sometimes may be hidden in specific regions, the user could provide optional profiles to fetch the playlist. With the `--profiles` argument, the custom region-locale pairs could be configured.

The following example sets the following profiles:

* The United States store in *English (United States)*
* The Japan store in *Japanese*
* The South Korea store in *Korean*

```shell
python .\py\fetch.py --id "pl.6bf4415b83ce4f3789614ac4c3675740" --output ..\data\fetch\web.json --profiles us en-US jp ja kr ko
```

By default, the program uses the profiles below:

* The Taiwan store in *Traditional Chinese (Tawian)*
* The Taiwan store in *English (United Kingdom)*
* The China store in *Simplified Chinese (China)*
* The France store in *French (France)*
* The Japan store in *Japanese*
* The South Korea store in *Korean*
* The United States store in *English (United States)*

#### Schema of playlist JSON

| Name | Type | Description |
| ---- | ---- | ----------- |
| source | `string` | The source of this data. Can be either `APPLE_MUSIC` or `ITUNES`. |
| time | `string` | The output time expressed by an ISO 8601 timestamp in local time. |
| artists | `[Artist]` | All artists in the playlist songs. |
| albums | `[Album]` | All albums of the playlist songs. |
| songs | `[Song]` | All songs in the playlists. |

Album object:

| Name | Type | Description |
| ---- | ---- | ----------- |
| id | `string` | The Apple Music id for the album. |
| title | `Localization` | The album name. |
| artistID | `[string]` | The artists of the album. |
| artwork | `string?` | The URL to the artwork image. |
| compilation | `boolean` | Whether the album is a compilation. |
| discCount | `number` | The number of discs in the album. |
| preRelease | `boolean` | Whether the album is a pre-release. |
| releaseDate | `string?` | The release date in YYYY-MM-DD format. |
| single | `boolean` | Whether the album is a single. |
| trackCount | `number` | The number of tracks in each album disc. |
| upc | `string?` | The [Universal Product Code](https://en.wikipedia.org/wiki/Universal_Product_Code) of the album. |

Artist object:

| Name | Type | Description |
| ---- | ---- | ----------- |
| id | `string` | The Apple Music id for the artist. |
| title | `Localization` | The artist name. |
| artwork | `string?` | The URL to the artwork image. |

Localization object:

| Name | Type | Description |
| ---- | ---- | ----------- |
| en | `string?` | The English name. |
| fr | `string?` | The French name. |
| ja | `string?` | The Japanese name. |
| ko | `string?` | The Korean name. |
| zs | `string?` | The Simplified Chinese name. |
| zt | `string?` | The Traditional Chinese name. |

Song object:

| Name | Type | Description |
| ---- | ---- | ----------- |
| id | `string` | The Apple Music id for the song. |
| title | `Localization` | The song name. |
| audio | `string?` | The URL to a preview audio track of the song. |
| albumID | `string` | The album of the song. |
| artistID | `[string]` | The artists of the song. |
| discNumber | `number` | The disc number of the song. |
| duration | `number` | The song duration in milliseconds. |
| isrc | `string?` | The [International Standard Recording Code](https://en.wikipedia.org/wiki/International_Standard_Recording_Code) of the song. |
| locale | `string?` | The language of the audio content. |
| playCount | `number` | The play count of the song. |
| releaseDate | `string?` | The release date in YYYY-MM-DD format. |
| trackNumber | `number` | The track number of the song. |

### Migrate legacy data

**[clean_legacy_songs.py](py/clean_legacy_songs.py)** combines all intermediate library files generated in [taipeinative/apple-music](https://github.com/taipeinative/apple-music) into a single CSV file.

```shell
python .\py\clean_legacy_songs.py --manual path\to\library.csv --tmm path\to\tmm.csv --xlsx2512 path\to\Library-2025-12.xlsx --xml2504 path\to\2025-04.xml --xml2512 path\to\2025-12.xml --output ..\data\.legacy\library.csv
```

**[migrate_artists.py](py/migrate_artists.py)** reads the legacy [artists.json](../data/.legacy/artists.json) data and import them into the PostgreSQL database. The mandatory arguments include the host address (`--host`), the database name (`--dbname`), the user name (`--user`) and their password (`--password`).

```shell
python .\py\migrate_artists.py --host "localhost" --dbname "music" --user "auto_script" --password "********"
```

**[migrate_songs.py](py/migrate_songs.py)** reads the legacy [library.csv](../data/.legacy/library.csv) data and import them into the PostgreSQL database as well. It shares the same mandatory arguments with `migrate_artists.py`.

```shell
python .\py\migrate_songs.py --host "localhost" --dbname "music" --user "auto_script" --password "********"
```

### Create entry-to-song mappings

**[match.py](py/match.py)** checks the playlist JSON source ([web.json](../data/fetch/web.json)) and creates mappings based on the Apple Music API id, ISRC, or exact metadata. The user must explicitly add `--apply` flag to apply modifications, otherwise the script would only perfrom a dry run.

```shell
python .\py\match.py --host "localhost" --dbname "music" --user "auto_script" --password "********" --source-file "../data/fetch/web.json" --log-path "./log/match.log"
```
