# Backend Scripts

This folder contains the scripts to automate song data collection and assist data tagging.

## Requirements

The requirements are:

* Python >= 3.10
* [beautifulsoup4](https://pypi.org/project/beautifulsoup4/) >= 4.7.0
* [Requests](https://pypi.org/project/requests/) >= 2.31.0

## Modules

### Fetching Apple Music API

**[fetch.py](.\py\fetch.py)** accesses [Apple Music API](https://developer.apple.com/documentation/applemusicapi) to collect the metadata of all tracks in a public playlist. The mandatory arguments are the playlist id (`--id`) and output JSON path (`--output`).

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
| time | `string` | The output time expressed by an ISO 8601 timestamp in local time. |
| data | `[Song]` | The playlist tracks. |

Identity object:

| Name | Type | Description |
| ---- | ---- | ----------- |
| id | `number` | The Apple Music id for the object. |
| nm | `Localization` | The object name. |
| aw | `string?` | The URL to the artwork image. |

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
| id | `number` | The Apple Music id for the song. |
| nm | `Localization` | The song name. |
| ad | `string?` | The URL to a preview audio track of the song. |
| al | `Identity?` | The album of the song. |
| at | `[Identity]` | The artist of the song. |
| aw | `string?` | The URL to the song cover artwork image. |
| dc | `number` | The disc number of the song. |
| du | `number` | The song duration in milliseconds. |
| dt | `string?` | The release date in YYYY-MM-DD format. |
| is | `string?` | The [International Standard Recording Code](https://en.wikipedia.org/wiki/International_Standard_Recording_Code) of the song. |
| lc | `string?` | The language of the song. |
| tr | `number` | The track number of the song. |
