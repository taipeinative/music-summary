from __future__ import annotations

import argparse
from pathlib import Path
import unicodedata

from AppleMusic import XMLSource
import pandas as pd

HERE = Path().absolute()

def is_track_added_in_2025(row: pd.Series) -> bool:
    return (
        (row['release_date'] > pd.Timestamp('2024-12-31')) or
        (not row['library'] and (row['modified_date'] > pd.Timestamp('2024-12-31'))) or
        (row['library'] and (row['added_date'] > pd.Timestamp('2024-12-31')))
    )

def join_paths(path_1: Path, path_2: Path) -> Path:
    if path_2.is_absolute():
        return path_2
    else:
        return path_1 / path_2

def remove_duplicates(arr: list) -> str | None:
    new_arr = [x for x in set(arr) if not pd.isna(x)]
    if not new_arr:
        return None

    return ', '.join(map(str, sorted(new_arr)))

def sanitize_strings(text):
    if text is None:
        return None
    
    if not isinstance(text, str):
        return text

    # Control characters: Cc; Format characters: Cf
    sanitized = ''.join([x for x in text if not unicodedata.category(x).startswith('C')])
    return sanitized

def try_merge(left: pd.DataFrame, right: pd.DataFrame, merge_steps: list[dict[str, list[str]]]) -> pd.DataFrame:
    left = left.reset_index().rename(columns={'index': 'left_idx'})
    right = right.reset_index().rename(columns={'index': 'right_idx'})

    remaining_left = left.copy()
    remaining_right = right.copy()

    results = []

    for i, step in enumerate(merge_steps):
        left_on = step.get('left_on')
        right_on = step.get('right_on')
        require_unique = step.get('require_unique', False)
        normalize_case = step.get('normalize_case', False)

        left_subset = remaining_left.copy()
        right_subset = remaining_right.copy()

        if normalize_case:
            left_keys = []
            right_keys = []

            for j, (lcol, rcol) in enumerate(zip(left_on, right_on)):   # type: ignore
                lkey = f'__norm_l_{i}_{j}'
                rkey = f'__norm_r_{i}_{j}'

                left_subset[lkey] = left_subset[lcol].astype(str).str.lower()
                right_subset[rkey] = right_subset[rcol].astype(str).str.lower()

                left_keys.append(lkey)
                right_keys.append(rkey)
        else:
            left_keys = left_on
            right_keys = right_on

        if require_unique:
            left_counts = left_subset.groupby(left_keys).size()
            unique_left_keys = left_counts[left_counts == 1].index

            right_counts = right_subset.groupby(right_keys).size()
            unique_right_keys = right_counts[right_counts == 1].index

            left_subset = left_subset[
                left_subset.set_index(left_keys).index.isin(unique_left_keys)
            ]
            right_subset = right_subset[
                right_subset.set_index(right_keys).index.isin(unique_right_keys)
            ]

        merged = left_subset.merge(
            right_subset,
            how='inner',
            left_on=left_keys,
            right_on=right_keys,
            suffixes=('', '_r')
        )

        if merged.empty:
            continue

        merged['merge_status'] = 'both'
        merged['match_rule'] = f"step_{i+1}"

        # Drop temporary columns if used
        if normalize_case:
            merged = merged.drop(columns=left_keys + right_keys, errors='ignore')   # type: ignore

        results.append(merged)

        # Remove matched rows
        remaining_left = remaining_left[
            ~remaining_left['left_idx'].isin(merged['left_idx'])
        ]
        remaining_right = remaining_right[
            ~remaining_right['right_idx'].isin(merged['right_idx'])
        ]

        if remaining_left.empty:
            break

    # Left only
    if not remaining_left.empty:
        left_only = remaining_left.copy()
        left_only['merge_status'] = 'left_only'
        results.append(left_only)

    # Right only
    if not remaining_right.empty:
        right_only = remaining_right.copy()
        right_only['merge_status'] = 'right_only'
        results.append(right_only)

    final = pd.concat(results, ignore_index=True, sort=False)
    return final

