# Design Guidelines

This document concludes how the procedure and database should be set up to minimize the future effort to maintain and update the database.

## Multiple source of data

As of April 2026, I have to deal with **three sources of data**, and their schemata and values are a mess. The first source (A) represents the data migrated from [previous project](https://github.com/taipeinative/apple-music), which is based on the XML file exported from iTunes in December 2025. The second source (B) is the data pulled from Apple Music API, which only includes the tracks that was available in April 2026. And the third dataset (C) is the XML exported from Apple Music in April 2026.

### Schemata

#### Source A

| Field | Type | Description |
| ----- | ---- | ----------- |
| legacy_id | `number` | The internal ID within this source. |
| id 2504 | `number?` | The private library track ID in April 2025. |
| id 2512 | `number` | The private library track ID in December 2025. |
| verified | `boolean` | Whether the track's metadata had been verified by me. |
| library | `boolean` | Whether the track had been added to the library. |
| name 2504 | `string?` | The name of the song in April 2025. |
| name 2512 | `string` | The name of the song in December 2025. |
| artist | `string?` | The comma-separated list of all artist participating in the song, in their Apple Music API ID. Note that a placeholder value `0` indicates the artist has no Apple Music API ID. |
| artist_label | `string?` | The comma-separated list of all artist participating in the song, in their literal name. |
| artist_primary 2504 | `string?` | The primary artists of the song in April 2025. |
| artist_primary 2512 | `string` | The primary artists of the song in December 2025. |
| album 2504 | `string?` | The album name of the song in April 2025. |
| album 2512 | `string` | The album name of the song in December 2025. |
| play_count 2504 | `number` | The total play count of the song as of April 2025. |
| play_count 2512 | `number` | The total play count of the song as of December 2025. |
| play_count_deducted | `number` | The deducted number of play count of the song between April 2025 and December 2025. This possibly might be the synchronization issue on Apple Music's side, and these numbers are kept to record the true play count. |
| play_count_2025 | `number` | The play count accumulated within the year 2025. |
| disc_number | `number?` | The disc number of the song. |
| disc_count | `number?` | The disc count of the album that the song belongs to. |
| track_number | `number?` | The track number of the song. |
| track_count | `number` | The track count of the disc from the album that the song belongs to. |
| duration | `number` | The duration of the song. |
| release_date | `string` | The released date of the song, in the format of `YYYY-MM-DD hh:mm:ss`. |
| added_date | `string?` | This date appears to be the date added to the library for those tracks in the library, and the export date for those are not in the library. |
| modified_date | `string` | This date indicates the first date the user "touched" the song, e.g. added to the library or a playlist. |
| vocal | `string?` | The vocalist type of the song. |
| locale | `string?` | The primary language used in the song. |
| genre | `string?` | The genre of the song verified by me. |
| genre_alt | `string` | The genre of the song suggested by the stream platform. |
| genre_tag | `string?` | The additional descripters of the genre or media as a comma-separated string. |
| apple_music | `string?` | The comma-separated string of Apple Music API ID of the song. |
| isrc | `string?` | The comma-separated string of ISRC code of the song. |
| album_artwork | `URL?` | The URL to the artwork of the album that the song belongs to. |

*Since some of the songs were added after April 2025, the fields with suffix 2504 of these entries would be empty.*

*There are 2,625 songs in total, and 1,162 songs among them have been manually verified. 2,412 songs have Apple Music API ID attached.*

#### Source B

See [Fetching Apple Music API](../../backend/Readme.md#schema-of-playlist-json) chapter in `backend/Readme.md`. There are 2,877 songs in total.

#### Source C

*\*Not yet finished\**

## Pursuing single source of truth

To match and merge the mentioned data source while maintain the backward compatibility, a new schema is required for the new database. \
The new schema of the database has the following specifications:

### Tables - Basics

#### albums

| Field | Key | Type | Description |
| ----- | --- | ---- | ----------- |
| album_id | PRIMARY | `Integer` | The unique ID of the album. |
| album_type | | [`DBAlbum`](#dbalbum) | The type of the album. |
| artwork | | `URL?` | The URL to the album artwork image. |
| disc_count | | `Integer?` | The number of discs in the album. |
| release_date | | `Date?` | The release date of the album. |

#### artists

| Field | Key | Type | Description |
| ----- | --- | ---- | ----------- |
| artist_id | PRIMARY | `Integer` | The unique ID of the artist. |
| artist_tag | | [`DBArtistTag`](#dbartisttag) | The extra tag of the artist. |
| artwork | | `URL?` | The URL to the artist artowrk image. |

#### entries

| Field | Key | Type | Description |
| ----- | --- | ---- | ----------- |
| entry_id | PRIMARY | `Integer` | The unique ID of the entry. |
| source_id | | `Integer` | The source ID. |
| source_item_id | | `String` | The song's ID in the source. |
| raw_album | | `String` | The album of the song in the source. |
| raw_artist | | `String` | The artist of the song in the source. |
| raw_duration | | `Integer` | The duration of the song in the source. |
| raw_json | | `JSON` | The JSON metadata of the song from the source. |
| raw_title | | `String` | The title of the song in the source. |

#### songs

| Field | Key | Type | Description |
| ----- | --- | ---- | ----------- |
| song_id | PRIMARY | `Integer` | The unique ID of the song. |
| audio | | `URL?` | The URL to the preview track provided by stream platforms. |
| duration | | `Integer` | The track duration in milliseconds. |
| genre_tag | | [`DBGenreTag`](#dbgenretag) | The genre of the song. |
| genre_info | | [`DBGenreInfo`](#dbgenreinfo) | The additional info on the genre. |
| media_tag | | [`DBMediaTag`](#dbmediatag) | The additional info on the song media. |
| release_date | | `Date?` | The release date of the song. |
| vocal | | [`DBVocal`](#dbvocal) | The vocal type of the song. |

#### sources

| Field | Key | Type | Description |
| ----- | --- | ---- | ----------- |
| source_id | PRIMARY | `Integer` | The unique ID of the source (per import). |
| export_date | | `Date?` | The date when the source was exported. |
| import_date | | `Date` | The date when the source was imported. |
| source_file | | `String` | The source file path. |
| source_type | | [`DBAuthority`](#dbauthority) | The type of the source. |

### Tables - Relations

#### album_authorities

```sql
UNIQUE (authority, authority_code)
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| album_id | `Integer` | The album ID. |
| authority | [`DBAuthority`](#dbauthority) | The authority that issues the identifier. |
| authority_code | `String` | The identifier attached to the album. |

#### album_titles

```sql
UNIQUE (album_id, locale)
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| album_id | `Integer` | The album ID. |
| fallback | `Boolean` | Is this localization the fallback/primary translation? |
| locale | [`DBLocale`](#dblocale) | The language code. |
| title | `String` | The album title in the given language. |

#### album_tracks

```sql
UNIQUE (album_id, disc_number, track_number)
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| album_id | `Integer` | The album ID. |
| song_id | `Integer` | The song ID. |
| disc_number | `Integer` | The disc number of the song. |
| track_number | `Integer` | The track number of the song. |

#### album_track_counts

```sql
UNIQUE (album_id, disc_number)
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| album_id | `Integer` | The album ID. |
| disc_number | `Integer` | The disc number. |
| track_count | `Integer` | The number of tracks in the disc. |

#### artist_alias

```sql
UNIQUE (artist_id, alias)
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| artist_id | `Integer` | The artist ID. |
| alias | `String` | The alias of the artist. |

#### artist_authorities

```sql
UNIQUE (authority, authority_code)
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| artist_id | `Integer` | The artist ID. |
| authority | [`DBAuthority`](#dbauthority) | The authority that issues the identifier. |
| authority_code | `String` | The identifier attached to the artist. |

#### artist_relations

```sql
UNIQUE (artist_id, ref_artist_id, relation_to_ref)
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| artist_id | `Integer` | The artist ID. |
| ref_artist_id | `Integer` | The related artist ID. |
| relation_to_ref | [`DBRelation`](#dbrelation) | The relation of the artist to the reference artist. |

#### artist_titles

```sql
UNIQUE (artist_id, locale)
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| artist_id | `Integer` | The artist ID. |
| fallback | `Boolean` | Is this localization the fallback/primary translation? |
| locale | [`DBLocale`](#dblocale) | The language code. |
| title | `String` | The artist title in the given language. |

#### entry_mapping

```sql
UNIQUE (entry_id, song_id)
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| entry_id | `Integer` | The entry ID. |
| song_id | `Integer` | The matched song ID. |
| confidence | `Float` | The confidence of the match. |
| match_method | [`DBMethod`](#dbmethod) | The method to match the song. |
| status | [`DBStatus`](#dbstatus) | The status of this map. |

#### song_artists

| Field | Type | Description |
| ----- | ---- | ----------- |
| song_id | `Integer` | The song ID. |
| artist_id | `Integer` | The artist ID. |
| display_order | `Integer` | The display order. |
| display_title | `String?` | The title of the artist in this song. |
| role | [`DBRole`](#dbrole) | The role of the artist in the song. |

#### song_authorities

```sql
UNIQUE (authority, authority_code)
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| song_id | `Integer` | The song ID. |
| authority | [`DBAuthority`](#dbauthority) | The authority that issues the identifier. |
| authority_code | `String` | The identifier attached to the song. |

#### song_locales

*Note: this table documents the audio locale, not the localized titles.*

| Field | Type | Description |
| ----- | ---- | ----------- |
| song_id | `Integer` | The song ID. |
| is_primary | `Boolean` | Is the locale a primary language of the song? |
| locale | [`DBLocale`](#dblocale) | The language code. |

#### song_play_counts

```sql
UNIQUE (song_id, source_id, snapshot_date)
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| song_id | `Integer` | The song ID. |
| source_id | `Integer` | The source ID. |
| play_count | `Integer` | The play count of the song. |
| snapshot_date | `Date` | The snapshot date of the play count. |

#### song_titles

```sql
UNIQUE (song_id, locale)
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| song_id | `Integer` | The song ID. |
| fallback | `Boolean` | Is this localization the fallback/primary translation? |
| locale | [`DBLocale`](#dblocale) | The language code. |
| title | `String` | The song title in the given language. |

### Enums

#### DBAlbum

An 8-bit integer enum.

| Value | Display Title | Description |
| ----: | ------------- | ----------- |
| 0 | SINGLE | The single. |
| 1 | EP | The extended play. |
| 2 | ALBUM | The album. |

#### DBArtistTag

An 8-bit integer flag enum.

| Value | Display Title | Description |
| ----: | ------------- | ----------- |
| 0 | NONE | No tags attached. |
| 1 | AI | The music is AI-generated. |
| 2 | SYNTH | The vocalist is a vocal synthesizer, e.g. Hatsune Miku, Kasane Teto, Megurine Luka. |
| 4 | VTUBER | The vocalist is a vtuber. |
| 8 | | *Reserved* |

#### DBAuthority

A 8-bit integer enum.

| Value | Display Title | Description |
| ----: | ------------- | ----------- |
| 0 | ISRC | The International Standard Recording Code. |
| 1 | APPLE_MUSIC | Apple Music. |
| 2 | ITUNES | ITunes. |
| 3 | SPOTIFY | Spotify. |
| 4 | SOUNDCLOUD | Soundcloud. |
| 5 | YOUTUBE | YouTube. |
| 6 | DISCOGS | Discogs. |
| 7 | RATEYOURMUSIC | Rate Your Music. |

#### DBGenreInfo

A 8-bit integer enum.

| Value | Display Title | Description |
| ----: | ------------- | ----------- |
| 0 | NONE | No tags attached. |
| 1 | DANCE | The genre of the song is influenced by dance music. |
| 2 | POP | The genre of the song is influenced by pop music. |
| 3 | RAP | The genre of the song is influenced by rap music. |
| 4 | ROCK | The genre of the song is influenced by rock music. |

#### DBGenreTag

A 64-bit integer enum. Can be used as a flag enum if needed.

| Value | Display Title | Description |
| ----: | ------------- | ----------- |
| 0 | NONE | Undefined genre. |
| 2<sup>0</sup> | CLASSICAL | Classical music. |
| 2<sup>1</sup> | COUNTRY | Country music. |
| 2<sup>2</sup> | DANCE | Dance music. |
| 2<sup>3</sup> | HIPHOP | Hip-hop and Rap music. |
| 2<sup>4</sup> | INSTRUMENTAL | Instrumental music. |
| 2<sup>5</sup> | POP | Pop music. |
| 2<sup>6</sup> | RNB | R&B and Soul music. |
| 2<sup>7</sup> | ROCK | Rock music. |
| 2<sup>8</sup> | BASS_BUBBLEGUM | Bubblegum Bass music. |
| 2<sup>9</sup> | BASS_COLOR | Color Bass music. |
| 2<sup>10</sup> | BASS_FUTURE | Future Bass music. |
| 2<sup>11</sup> | BASS_KAWAII | Kawaii Future Bass music. |
| 2<sup>12</sup> | DOWNTEMPO | Downtempo music. |
| 2<sup>13</sup> | DRUMNBASS | Drum and Bass music. |
| 2<sup>14</sup> | DUBSTEP_BROSTEP | Brostep music. |
| 2<sup>15</sup> | DUBSTEP_CHILL | Chillstep music. |
| 2<sup>16</sup> | DUBSTEP_MELODIC | Melodic Dubstep music. |
| 2<sup>17</sup> | DUBSTEP_RIDDIM | Riddim music. |
| 2<sup>18</sup> | FUNK | Funk music. |
| 2<sup>19</sup> | GLITCHHOP | Glitch Hop music. |
| 2<sup>20</sup> | HARD_ARTCORE | Artcore music. |
| 2<sup>21</sup> | HARD_FUTURECORE | Futurecore music. |
| 2<sup>22</sup> | HARD_HAPPYCORE | Happycore music. |
| 2<sup>23</sup> | HARD_HARDCORE | Hardcore music. |
| 2<sup>24</sup> | HARD_HARDSTYLE | Hardstyle music. |
| 2<sup>25</sup> | HARD_JCORE | J-core music. |
| 2<sup>26</sup> | HOUSE_COLOR | Color House music. |
| 2<sup>27</sup> | HOUSE_COMPLEXTRO | Complextro music. |
| 2<sup>28</sup> | HOUSE_ELECTRO | Electro House music. |
| 2<sup>29</sup> | HOUSE_FUTURE | Future House music. |
| 2<sup>30</sup> | HOUSE_MELODIC | Melodic House music. |
| 2<sup>31</sup> | HOUSE_PROGRESSIVE | Progressive House music. |
| 2<sup>32</sup> | HOUSE_SLAP | Slap House music. |
| 2<sup>33</sup> | HOUSE_TROPICAL | Tropical House music. |
| 2<sup>34</sup> | JAZZ | Jazz music. |
| 2<sup>35</sup> | ROCK_METAL | Metal music. |
| 2<sup>36</sup> | ROCK_ALTERNATIVE | Alternative rock music. |
| 2<sup>37</sup> | TRANCE | Trance music. |
| 2<sup>38</sup> | TRAP | Trap music. |

*The value from 2<sup>39</sup> all the way to 2<sup>62</sup> are reserved.*

#### DBLocale

A 32-bit integer enum. Can be used as a flag enum if needed.

| Value | Display Title | Description |
| ----: | ------------- | ----------- |
| 0 | ZXX | No linguistic content; acoustic. |
| 1 | UND | Undefined language. |
| 2 | EN | English. |
| 4 | ES | Spanish. |
| 8 | FR | French. |
| 16 | HAK | Hakka, including Taiwanese Hakka. |
| 32 | HI | Hindi. |
| 64 | JA | Japanese. |
| 128 | KO | Korean. |
| 256 | MAP | Austronesian languages, including Taiwanese indigenous languages. |
| 512 | NAN | Southern Min, including Taiwanese Hokkien. |
| 1024 | TH | Thai. |
| 2048 | VI | Vietnamese. |
| 4096 | YUE | Yue, including Hong Kong Cantonese. |
| 8192 | ZH | Standard Mandarin and Taiwanese Mandarin. |
| 16384 | ZH_HANS | Simplified Chinese. |
| 32768 | ZH_HANT | Traditional Chinese. |

*The value from 65536 (2<sup>16</sup>) all the way to 2<sup>30</sup> are reserved.*

#### DBMediaTag

A 16-bit integer flag enum.

| Value | Display Title | Description |
| ----: | ------------- | ----------- |
| 0 | NONE | No tag attached. |
| 1 | ANIME | The track is featured in the anime series. |
| 2 | DRAMA | The track is featured in the Japanese TV Drama. |
| 4 | GAME | The track is featured in the video game. |
| 8 | ARCAEA | The track is featured in the rhythm game *Arcaea*. |
| 16 | CITIES | The track is featured in the simulation game series *Cities: Skylines*. |
| 32 | CYTUS | The track is featured in the rhythm game series *Cytus*. |
| 64 | DANCELINE | The track is featured in the rhythm game *Dancing Line*. |
| 128 | DEEMO | The track is featured in the rhythm game series *Deemo*. |
| 256 | FNF | The track is featured in the rhythm game *Friday Night Funkin'*. |
| 512 | LANOTA | The track is featured in the rhythm game *Lanota*. |
| 1024 | PHIGROS | The track is featured in the rhythm game *Phigros*. |
| 2048 | ROTAENO | The track is featured in the rhythm game *Rotaeno*. |
| 4096 | VOEZ | The track is featured in the rhythm game *Voez*. |
| 8192 | | *Reserved* |
| 16384 | | *Reserved* |

#### DBMethod

A 8-bit integer enum.

| Value | Display Title | Description |
| ----: | ------------- | ----------- |
| 0 | APPLE | Apple Music API ID match. |
| 1 | EXACT | Exact match. |
| 2 | FUZZY | Fuzzy match. |
| 3 | MANUAL | Manual match. |

#### DBRelation

A 8-bit integer enum.

| Value | Display Title | Description |
| ----: | ------------- | ----------- |
| 0 | NONE | Undefined role. |
| 1 | MEMBER_OF | The artist is the member of the reference artist. |

#### DBRole

A 8-bit interger enum.

| Value | Display Title | Description |
| ----: | ------------- | ----------- |
| 0 | MAIN | The artist is the main artist of the song. |
| 1 | FEAT | The artist is the featured artist of the song. |
| 2 | REMIX | The artist is the remixer of the song. |

#### DBStatus

A 8-bit integer enum.

| Value | Display Title | Description |
| ----: | ------------- | ----------- |
| 0 | PENDING | The pending entry mapping pair. |
| 1 | CONFIRMED | The confirmed entry mapping pair. |
| 2 | REJECTED | The rejected entry mapping pair. |

#### DBVocal

A 8-bit integer enum.

| Value | Display Title | Description |
| ----: | ------------- | ----------- |
| 0 | ACOUSTIC | Acoustic. |
| 1 | FEMALE | Female vocalist. |
| 2 | MALE | Male vocalist. |
| 3 | DUET | Duet (female and male) vocalist. |
| 4 | UNKNOWN | Vocal status unknown. |
