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

*\*Not yet finished\**

## Pursuing single source of truth

To match and merge the mentioned data source while maintain the backward compatibility, a new schema is required for the new database. \
The new schema of the database has the following specifications:

### Sheets

#### Albums

| Field | Key | Type | Description |
| ----- | --- | ---- | ----------- |
| album_id | PRIMARY | `Integer` | The unique ID of the album. |
| artwork | | `URL?` | The URL to the album artwork image. |
| title | | [`DBLocalization`](#dblocalization) | The title of the album. |

#### Artists

| Field | Key | Type | Description |
| ----- | --- | ---- | ----------- |
| artist_id | PRIMARY | `Integer` | The unique ID of the artist. |
| alias | | `[String]` | The alias of the artist. |
| artwork | | `URL?` | The URL to the artist artowrk image. |
| relations | | [[`DBRelation`](#dbrelation)] | The relationship of the artist with other artists. |
| stream_id | | [`DBStream`](#dbstream) | The ID of the artist at different stream platforms. |
| tag | | [`DBArtistTag`](#dbartisttag) | The extra tag of the artist. |
| title | | [`DBLocalization`](#dblocalization) | The title of the artist. |

#### PlayCount Sheets

The play count retreived at different time are assigned to separate sheets. For instance, `PlayCount_202512` or `PlayCount_202612`.

| Field | Key | Type | Description |
| ----- | --- | ---- | ----------- |
| song_id | | `Integer` | The unique ID of the song. |
| play_count | | `Integer` | The play count of the song at that time. |

#### Songs

| Field | Key | Type | Description |
| ----- | --- | ---- | ----------- |
| song_id | PRIMARY | `Integer` | The unique ID of the song. |
| album | | `Integer` | The album ID of the song. |
| artist | | `[Integer]` | The list of artist IDs of the song. |
| audio | | `URL?` | The URL to the preview track provided by stream platforms. |
| disc_number | | `Integer?` | The disc number of the song. |
| duration | | `Integer` | The track duration in milliseconds. |
| genre | | [`DBGenre`](#dbgenre) | The genre of the song. |
| genre_tag | | [`DBGenreTag`](#dbgenretag) | The additional info on the genre. |
| isrc | | `[String]` | The list of ISRCs that should point to this release. |
| locale | | [`DBLocale`](#dblocale) | The locale of the song. |
| media_tag | | [`DBMediaTag`](#dbmediatag) | The additional info on the song media. |
| release_date | | `Date?` | The release date of the song. |
| stream_id | | [`DBStream`](#dbstream) | The ID of the song at different stream platforms. |
| stream_genre | | `String?` | The genre of the song provided by the stream platforms. |
| stream_locale | | `String?` | The language of the song provided by the stream platforms. |
| title | | [`DBLocalization`](#dblocalization) | The title of the song. |
| track_number | | `Integer?` | The track number of the song. |
| vocal | | [`DBVocal`](#dbvocal) | The vocal type of the song. |

### Structures

#### DBLocalization

A key-value pair, where its keys are [`DBLocale`](#dblocale) (single component), and values are `String`.

#### DBRelation

| Field | Type | Description |
| ----- | ---- | ----------- |
| role | [`DBRole`](#dbrole) | The role of the artist to the reference artist. |
| artist | `Integer` | The id of the reference artist. |

#### DBSource

A key-value pair, where its keys (which represent the storefronts) are `String`, and values (the item id) are `String`.

#### DBStream

| Field | Type | Description |
| ----- | ---- | ----------- |
| apple_music | `DBSource` | The Apple Music information. |

### Enums

#### DBArtistTag

An 8-bit integer flag enum.

| Value | Display Title | Description |
| ----: | ------------- | ----------- |
| 0 | NONE | No tags attached. |
| 1 | AI | The music is AI-generated. |
| 2 | SYNTH | The vocalist is a vocal synthesizer, e.g. Hatsune Miku, Kasane Teto, Megurine Luka. |
| 4 | | *Reserved* |
| 8 | | *Reserved* |

#### DBGenre

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

#### DBGenreTag

A 8-bit integer enum.

| Value | Display Title | Description |
| ----: | ------------- | ----------- |
| 0 | NONE | No tags attached. |
| 1 | DANCE | The genre of the song is influenced by dance music. |
| 2 | POP | The genre of the song is influenced by pop music. |
| 3 | RAP | The genre of the song is influenced by rap music. |
| 4 | ROCK | The genre of the song is influenced by rock music. |

#### DBLocale

A 32-bit integer enum. Can be used as a flag enum if needed.

| Value | Display Title | Description |
| ----: | ------------- | ----------- |
| 0 | ZXX | No linguistic content; acoustic. |
| 1 | EN | English. |
| 2 | ES | Spanish. |
| 4 | FR | French. |
| 8 | HAK | Hakka, including Taiwanese Hakka. |
| 16 | JA | Japanese. |
| 32 | KO | Korean. |
| 64 | HI | Hindi. |
| 128 | MAP | Austronesian languages, including Taiwanese indigenous languages. |
| 256 | NAN | Southern Min, including Taiwanese Hokkien. |
| 512 | TH | Thai. |
| 1024 | VI | Vietnamese. |
| 2048 | YUE | Yue, including Hong Kong Cantonese. |
| 4096 | ZH | Standard Mandarin and Taiwanese Mandarin. |
| 1073741824 | UND | Undefined language. |

*The value from 8192 (2<sup>13</sup>) all the way to 536870912 (2<sup>29</sup>) are reserved.*

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
| 128 | LANOTA | The track is featured in the rhythm game *Lanota*. |
| 256 | PHIGROS | The track is featured in the rhythm game *Phigros*. |
| 512 | ROTAENO | The track is featured in the rhythm game *Rotaeno*. |
| 1024 | VOEZ | The track is featured in the rhythm game *Voez*. |
| 2048 | | *Reserved* |
| 4096 | | *Reserved* |
| 8192 | | *Reserved* |
| 16384 | | *Reserved* |

#### DBRole

A 8-bit integer enum.

| Value | Display Title | Description |
| ----: | ------------- | ----------- |
| 0 | NONE | Undefined role. |
| 1 | MEMBER | The reference artist is a member of the artist. |
| 2 | MEMBER_OF | The artist is the member of the reference artist. |

#### DBVocal

A 8-bit integer enum.

| Value | Display Title | Description |
| ----: | ------------- | ----------- |
| 0 | A | Acoustic. |
| 1 | F | Female vocalist. |
| 2 | M | Male vocalist. |
| 3 | X | Duat vocalist. |