def main(manual_path: Path, tmm_path: Path, xlsx_2512_path: Path,
         xml_2504_path: Path, xml_2512_path: Path, output_path: Path):
    DUPLICATE_COLUMNS = ['left_idx', 'right_idx', 'merge_status', 'match_rule']

    # -- Step 1 --
    # Merge the library XML file (2025-12-26) and the library Excel file (2025-12-30)

    step_1_criteria = [
        {'left_on': ['id 1'], 'right_on': ['id 2'], 'require_unique': True},
    ]

    xlsx_2512_renamer = {
        'Track ID': 'id 1',
        'Vocal': 'vocal',
        'Language': 'locale',
        'Sub Genres': 'genre',
        'Sub Tag 1': 'media_a',
        'Sub Tag 2': 'media_b',
        'Sub Tag 3': 'media_c',
        'Name': 'name 1',
        'Artist': 'artist 1',
        'Album': 'album 1',
        'Genre': 'stream_genre 1',
        'Year': 'year 1',
        'Play Count': 'play_count_2512 1',
        'Disc Number': 'disc_number 1',
        'Track Number': 'track_number 1',
        'ISRC': 'isrc 1',
        'Apple ID': 'apple_music 1'
    }

    xml_2512_renamer = {
        'id': 'id 2',
        'name': 'name 2',
        'added_date': 'added_date 2',
        'album': 'album 2',
        'album_artist': 'album_artist 2',
        'artist': 'artist 2',
        'disc_number': 'disc_number 2',
        'duration': 'duration 2',
        'genre': 'stream_genre 2',
        'modified_date': 'modified_date 2',
        'play_count': 'play_count_2512 2',
        'release_date': 'release_date 2',
        'track_number': 'track_number 2'
    }

    xlsx_2512 = pd.read_excel(xlsx_2512_path, sheet_name = '2').rename(columns = xlsx_2512_renamer)
    xml = XMLSource.load(xml_2512_path, ['Temporary Loops'])
    xml_2512 = xml.songs.rename(columns = xml_2512_renamer)
    xml_2512['temp_playlist'] = xml.is_in_playlist('Temporary Loops')
    step_1_output = try_merge(xlsx_2512, xml_2512, step_1_criteria).drop(
        columns = DUPLICATE_COLUMNS + ['Composer', 'Date Added', 'Date Modified', 'Size', 'Total Time', 'Tags']
    )

    # Result: Both=2562, Left=3, Right=64 --> 2629

    # -- Step 2 --
    # Merge the CSV file (2025-12-06) exported on TuneMyMusic.

    step_2_criteria = [
        {'left_on': ['name 2', 'artist 2', 'album 2'], 'right_on': ['name 3', 'artist 3', 'album 3']},          #  1
        {'left_on': ['name 2', 'artist 2', 'album 1'], 'right_on': ['name 3', 'artist 3', 'album 3']},          #  2
        {'left_on': ['name 2', 'artist 1', 'album 1'], 'right_on': ['name 3', 'artist 3', 'album 3']},          #  3
        {'left_on': ['name 1', 'artist 1', 'album 1'], 'right_on': ['name 3', 'artist 3', 'album 3']},          #  4
        {'left_on': ['name 1', 'artist 2', 'album 2'], 'right_on': ['name 3', 'artist 3', 'album 3']},          #  5
        {'left_on': ['name 2', 'artist 2'], 'right_on': ['name 3', 'artist 3']},                                #  6
        {'left_on': ['name 1', 'artist 2'], 'right_on': ['name 3', 'artist 3']},                                #  7
        {'left_on': ['name 2'], 'right_on': ['name 3'], 'require_unique': True},                                #  8
        {'left_on': ['name 1'], 'right_on': ['name 3'], 'require_unique': True},                                #  9
        {'left_on': ['artist 2'], 'right_on': ['artist 3'], 'require_unique': True},                            # 10
        {'left_on': ['artist 1'], 'right_on': ['artist 3'], 'require_unique': True},                            # 11
        {'left_on': ['album 2'], 'right_on': ['album 3'], 'require_unique': True},                              # 12
        {'left_on': ['album 1'], 'right_on': ['album 3'], 'require_unique': True},                              # 13
        {'left_on': ['artist 2'], 'right_on': ['artist 3'], 'require_unique': True},                            # 14
        {'left_on': ['name 2'], 'right_on': ['name 3'], 'require_unique': True, 'normalize_case': True},        # 15
        {'left_on': ['artist 2'], 'right_on': ['artist 3'], 'require_unique': True, 'normalize_case': True},    # 16
        {'left_on': ['album 2'], 'right_on': ['album 3'], 'require_unique': True, 'normalize_case': True},      # 17
    ]

    tmm_renamer = {
        'Track name': 'name 3',
        'Artist name': 'artist 3',
        'Album': 'album 3',
        'ISRC': 'isrc 3',
        'Apple - id': 'apple_music 3'
    }

    tmm = pd.read_csv(tmm_path).rename(columns = tmm_renamer)
    step_2_output = try_merge(step_1_output, tmm, step_2_criteria)
    step_2_output = step_2_output[step_2_output['merge_status'] != 'right_only'].drop(
        columns = DUPLICATE_COLUMNS + ['Playlist name', 'Type']
    ).copy()

    # Result: Both=2304, Left=325, Right=52 --> 2629 [discard right_only]

    # -- Step 3 --
    # Merge the manually edited CSV file (2026-04-07).

    step_3_criteria = [
        {'left_on': ['isrc 1'], 'right_on': ['isrc 4'], 'require_unique': True},    # 1
        {'left_on': ['name 1', 'artist 1'], 'right_on': ['name 4', 'artist 4']},    # 2
        {'left_on': ['name 1', 'artist 2'], 'right_on': ['name 4', 'artist 4']},    # 3
        {'left_on': ['name 1'], 'right_on': ['name 4'], 'require_unique': True},    # 4
    ]

    manual_renamer = {
        'Name': 'name 4',
        'Artist': 'artist 4',
        'Artist ID': 'artist_id',
        'Year': 'year 4',
        'Play Count 1': 'play_count_2512 4',
        'Play Count 2': 'play_count_25',
        'Apple ID': 'apple_music 4',
        'ISRC': 'isrc 4',
        'Thumbnail': 'album_artwork'
    }

    step_3_display_order = [
        'id 1', 'id 2', 'name 1', 'name 2', 'name 3', 'name 4', 'added_date 2', 'modified_date 2',
        'artist 1', 'artist 2', 'artist 3', 'artist 4', 'artist_id', 'album 1', 'album 2',
        'album 3', 'album_artist 2', 'disc_number 1', 'disc_number 2', 'disc_count', 'track_number 1',
        'track_number 2', 'track_count', 'duration 2', 'genre', 'stream_genre 1',
        'stream_genre 2', 'media_a', 'media_b', 'media_c', 'release_date 2', 'year 1',
        'year 4', 'play_count_2512 1', 'play_count_2512 2', 'play_count_2512 4',
        'play_count_25', 'apple_music 1', 'apple_music 3', 'apple_music 4', 'isrc 1',
        'isrc 3', 'isrc 4', 'vocal', 'locale', 'album_artwork', 'temp_playlist'
    ]

    manual = pd.read_csv(manual_path).rename(columns = manual_renamer)
    step_3_output = try_merge(step_2_output, manual, step_3_criteria).drop(
        columns = DUPLICATE_COLUMNS + ['Duration', 'Vocal', 'Language', 'Genre', 'Tag 1', 'Tag 2', 'Tag 3']
    )[step_3_display_order]

    # Result: Both=1081, Left=1548 --> 2629

    # -- Step 4 --
    # Merge the the library XML file (2025-04-15).

    xml_2504_renamer = {
        'id': 'id 5',
        'name': 'name 5',
        'added_date': 'added_date 5',
        'album': 'album 5',
        'album_artist': 'album_artist 5',
        'artist': 'artist 5',
        'disc_number': 'disc_number 5',
        'duration': 'duration 5',
        'genre': 'stream_genre 5',
        'modified_date': 'modified_date 5',
        'play_count': 'play_count_2504',
        'release_date': 'release_date 5',
        'track_number': 'track_number 5'
    }

    step_4_criteria = [
        {'left_on': ['name 1', 'artist 1', 'album 1'], 'right_on': ['name 5', 'artist 5', 'album 5']},      #  1
        {'left_on': ['name 1', 'artist 2', 'album 1'], 'right_on': ['name 5', 'artist 5', 'album 5']},      #  2
        {'left_on': ['name 2', 'artist 1', 'album 1'], 'right_on': ['name 5', 'artist 5', 'album 5']},      #  3
        {'left_on': ['name 2', 'artist 2', 'album 1'], 'right_on': ['name 5', 'artist 5', 'album 5']},      #  4
        {'left_on': ['name 1', 'artist 2', 'album 2'], 'right_on': ['name 5', 'artist 5', 'album 5']},      #  5
        {'left_on': ['name 2', 'artist 2', 'album 2'], 'right_on': ['name 5', 'artist 5', 'album 5']},      #  6
        {'left_on': ['name 1', 'artist 3', 'album 1'], 'right_on': ['name 5', 'artist 5', 'album 5']},      #  7
        {'left_on': ['name 1', 'artist 3', 'album 2'], 'right_on': ['name 5', 'artist 5', 'album 5']},      #  8
        {'left_on': ['name 3', 'artist 1', 'album 1'], 'right_on': ['name 5', 'artist 5', 'album 5']},      #  9
        {'left_on': ['name 3', 'artist 2', 'album 1'], 'right_on': ['name 5', 'artist 5', 'album 5']},      # 10
        {'left_on': ['name 3', 'artist 2'], 'right_on': ['name 5', 'artist 5']},                            # 11
        {'left_on': ['name 2', 'artist 3'], 'right_on': ['name 5', 'artist 5']},                            # 12
        {'left_on': ['name 3', 'artist 3'], 'right_on': ['name 5', 'artist 5']},                            # 13
        {'left_on': ['name 1', 'album 1'], 'right_on': ['name 5', 'album 5']},                              # 14
        {'left_on': ['name 2', 'album 1'], 'right_on': ['name 5', 'album 5']},                              # 15
        {'left_on': ['album 1', 'artist 1'], 'right_on': ['album 5', 'artist 5']},                          # 16
        {'left_on': ['album 1', 'artist 2'], 'right_on': ['album 5', 'artist 5']},                          # 17
        {'left_on': ['album 2', 'artist 2'], 'right_on': ['album 5', 'artist 5']},                          # 18
        {'left_on': ['artist 2'], 'right_on': ['artist 5'], 'require_unique': True},                        # 19
        {'left_on': ['artist 3'], 'right_on': ['artist 5'], 'require_unique': True},                        # 20
        {'left_on': ['duration 2'], 'right_on': ['duration 5'], 'require_unique': True},                    # 21
    ]

    step_4_display_order = [
        'id 1', 'id 2', 'id 5', 'name 1', 'name 2', 'name 3', 'name 4', 'name 5',
        'artist 1', 'artist 2', 'artist 3', 'artist 4', 'artist 5', 'artist_id',
        'album 1', 'album 2', 'album 3', 'album 5', 'album_artist 2', 'album_artist 5',
        'disc_number 1', 'disc_number 2', 'disc_number 5', 'disc_count', 'track_number 1',
        'track_number 2', 'track_number 5', 'track_count', 'duration 2', 'duration 5', 'genre',
        'stream_genre 1', 'stream_genre 2', 'stream_genre 5', 'media_a', 'media_b', 'media_c',
        'added_date 2', 'added_date 5', 'modified_date 2', 'modified_date 5', 'release_date 2',
        'release_date 5', 'year 1', 'year 4', 'play_count_2504', 'play_count_2512 1', 'play_count_2512 2',
        'play_count_2512 4', 'play_count_25', 'apple_music 1', 'apple_music 3', 'apple_music 4',
        'isrc 1', 'isrc 3', 'isrc 4', 'vocal', 'locale', 'album_artwork', 'temp_playlist'
    ]

    xml_2504 = XMLSource.load(xml_2504_path, ['Temporary Loops']).songs.rename(columns = xml_2504_renamer).drop(columns = ['track_count', 'disc_count'])
    step_4_output = try_merge(step_3_output, xml_2504, step_4_criteria)
    step_4_output = step_4_output[step_4_output['merge_status'] != 'right_only'].drop(
        columns = DUPLICATE_COLUMNS
    )[step_4_display_order].copy()

    # Result: Both=2401, Left=228, Right=2 --> 2629 [discard right_only]

    step_4_integer_columns = [
        'id 1', 'id 2', 'id 5', 'disc_number 1', 'disc_number 2', 'disc_number 5', 'disc_count',
        'track_number 1', 'track_number 2', 'track_number 5', 'track_count', 'duration 2', 'duration 5',
        'year 1', 'year 4', 'play_count_2504', 'play_count_2512 1', 'play_count_2512 2', 'play_count_2512 4',
        'play_count_25', 'apple_music 1', 'apple_music 3', 'apple_music 4'
    ]

    step_4_string_columns = [
        'name 1', 'name 2', 'name 3', 'name 4', 'name 5', 'artist 1', 'artist 2', 'artist 3', 'artist 4', 'artist 5',
        'album 1', 'album 2', 'album 3', 'album 5', 'album_artist 2', 'album_artist 5', 'genre', 'stream_genre 1',
        'stream_genre 2', 'stream_genre 5', 'media_a', 'media_b', 'media_c', 'isrc 1', 'isrc 3', 'isrc 4', 'vocal',
        'locale', 'album_artwork'
    ]

    step_4_output[step_4_integer_columns] = step_4_output[step_4_integer_columns].astype('Int64')
    step_4_output[step_4_string_columns] = step_4_output[step_4_string_columns].stack().apply(sanitize_strings).unstack()   # type: ignore

    # -- Step 5 --
    # Reorganize the data.

    candidate = pd.DataFrame(index = step_4_output.index)
    candidate['id 2504'] = step_4_output['id 5']
    candidate['id 2512'] = step_4_output['id 1'].combine_first(step_4_output['id 2'])
    candidate['verified'] = ~pd.isna(step_4_output['name 4'])
    candidate['library'] = step_4_output['temp_playlist'].apply(lambda x: not x if isinstance(x, bool) else False)
    candidate['name 2504'] = step_4_output['name 5']
    candidate['name 2512'] = step_4_output['name 4'].combine_first(step_4_output['name 1']).combine_first(step_4_output['name 2'])
    candidate['artist'] = step_4_output['artist_id'].str.rstrip(',')
    candidate['artist_label'] = step_4_output['artist 4'].str.rstrip(',')
    candidate['artist_primary 2504'] = step_4_output['artist 5'] 
    candidate['artist_primary 2512'] = step_4_output['artist 2'].combine_first(step_4_output['artist 1'])
    candidate['album 2504'] = step_4_output['album 5']
    candidate['album 2512'] = step_4_output['album 1'].combine_first(step_4_output['album 2'])
    candidate['album_artist'] = step_4_output['album_artist 2'].combine_first(step_4_output['album_artist 5'])
    candidate['play_count 2504'] = step_4_output['play_count_2504'].fillna(0)
    candidate['play_count 2512'] = step_4_output['play_count_2512 2'].combine_first(candidate['play_count 2504'])
    candidate['play_count_deducted'] = candidate.apply(lambda x: x['play_count 2504'] - x['play_count 2512'] if x['play_count 2512'] < x['play_count 2504'] else 0, axis = 1)
    candidate['disc_number'] = step_4_output['disc_number 2'].combine_first(step_4_output['disc_number 1']).combine_first(step_4_output['disc_number 5'])
    candidate['disc_count'] = step_4_output['disc_count']
    candidate['track_number'] = step_4_output['track_number 2'].combine_first(step_4_output['track_number 1']).combine_first(step_4_output['track_number 5'])
    candidate['track_count'] = step_4_output['track_count']
    candidate['duration'] = step_4_output['duration 2']
    candidate['release_date'] = step_4_output['release_date 2']
    candidate['added_date'] = step_4_output['added_date 2'].combine_first(step_4_output['added_date 5'])
    candidate['modified_date'] = step_4_output['modified_date 2'].combine_first(step_4_output['modified_date 5'])
    candidate['vocal'] = step_4_output['vocal']
    candidate['locale'] = step_4_output['locale']
    candidate['genre'] = step_4_output['genre']
    candidate['genre_alt'] = step_4_output['stream_genre 2']
    candidate['genre_tag'] = step_4_output.apply(lambda x: ', '.join([y for y in [x['media_a'], x['media_b'], x['media_c']] if not pd.isna(y)]), axis = 1)
    candidate['apple_music'] = step_4_output.apply(lambda x: remove_duplicates([x['apple_music 3'], x['apple_music 4']]), axis = 1)
    candidate['isrc'] = step_4_output.apply(lambda x: remove_duplicates([x['isrc 3'], x['isrc 4']]), axis = 1)
    candidate['album_artwork'] = step_4_output['album_artwork']
    candidate['sort_key'] = candidate[['added_date', 'modified_date']].min(axis = 1)
    candidate.insert(16, 'is_2025_track', candidate.apply(lambda x: is_track_added_in_2025(x), axis = 1))
    candidate.insert(17, 'play_count_2025', candidate.apply(lambda x: x['play_count 2512'] if x['is_2025_track'] else abs(x['play_count 2512'] - x['play_count 2504']), axis = 1))

    candidate = candidate.sort_values(['sort_key', 'name 2512'], ascending = True).drop(columns = ['is_2025_track', 'sort_key']).reset_index(drop = True)
    candidate.insert(0, 'legacy_id', candidate.index)
    candidate.to_csv(output_path, index = False, encoding = 'utf-8')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description = 'Clean up and combine the files in the previous project.')
    parser.add_argument('--manual',   required = True, help = 'The edited, verified CSV file from April 2026.')
    parser.add_argument('--tmm',      required = True, help = 'The CSV file exported from Tune My Music from December 2025.')
    parser.add_argument('--xlsx2512', required = True, help = 'The edited Microsoft Excel file from December 2025.')
    parser.add_argument('--xml2504',  required = True, help = 'The XML file exported from iTunes in April 2025.')
    parser.add_argument('--xml2512',  required = True, help = 'The XML file exported from iTunes in December 2025.')
    parser.add_argument('--output',   required = True, help = 'The output path of the result CSV file.')

    args = parser.parse_args()

    manual_path    = join_paths(HERE, Path(args.manual))
    tmm_path       = join_paths(HERE, Path(args.tmm))
    xlsx_2512_path = join_paths(HERE, Path(args.xlsx2512))
    xml_2504_path  = join_paths(HERE, Path(args.xml2504))
    xml_2512_path  = join_paths(HERE, Path(args.xml2512))
    output_path    = join_paths(HERE, Path(args.output))

    main(manual_path, tmm_path, xlsx_2512_path, xml_2504_path, xml_2512_path, output_path)
