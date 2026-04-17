# Design Guidelines

This document concludes how the procedure and database should be set up to minimize the future effort to maintain and update the database.

## Multiple source of data

As of April 2026, I have to deal with **three sources of data**, and their schemata and values are a mess. The first source (A) represents the data migrated from [previous project](https://github.com/taipeinative/apple-music), which is based on the XML file exported from iTunes in December 2025. The second source (B) is the data pulled from Apple Music API, which only includes the tracks that was available in April 2026. And the third dataset (C) is the XML exported from Apple Music in April 2026.

### Schemata

#### Source A

| Field | Type | Description |
| ----- | ---- | ----------- |
| Name | `string` | The name of the song. |
| Apple ID | `number?` | The Apple Music API ID of the song. |
| Artist | `[string]` | The artist of the song. |
| Artist ID | `[number]` | The id of the artist of the song. |
| Disc Number | `number?` | The disc number of the song. |
| Duration | `string` | The duration of the song. |
| Genre | `string?` | The genre type of the song. |
| Genre Previous | `string` | The previous genre type of the song , defined by the artist or manually edited. |
| ISRC | `string?` | The ISRC of the song. |
| Play Count 1 | `number?` | The play count of the song in 2020-2025. |
| Play Count 2 | `number?` | The play count of the song in 2025. |
| Playlists | `[string]` | The playlists where the song is added. |
| Language | `string?` | The language of the song. |
| Tag 1 | `string?` | The extra descripter of the song. |
| Tag 2 | `string?` | The extra descripter of the song. |
| Tag 3 | `string?` | The extra descripter of the song. |
| Track Number | `number?` | The track number of the song. |
| Vocal | `string?` | The vocal type of the song. |
| Year | `number?` | The year of the song release date. |

*There are 2,566 songs in total, and 1,082 songs among them have been manually verified. 1,057 songs have Apple Music API ID attached.*

#### Source B

See [Fetching Apple Music API](../../backend/Readme.md#schema-of-playlist-json) chapter in `backend\Readme.md`. There are 2,877 songs in total.

#### Source C
