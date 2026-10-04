from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from difflib import SequenceMatcher
import json
from typing import Any, Iterable, Literal, Mapping

from music_db.normalize import extract_guest_credit_names, normalize_artist, normalize_core_title, normalize_title, parse_artists
from music_db.query import (
    get_artist_ids_by_authorities,
    get_artist_ids_by_normalized_names,
    get_canonical_song_data,
    get_confirmed_entry_mapping,
    get_entry_mapping,
    get_pending_entry_group_by_entry_ids,
    get_song_ids_by_authority,
    get_song_ids_by_duration_window,
    get_song_ids_by_title_and_duration,
    get_source_entries,
    get_source_type,
    get_unreviewed_legacy_entry_ids,
)
from music_db.schema import (
    CHANGE_LOG_TABLE,
    ENTRY_GROUP_ENTRIES_TABLE,
    ENTRY_GROUP_ISSUES_TABLE,
    ENTRY_GROUP_TABLE,
    ENTRY_ISSUES_TABLE,
    ENTRY_MAPPING_TABLE,
    create,
)
from music_db.typing import DBAuthority, DBGroupStatus, DBLocale, DBMethod, DBStatus, Issue, IssueReason
import psycopg
from psycopg.types.json import Jsonb

DURATION_TOLERANCE_MS = 2_000
DEFAULT_FUZZY_LIMIT = 5
DEFAULT_MIN_FUZZY_CONFIDENCE = 0.82
MATCHER_NAME = 'music_db.matching'

@dataclass(frozen = True)
class ArtistCompatibility:
    level: Literal['exact', 'subset_credit', 'subset', 'partial', 'name_match', 'none']
    missing_artist_ids: tuple[int, ...] = ()
    extra_artist_ids: tuple[int, ...] = ()

    @property
    def auto_confirmable(self) -> bool:
        return self.level in {'exact', 'subset_credit'}

    @property
    def compatible(self) -> bool:
        return self.level != 'none'

    @property
    def conflict(self) -> bool:
        return self.level == 'partial'

    @property
    def confidence_factor(self) -> float:
        if self.level == 'exact':
            return 1.0
        if self.level == 'subset_credit':
            return 0.95
        if self.level == 'subset':
            return 0.82
        if self.level == 'name_match':
            return 0.72
        if self.level == 'partial':
            return 0.55
        return 0.0

@dataclass(frozen = True)
class ArtistResolution:
    authority_ids: tuple[str, ...]
    artist_ids: tuple[int, ...]
    name_matched_artist_ids: tuple[int, ...]
    normalized_names: tuple[str, ...]

@dataclass(frozen = True)
class CanonicalSong:
    song_id: int
    duration: int
    titles: tuple[LocalizedTitle, ...] = ()
    artist_ids: tuple[int, ...] = ()
    artist_names: tuple[str, ...] = ()

    @property
    def best_title(self) -> str | None:
        if not self.titles:
            return None
        preferred = sorted(self.titles, key = lambda t: (not t.fallback, t.locale))
        return preferred[0].title

    @property
    def normalized_core_titles(self) -> set[str]:
        return {title.normalized_core_title for title in self.titles if title.title}

@dataclass
class EntryMatchResult:
    entry: SourceEntry
    mappings: list[MappingPlan] = field(default_factory = list)
    issues: list[Issue] = field(default_factory = list)
    unreviewed_entry_ids: list[int] = field(default_factory = list)

    @property
    def has_candidate(self) -> bool:
        return bool(self.mappings)

@dataclass(frozen = True)
class LocalizedTitle:
    title: str
    normalized_title: str
    locale: int
    fallback: bool

    @property
    def normalized_core_title(self) -> str:
        return normalize_core_title(self.title)

@dataclass(frozen = True)
class MappingPlan:
    entry_id: int
    song_id: int
    confidence: float
    match_method: DBMethod
    status: DBStatus

    def key(self) -> tuple[int, int]:
        return self.entry_id, self.song_id

@dataclass
class MatchSummary:
    source_id: int
    dry_run: bool
    total_entries: int = 0
    apple_confirmed: int = 0
    isrc_confirmed: int = 0
    exact_confirmed: int = 0
    pending_mappings: int = 0
    fuzzy_candidates: int = 0
    authority_conflicts: int = 0
    artist_conflicts: int = 0
    title_conflicts: int = 0
    duration_conflicts: int = 0
    multiple_candidates: int = 0
    no_candidates: int = 0
    unreviewed_entry_matches: int = 0
    new_song_groups: list[NewSongGroup] = field(default_factory = list)
    mappings: list[MappingPlan] = field(default_factory = list)
    issues: list[Issue] = field(default_factory = list)

    @property
    def confirmed_mappings(self) -> int:
        return sum(1 for mapping in self.mappings if mapping.status == DBStatus.CONFIRMED)

    def to_dict(self, include_details: bool = False) -> dict[str, Any]:
        result: dict[str, Any] = {
            'source_id': self.source_id,
            'dry_run': self.dry_run,
            'total_entries': self.total_entries,
            'apple_confirmed': self.apple_confirmed,
            'isrc_confirmed': self.isrc_confirmed,
            'exact_confirmed': self.exact_confirmed,
            'confirmed_mappings': self.confirmed_mappings,
            'pending_mappings': self.pending_mappings,
            'fuzzy_candidates': self.fuzzy_candidates,
            'authority_conflicts': self.authority_conflicts,
            'artist_conflicts': self.artist_conflicts,
            'title_conflicts': self.title_conflicts,
            'duration_conflicts': self.duration_conflicts,
            'multiple_candidates': self.multiple_candidates,
            'no_candidates': self.no_candidates,
            'unreviewed_entry_matches': self.unreviewed_entry_matches,
            'new_song_groups': len(self.new_song_groups),
            'planned_issues': len(self.issues),
        }
        if include_details:
            result['mappings'] = [
                {
                    'entry_id': mapping.entry_id,
                    'song_id': mapping.song_id,
                    'confidence': mapping.confidence,
                    'match_method': mapping.match_method.name,
                    'status': mapping.status.name,
                }
                for mapping in self.mappings
            ]
            result['issues'] = [issue.to_json() for issue in self.issues]
            result['groups'] = [
                {
                    'group_id': group.group_id,
                    'entry_ids': list(group.entry_ids),
                    'unreviewed_entry_ids': list(group.unreviewed_entry_ids),
                    'issue_ids': list(group.issue_ids),
                    'isrcs': list(group.isrcs),
                    'normalized_core_titles': list(group.normalized_core_titles),
                    'min_duration_ms': group.min_duration_ms,
                    'max_duration_ms': group.max_duration_ms,
                }
                for group in self.new_song_groups
            ]
        return result

@dataclass(frozen = True)
class NewSongGroup:
    entry_ids: tuple[int, ...]
    group_id: int | None = None
    unreviewed_entry_ids: tuple[int, ...] = ()
    issue_ids: tuple[int, ...] = ()
    isrcs: tuple[str, ...] = ()
    normalized_core_titles: tuple[str, ...] = ()
    min_duration_ms: int | None = None
    max_duration_ms: int | None = None

@dataclass(frozen = True)
class SourceEntry:
    entry_id: int
    source_id: int
    source_item_id: int
    normalized_album: str
    normalized_artist: str
    normalized_title: str
    raw_album: str
    raw_artist: str
    raw_duration: int
    raw_json: dict[str, Any]
    raw_title: str
    source_type: int

    @property
    def apple_music_id(self) -> str | None:
        return _get_non_empty_string(self.song.get('id'))

    @property
    def isrc(self) -> str | None:
        return _get_non_empty_string(self.song.get('isrc'))

    @property
    def normalized_artist_parts(self) -> set[str]:
        return {
            name
            for name in parse_artists(self.raw_artist, normalize = True)
            if name
        }

    @property
    def normalized_core_title(self) -> str:
        return normalize_core_title(self.raw_title)

    @property
    def song(self) -> dict[str, Any]:
        songs = self.raw_json.get('songs')
        if isinstance(songs, list) and len(songs) == 1 and isinstance(songs[0], dict):
            return songs[0]
        return {}

    @property
    def source_artist_authority_ids(self) -> tuple[str, ...]:
        artist_ids = self.song.get('artistID')
        if not isinstance(artist_ids, list):
            return ()
        return tuple(str(artist_id) for artist_id in artist_ids if _get_non_empty_string(artist_id))

    @property
    def title_credit_names(self) -> tuple[str, ...]:
        return tuple(extract_guest_credit_names(self.raw_title))

def _apply_mapping_plan(connection: psycopg.Connection, mapping: MappingPlan) -> None:
    if mapping.status == DBStatus.CONFIRMED:
        existing_confirmed = get_confirmed_entry_mapping(connection, mapping.entry_id)
        if existing_confirmed is not None and existing_confirmed != mapping.song_id:
            return

        entries = _load_source_entries_by_ids(connection, [mapping.entry_id])
        _merge_entries_metadata_into_song(
            connection,
            mapping.song_id,
            entries,
            changed_by = MATCHER_NAME,
            reason = 'automatic matching metadata merge',
        )

    _upsert_mapping_with_log(connection, mapping, changed_by = MATCHER_NAME, reason = 'automatic matching')

def _build_candidate_conflict_issues(
    entry: SourceEntry,
    candidate: CanonicalSong,
    artist_resolution: ArtistResolution,
    match_method: DBMethod,
    *,
    authority_matched: bool,
) -> list[Issue]:
    issues: list[Issue] = []
    if entry.normalized_core_title and entry.normalized_core_title not in candidate.normalized_core_titles:
        issues.append(
            Issue.create_title_conflict(
                entry_id = entry.entry_id,
                song_id = candidate.song_id,
                match_method = match_method,
                incoming_title = entry.raw_title,
                candidate_title = candidate.best_title,
                normalized_incoming_title = entry.normalized_core_title,
                normalized_candidate_title = normalize_core_title(candidate.best_title),
            )
        )

    duration_difference = abs(entry.raw_duration - candidate.duration)
    if duration_difference > DURATION_TOLERANCE_MS:
        issues.append(
            Issue.create_duration_mismatch(
                entry_id = entry.entry_id,
                song_id = candidate.song_id,
                match_method = match_method,
                incoming_duration_ms = entry.raw_duration,
                candidate_duration_ms = candidate.duration,
                tolerance_ms = DURATION_TOLERANCE_MS,
            )
        )

    compatibility = _check_artist_compatibility(entry, candidate, artist_resolution, authority_matched = authority_matched)
    if compatibility.conflict or (authority_matched and compatibility.level == 'none'):
        issues.append(
            Issue.create_artist_conflict(
                entry_id = entry.entry_id,
                song_id = candidate.song_id,
                match_method = match_method,
                incoming_artist_ids = list(entry.source_artist_authority_ids),
                candidate_artist_ids = list(candidate.artist_ids),
                missing_artist_ids = list(compatibility.missing_artist_ids),
                extra_artist_ids = list(compatibility.extra_artist_ids),
                authority_matched = authority_matched,
            )
        )

    return issues

def _build_entry_group_details(group: NewSongGroup) -> dict[str, Any]:
    details: dict[str, Any] = {
        'entry_ids': list(group.entry_ids),
        'unreviewed_entry_ids': list(group.unreviewed_entry_ids),
        'isrcs': list(group.isrcs),
        'normalized_core_titles': list(group.normalized_core_titles),
        'min_duration_ms': group.min_duration_ms,
        'max_duration_ms': group.max_duration_ms,
    }

    if group.min_duration_ms is not None and group.max_duration_ms is not None:
        details['duration_difference_ms'] = group.max_duration_ms - group.min_duration_ms

    methods: list[str] = []
    if group.isrcs:
        methods.append('ISRC')
    if len(group.entry_ids) > 1 or group.unreviewed_entry_ids:
        methods.append('EXACT_METADATA')
    if methods:
        details['methods'] = methods

    return details

def _build_entry_pair_conflict_issues(entry: SourceEntry, candidate: SourceEntry) -> list[Issue]:
    issues: list[Issue] = []
    if entry.normalized_core_title != candidate.normalized_core_title:
        issues.append(
            Issue.create_title_conflict(
                entry_id = entry.entry_id,
                match_method = DBMethod.EXACT,
                incoming_title = entry.raw_title,
                candidate_title = candidate.raw_title,
                normalized_incoming_title = entry.normalized_core_title,
                normalized_candidate_title = candidate.normalized_core_title,
                extra_details = {
                    'candidate_entry_id': candidate.entry_id,
                    'authority_type': DBAuthority.ISRC.name,
                    'authority_code': entry.isrc,
                },
            )
        )

    if abs(entry.raw_duration - candidate.raw_duration) > DURATION_TOLERANCE_MS:
        issues.append(
            Issue.create_duration_mismatch(
                entry_id = entry.entry_id,
                match_method = DBMethod.EXACT,
                incoming_duration_ms = entry.raw_duration,
                candidate_duration_ms = candidate.raw_duration,
                tolerance_ms = DURATION_TOLERANCE_MS,
                extra_details = {
                    'candidate_entry_id': candidate.entry_id,
                    'authority_type': DBAuthority.ISRC.name,
                    'authority_code': entry.isrc,
                },
            )
        )

    if entry.normalized_artist_parts and candidate.normalized_artist_parts:
        if not entry.normalized_artist_parts.intersection(candidate.normalized_artist_parts):
            incoming = list(entry.source_artist_authority_ids)
            candidate_ids = list(candidate.source_artist_authority_ids)
            issues.append(
                Issue.create_artist_conflict(
                    entry_id = entry.entry_id,
                    match_method = DBMethod.EXACT,
                    incoming_artist_ids = incoming,
                    candidate_artist_ids = candidate_ids,
                    missing_artist_ids = candidate_ids,
                    extra_artist_ids = incoming,
                    authority_matched = True,
                    extra_details = {
                        'candidate_entry_id': candidate.entry_id,
                        'authority_type': DBAuthority.ISRC.name,
                        'authority_code': entry.isrc,
                    },
                )
            )

    return issues

def _build_source_isrc_conflict_issues(entries: Iterable[SourceEntry]) -> dict[int, list[Issue]]:
    by_isrc: dict[str, list[SourceEntry]] = {}
    for entry in entries:
        if entry.isrc:
            by_isrc.setdefault(entry.isrc, []).append(entry)

    issues_by_entry: dict[int, list[Issue]] = {}
    for same_isrc_entries in by_isrc.values():
        if len(same_isrc_entries) < 2:
            continue

        for index, entry in enumerate(same_isrc_entries):
            for candidate in same_isrc_entries[index + 1:]:
                pair_issues = _build_entry_pair_conflict_issues(entry, candidate)
                if not pair_issues:
                    continue

                issues_by_entry.setdefault(entry.entry_id, []).extend(pair_issues)
                issues_by_entry.setdefault(candidate.entry_id, []).extend(
                    _build_entry_pair_conflict_issues(candidate, entry)
                )

    return issues_by_entry

def _calculate_entry_group_confidence(group: NewSongGroup) -> float | None:
    if len(group.entry_ids) <= 1 and not group.unreviewed_entry_ids:
        return None
    if group.isrcs:
        return 0.98
    return 0.90

def _calculate_title_similarity(incoming_title: str, candidate_titles: Iterable[str]) -> float:
    scores = [
        SequenceMatcher(None, incoming_title, candidate_title).ratio()
        for candidate_title in candidate_titles
        if candidate_title
    ]
    return max(scores, default = 0.0)

def _check_artist_compatibility(
    entry: SourceEntry,
    candidate: CanonicalSong,
    resolution: ArtistResolution,
    *,
    authority_matched: bool,
) -> ArtistCompatibility:
    incoming = set(resolution.artist_ids)
    candidate_ids = set(candidate.artist_ids)

    if incoming and incoming == candidate_ids:
        return ArtistCompatibility(level = 'exact')

    if incoming and incoming.issubset(candidate_ids):
        missing = tuple(sorted(candidate_ids - incoming))
        if _check_missing_artists_are_credited(candidate, missing, entry.title_credit_names):
            return ArtistCompatibility(level = 'subset_credit', missing_artist_ids = missing)
        return ArtistCompatibility(level = 'subset', missing_artist_ids = missing)

    if incoming and candidate_ids and incoming.intersection(candidate_ids):
        return ArtistCompatibility(
            level = 'partial',
            missing_artist_ids = tuple(sorted(candidate_ids - incoming)),
            extra_artist_ids = tuple(sorted(incoming - candidate_ids)),
        )

    name_matches = set(resolution.name_matched_artist_ids).intersection(candidate_ids)
    if name_matches:
        return ArtistCompatibility(
            level = 'name_match',
            missing_artist_ids = tuple(sorted(candidate_ids - name_matches)),
        )

    if authority_matched and not candidate_ids and not incoming:
        return ArtistCompatibility(level = 'exact')

    return ArtistCompatibility(
        level = 'none',
        missing_artist_ids = tuple(sorted(candidate_ids)),
        extra_artist_ids = tuple(sorted(incoming)),
    )

def _check_entries_same_recording(left: SourceEntry, right: SourceEntry) -> bool:
    if not left.normalized_core_title or left.normalized_core_title != right.normalized_core_title:
        return False
    if abs(left.raw_duration - right.raw_duration) > DURATION_TOLERANCE_MS:
        return False
    return bool(left.normalized_artist_parts.intersection(right.normalized_artist_parts))

def _check_missing_artists_are_credited(
    candidate: CanonicalSong,
    missing_artist_ids: Iterable[int],
    credit_names: Iterable[str],
) -> bool:
    credit_names = set(credit_names)
    if not credit_names:
        return False

    name_by_id = dict(zip(candidate.artist_ids, candidate.artist_names))
    for artist_id in missing_artist_ids:
        normalized = normalize_artist(name_by_id.get(artist_id, ''))
        if not normalized or normalized not in credit_names:
            return False
    return True

def _coerce_positive_int(value: object, fallback: int | None = None) -> int | None:
    try:
        number = int(value) # type: ignore[arg-type]
    except (TypeError, ValueError):
        return fallback
    return number if number > 0 else fallback

def _confirm_entry_mapping_inside_transaction(
    connection: psycopg.Connection,
    entry_id: int,
    song_id: int,
    *,
    changed_by: str,
    reason: str | None,
) -> None:
    with connection.cursor() as cur:
        cur.execute("""--sql
            SELECT song_id
            FROM entry_mapping
            WHERE entry_id = %s
              AND song_id <> %s
              AND status <> %s
        """, (entry_id, song_id, DBStatus.REJECTED.value))
        other_song_ids = [int(row[0]) for row in cur.fetchall()]

    for other_song_id in other_song_ids:
        reject_entry_mapping(
            connection,
            entry_id,
            other_song_id,
            changed_by = changed_by,
            reason = reason,
            _inside_transaction = True,
        )

    selected = MappingPlan(
        entry_id = entry_id,
        song_id = song_id,
        confidence = 1.0,
        match_method = DBMethod.MANUAL,
        status = DBStatus.CONFIRMED,
    )
    _set_mapping_with_log(connection, selected, changed_by = changed_by, reason = reason)

def _coerce_json_object(value: object) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        parsed = json.loads(value)
        if isinstance(parsed, dict):
            return parsed
    raise ValueError('raw_json must be a JSON object.')

def _convert_to_pending_mapping(mapping: MappingPlan) -> MappingPlan:
    if mapping.status == DBStatus.PENDING:
        return mapping
    return MappingPlan(
        entry_id = mapping.entry_id,
        song_id = mapping.song_id,
        confidence = min(mapping.confidence, 0.92),
        match_method = mapping.match_method,
        status = DBStatus.PENDING,
    )

def _dedupe_mappings(mappings: Iterable[MappingPlan]) -> list[MappingPlan]:
    by_key: dict[tuple[int, int], MappingPlan] = {}
    for mapping in mappings:
        existing = by_key.get(mapping.key())
        if existing is None or _rank_mapping(mapping) > _rank_mapping(existing):
            by_key[mapping.key()] = mapping
    return list(by_key.values())

def _extract_entry_album_refs(entry: SourceEntry) -> list[dict[str, Any]]:
    album_by_id = {
        str(album.get('id')): album
        for album in entry.raw_json.get('albums', [])
        if isinstance(album, dict) and _get_non_empty_string(album.get('id'))
    }
    result: list[dict[str, Any]] = []
    album_id = _get_non_empty_string(entry.song.get('albumID'))
    if not album_id:
        return result

    album = album_by_id.get(album_id)
    disc_number = _coerce_positive_int(entry.song.get('discNumber'), 1)
    track_number = _coerce_positive_int(entry.song.get('trackNumber'), None)
    item = {
        'authority_code': album_id,
        'disc_number': disc_number,
    }
    if track_number is not None:
        item['track_number'] = track_number

    if isinstance(album, dict):
        track_count = album.get('trackCount')
        if isinstance(track_count, dict):
            track_count_value = _coerce_positive_int(track_count.get(str(disc_number)), None)
            if track_count_value is not None:
                item['track_count'] = track_count_value

    result.append(item)
    return result

def _extract_entry_authorities(entry: SourceEntry) -> list[tuple[DBAuthority, str]]:
    authorities: list[tuple[DBAuthority, str]] = []
    if entry.apple_music_id:
        authorities.append((DBAuthority.APPLE_MUSIC, entry.apple_music_id))
    if entry.isrc:
        authorities.append((DBAuthority.ISRC, entry.isrc))
    return _unique_authorities(authorities)

def _extract_entry_release_date(entry: SourceEntry) -> date | None:
    value = _get_non_empty_string(entry.song.get('releaseDate'))
    if value is None:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None

def _extract_entry_titles(entry: SourceEntry) -> list[dict[str, Any]]:
    titles = entry.song.get('title')
    if not isinstance(titles, dict):
        return []

    result: list[dict[str, Any]] = []
    for locale_name, title in titles.items():
        title_text = _get_non_empty_string(title)
        if title_text is None:
            continue
        locale = _get_title_locale_value(str(locale_name))
        result.append({
            'locale': locale,
            'title': title_text,
            'normalized_title': normalize_title(title_text),
        })
    return result

def _get_album_ids_by_apple_authorities(
    connection: psycopg.Connection,
    authority_codes: Iterable[str],
) -> dict[str, int]:
    codes = sorted({
        clean_code
        for code in authority_codes
        if (clean_code := _get_non_empty_string(code)) is not None
    })
    if not codes:
        return {}

    with connection.cursor() as cur:
        cur.execute("""--sql
            SELECT authority_code, album_id
            FROM album_authorities
            WHERE authority = %s
              AND authority_code = ANY(%s)
        """, (DBAuthority.APPLE_MUSIC.value, codes))
        return {str(row[0]): int(row[1]) for row in cur.fetchall()}

def _get_entry_group_match_method(group: NewSongGroup) -> DBMethod | None:
    if len(group.entry_ids) <= 1 and not group.unreviewed_entry_ids:
        return None
    return DBMethod.EXACT

def _get_entry_group_row(connection: psycopg.Connection, group_id: int, *, lock: bool = False) -> dict[str, Any] | None:
    with connection.cursor() as cur:
        cur.execute(f"""--sql
            SELECT group_id, status, canonical_song_id, match_method, confidence, details, created_at, resolved_at
            FROM entry_group
            WHERE group_id = %s
            {'FOR UPDATE' if lock else ''}
        """, (group_id, ))
        row = cur.fetchone()

    if row is None:
        return None

    return {
        'group_id': int(row[0]),
        'status': int(row[1]),
        'canonical_song_id': int(row[2]) if row[2] is not None else None,
        'match_method': int(row[3]) if row[3] is not None else None,
        'confidence': float(row[4]) if row[4] is not None else None,
        'details': row[5] or {},
        'created_at': row[6],
        'resolved_at': row[7],
    }

def _get_non_empty_string(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None

def _get_song_row(connection: psycopg.Connection, song_id: int, *, lock: bool = False) -> dict[str, Any] | None:
    with connection.cursor() as cur:
        cur.execute(f"""--sql
            SELECT song_id, audio, duration, genre_tag, genre_info, media_tag, release_date, vocal, created_at, updated_at
            FROM songs
            WHERE song_id = %s
            {'FOR UPDATE' if lock else ''}
        """, (song_id, ))
        row = cur.fetchone()

    if row is None:
        return None

    return {
        'song_id': int(row[0]),
        'audio': row[1],
        'duration': int(row[2]),
        'genre_tag': int(row[3]),
        'genre_info': int(row[4]),
        'media_tag': int(row[5]),
        'release_date': row[6],
        'vocal': int(row[7]),
        'created_at': row[8],
        'updated_at': row[9],
    }

def _get_title_locale_value(locale: str) -> int:
    aliases = {
        'zs': 'zh-Hans',
        'zt': 'zh-Hant',
    }
    return DBLocale.get_locale(aliases.get(locale, locale)).value

def _get_unique_group_entry_ids(connection: psycopg.Connection, group_id: int) -> list[int]:
    with connection.cursor() as cur:
        cur.execute("""--sql
            SELECT entry_id
            FROM entry_group_entries
            WHERE group_id = %s
            ORDER BY entry_id
        """, (group_id, ))
        return [int(row[0]) for row in cur.fetchall()]

def _insert_change_log(
    connection: psycopg.Connection,
    *,
    table_name: str,
    row_pk: Mapping[str, Any],
    operation: str,
    old_data: Mapping[str, Any] | None,
    new_data: Mapping[str, Any] | None,
    changed_by: str,
    reason: str | None,
) -> None:
    with connection.cursor() as cur:
        cur.execute("""--sql
            INSERT INTO change_log (table_name, row_pk, operation, old_data, new_data, changed_by, reason)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (
            table_name,
            Jsonb(_json_safe(dict(row_pk))),
            operation,
            Jsonb(_json_safe(dict(old_data))) if old_data is not None else None,
            Jsonb(_json_safe(dict(new_data))) if new_data is not None else None,
            changed_by,
            reason,
        ))

def _json_safe(value: object) -> object:
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [_json_safe(item) for item in value]
    if hasattr(value, 'isoformat'):
        return value.isoformat() # type: ignore[no-any-return]
    return value

def _insert_entry_group(connection: psycopg.Connection, group: NewSongGroup) -> int:
    member_entry_ids = sorted({*group.entry_ids, *group.unreviewed_entry_ids})
    existing_group_id = get_pending_entry_group_by_entry_ids(connection, member_entry_ids)
    if existing_group_id is not None:
        return existing_group_id

    match_method = _get_entry_group_match_method(group)
    with connection.cursor() as cur:
        cur.execute("""--sql
            INSERT INTO entry_group(status, match_method, confidence, details)
            VALUES (%s, %s, %s, %s)
            RETURNING group_id
        """, (
            DBGroupStatus.PENDING.value,
            match_method.value if match_method else None,
            _calculate_entry_group_confidence(group),
            Jsonb(_build_entry_group_details(group)),
        ))
        inserted = cur.fetchone()
        if inserted is None:
            raise RuntimeError('Failed to insert entry group.')
        return int(inserted[0])

def _insert_entry_group_entries(
    connection: psycopg.Connection,
    group_id: int,
    entry_ids: Iterable[int],
) -> None:
    unique_entry_ids = sorted({int(entry_id) for entry_id in entry_ids})
    if not unique_entry_ids:
        return

    with connection.cursor() as cur:
        cur.execute("""--sql
            INSERT INTO entry_group_entries(group_id, entry_id)
            SELECT %s, unnest(%s::integer[])
            ON CONFLICT (group_id, entry_id) DO NOTHING
        """, (group_id, unique_entry_ids))

def _insert_entry_group_issues(
    connection: psycopg.Connection,
    group_id: int,
    issue_ids: Iterable[int],
) -> None:
    unique_issue_ids = sorted({int(issue_id) for issue_id in issue_ids})
    if not unique_issue_ids:
        return

    with connection.cursor() as cur:
        cur.execute("""--sql
            INSERT INTO entry_group_issues(group_id, issue_id)
            SELECT %s, unnest(%s::bigint[])
            ON CONFLICT (group_id, issue_id) DO NOTHING
        """, (group_id, unique_issue_ids))

def _insert_issue(connection: psycopg.Connection, issue: Issue) -> int:
    row = issue.to_json()
    with connection.cursor() as cur:
        cur.execute("""--sql
            SELECT issue_id
            FROM entry_issues
            WHERE entry_id = %s
              AND song_id IS NOT DISTINCT FROM %s
              AND match_method IS NOT DISTINCT FROM %s
              AND reason = %s
              AND details = %s
            LIMIT 1
        """, (row['entry_id'], row['song_id'], row['match_method'], row['reason'], Jsonb(row['details'])))
        existing = cur.fetchone()
        if existing is not None:
            return int(existing[0])

        cur.execute("""--sql
            INSERT INTO entry_issues(entry_id, song_id, match_method, reason, details)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING issue_id
        """, (row['entry_id'], row['song_id'], row['match_method'], row['reason'], Jsonb(row['details'])))
        inserted = cur.fetchone()
        if inserted is None:
            raise RuntimeError('Failed to insert entry issue.')
        return int(inserted[0])

def _load_canonical_songs(
    connection: psycopg.Connection,
    song_ids: Iterable[int],
) -> dict[int, CanonicalSong]:
    songs = get_canonical_song_data(connection, list(song_ids))
    return {
        song_id: CanonicalSong(
            song_id = song_id,
            duration = data['duration'],
            titles = tuple(
                LocalizedTitle(
                    title = title['title'],
                    normalized_title = title['normalized_title'],
                    locale = title['locale'],
                    fallback = title['fallback'],
                )
                for title in data['titles']
            ),
            artist_ids = tuple(data['artist_ids']),
            artist_names = tuple(data['artist_names']),
        )
        for song_id, data in songs.items()
    }

def _load_entry_group_source_entries(connection: psycopg.Connection, group_id: int) -> list[SourceEntry]:
    entry_ids = _get_unique_group_entry_ids(connection, group_id)
    return _load_source_entries_by_ids(connection, entry_ids)

def _load_source_entries_by_ids(connection: psycopg.Connection, entry_ids: Iterable[int]) -> list[SourceEntry]:
    entry_ids = sorted({int(entry_id) for entry_id in entry_ids})
    if not entry_ids:
        return []
    with connection.cursor() as cur:
        cur.execute("""--sql
            SELECT
                e.entry_id,
                e.source_id,
                e.source_item_id,
                e.normalized_album,
                e.normalized_artist,
                e.normalized_title,
                e.raw_album,
                e.raw_artist,
                e.raw_duration,
                e.raw_json,
                e.raw_title,
                src.source_type
            FROM entries e
            JOIN sources src
              ON src.source_id = e.source_id
            WHERE e.entry_id = ANY(%s)
            ORDER BY e.entry_id
        """, (entry_ids, ))
        rows = [
            {
                'entry_id': int(row[0]),
                'source_id': int(row[1]),
                'source_item_id': int(row[2]),
                'normalized_album': row[3],
                'normalized_artist': row[4],
                'normalized_title': row[5],
                'raw_album': row[6],
                'raw_artist': row[7],
                'raw_duration': int(row[8]),
                'raw_json': row[9],
                'raw_title': row[10],
                'source_type': int(row[11]),
            }
            for row in cur.fetchall()
        ]
    return _load_source_entries_from_rows(rows)

def _load_source_entries(connection: psycopg.Connection, source_id: int) -> list[SourceEntry]:
    return _load_source_entries_from_rows(get_source_entries(connection, source_id))

def _load_source_entries_from_rows(rows: Iterable[Mapping[str, Any]]) -> list[SourceEntry]:
    return [
        SourceEntry(
            entry_id = row['entry_id'],
            source_id = row['source_id'],
            source_item_id = row['source_item_id'],
            normalized_album = row['normalized_album'],
            normalized_artist = row['normalized_artist'],
            normalized_title = row['normalized_title'],
            raw_album = row['raw_album'],
            raw_artist = row['raw_artist'],
            raw_duration = row['raw_duration'],
            raw_json = _coerce_json_object(row['raw_json']),
            raw_title = row['raw_title'],
            source_type = row['source_type'],
        )
        for row in rows
    ]

def _match_by_authorities(
    connection: psycopg.Connection,
    entry: SourceEntry,
    artist_resolution: ArtistResolution,
) -> EntryMatchResult:
    result = EntryMatchResult(entry = entry)
    authority_song_ids: dict[DBAuthority, list[int]] = {}

    if entry.apple_music_id:
        authority_song_ids[DBAuthority.APPLE_MUSIC] = get_song_ids_by_authority(
            connection,
            DBAuthority.APPLE_MUSIC,
            entry.apple_music_id,
        )
    if entry.isrc:
        authority_song_ids[DBAuthority.ISRC] = get_song_ids_by_authority(
            connection,
            DBAuthority.ISRC,
            entry.isrc,
        )

    populated = {authority: ids for authority, ids in authority_song_ids.items() if ids}
    all_song_ids = sorted({song_id for ids in populated.values() for song_id in ids})
    if len(all_song_ids) > 1:
        candidates = _load_canonical_songs(connection, all_song_ids)
        for authority, ids in populated.items():
            authority_code = entry.apple_music_id if authority == DBAuthority.APPLE_MUSIC else entry.isrc
            for song_id in ids:
                candidate = candidates.get(song_id)
                result.mappings.append(
                    MappingPlan(
                        entry_id = entry.entry_id,
                        song_id = song_id,
                        confidence = 0.92,
                        match_method = DBMethod.APPLE if authority == DBAuthority.APPLE_MUSIC else DBMethod.EXACT,
                        status = DBStatus.PENDING,
                    )
                )
                result.issues.append(
                    Issue.create_authority_conflict(
                        entry_id = entry.entry_id,
                        song_id = candidate.song_id if candidate else None,
                        match_method = DBMethod.APPLE if authority == DBAuthority.APPLE_MUSIC else DBMethod.EXACT,
                        authority_type = authority.name,
                        authority_code = authority_code,
                        incoming_song_id = entry.apple_music_id,
                        candidate_song_ids = all_song_ids,
                        json_path = '$.songs[0].id' if authority == DBAuthority.APPLE_MUSIC else '$.songs[0].isrc',
                    )
                )
        return result

    if not all_song_ids:
        return result

    song_id = all_song_ids[0]
    candidate = _load_canonical_songs(connection, [song_id]).get(song_id)
    if candidate is None:
        return result

    authority = DBAuthority.APPLE_MUSIC if entry.apple_music_id and song_id in authority_song_ids.get(DBAuthority.APPLE_MUSIC, []) else DBAuthority.ISRC
    method = DBMethod.APPLE if authority == DBAuthority.APPLE_MUSIC else DBMethod.EXACT
    conflicts = _build_candidate_conflict_issues(entry, candidate, artist_resolution, method, authority_matched = True)
    if conflicts:
        result.mappings.append(
            MappingPlan(
                entry_id = entry.entry_id,
                song_id = song_id,
                confidence = 0.90,
                match_method = method,
                status = DBStatus.PENDING,
            )
        )
        result.issues.extend(conflicts)
    else:
        result.mappings.append(
            MappingPlan(
                entry_id = entry.entry_id,
                song_id = song_id,
                confidence = 1.0 if method == DBMethod.APPLE else 0.98,
                match_method = method,
                status = DBStatus.CONFIRMED,
            )
        )

    return result

def _match_by_exact_metadata(
    connection: psycopg.Connection,
    entry: SourceEntry,
    artist_resolution: ArtistResolution,
) -> EntryMatchResult:
    result = EntryMatchResult(entry = entry)
    song_ids = get_song_ids_by_title_and_duration(
        connection,
        normalize_title(entry.raw_title),
        entry.raw_duration,
        DURATION_TOLERANCE_MS,
    )
    candidates = _load_canonical_songs(connection, song_ids)

    candidate_plans: list[tuple[MappingPlan, ArtistCompatibility]] = []
    candidate_issues: list[Issue] = []

    for candidate in candidates.values():
        if entry.normalized_core_title not in candidate.normalized_core_titles:
            continue

        compatibility = _check_artist_compatibility(entry, candidate, artist_resolution, authority_matched = False)
        if not compatibility.compatible:
            continue

        confidence = 0.90 * compatibility.confidence_factor
        status = DBStatus.CONFIRMED if compatibility.auto_confirmable else DBStatus.PENDING
        candidate_plans.append(
            (
                MappingPlan(
                    entry_id = entry.entry_id,
                    song_id = candidate.song_id,
                    confidence = round(confidence, 4),
                    match_method = DBMethod.EXACT,
                    status = status,
                ),
                compatibility,
            )
        )
        if compatibility.conflict:
            candidate_issues.append(
                Issue.create_artist_conflict(
                    entry_id = entry.entry_id,
                    song_id = candidate.song_id,
                    match_method = DBMethod.EXACT,
                    incoming_artist_ids = list(entry.source_artist_authority_ids),
                    candidate_artist_ids = list(candidate.artist_ids),
                    missing_artist_ids = list(compatibility.missing_artist_ids),
                    extra_artist_ids = list(compatibility.extra_artist_ids),
                    authority_matched = False,
                )
            )

    if not candidate_plans:
        return result

    auto_confirmable = [plan for plan, compatibility in candidate_plans if compatibility.auto_confirmable]
    if len(candidate_plans) == 1 and len(auto_confirmable) == 1:
        result.mappings.append(auto_confirmable[0])
        result.issues.extend(candidate_issues)
        return result

    if len(candidate_plans) == 1:
        plan, _ = candidate_plans[0]
        result.mappings.append(
            MappingPlan(
                entry_id = plan.entry_id,
                song_id = plan.song_id,
                confidence = plan.confidence,
                match_method = plan.match_method,
                status = DBStatus.PENDING,
            )
        )
        result.issues.extend(candidate_issues)
        return result

    for plan, _ in candidate_plans:
        result.mappings.append(
            MappingPlan(
                entry_id = plan.entry_id,
                song_id = plan.song_id,
                confidence = plan.confidence,
                match_method = plan.match_method,
                status = DBStatus.PENDING,
            )
        )
    result.issues.extend(candidate_issues)
    result.issues.append(
        Issue.create_multiple_candidates(
            entry_id = entry.entry_id,
            candidate_song_ids = [mapping.song_id for mapping in result.mappings],
            candidate_scores = {str(mapping.song_id): mapping.confidence for mapping in result.mappings},
            candidate_methods = {str(mapping.song_id): mapping.match_method.name for mapping in result.mappings},
        )
    )
    return result

def _match_by_fuzzy_metadata(
    connection: psycopg.Connection,
    entry: SourceEntry,
    artist_resolution: ArtistResolution,
    *,
    fuzzy_limit: int,
    min_confidence: float,
) -> EntryMatchResult:
    result = EntryMatchResult(entry = entry)
    song_ids = get_song_ids_by_duration_window(connection, entry.raw_duration, DURATION_TOLERANCE_MS * 3)
    candidates = _load_canonical_songs(connection, song_ids)
    scored: list[tuple[float, CanonicalSong]] = []

    for candidate in candidates.values():
        compatibility = _check_artist_compatibility(entry, candidate, artist_resolution, authority_matched = False)
        if not compatibility.compatible:
            continue

        title_score = _calculate_title_similarity(entry.normalized_core_title, candidate.normalized_core_titles)
        if title_score < 0.72:
            continue

        duration_score = max(0.0, 1.0 - abs(entry.raw_duration - candidate.duration) / max(DURATION_TOLERANCE_MS * 3, 1))
        confidence = (title_score * 0.70) + (compatibility.confidence_factor * 0.20) + (duration_score * 0.10)
        if confidence >= min_confidence:
            scored.append((round(confidence, 4), candidate))

    scored.sort(key = lambda item: (-item[0], item[1].song_id))
    for confidence, candidate in scored[:max(fuzzy_limit, 0)]:
        result.mappings.append(
            MappingPlan(
                entry_id = entry.entry_id,
                song_id = candidate.song_id,
                confidence = confidence,
                match_method = DBMethod.FUZZY,
                status = DBStatus.PENDING,
            )
        )

    if len(result.mappings) > 1:
        result.issues.append(
            Issue.create_multiple_candidates(
                entry_id = entry.entry_id,
                candidate_song_ids = [mapping.song_id for mapping in result.mappings],
                candidate_scores = {str(mapping.song_id): mapping.confidence for mapping in result.mappings},
                candidate_methods = {str(mapping.song_id): mapping.match_method.name for mapping in result.mappings},
            )
        )

    return result

def _merge_entry_result(summary: MatchSummary, result: EntryMatchResult) -> None:
    summary.mappings.extend(_dedupe_mappings(result.mappings))
    summary.issues.extend(result.issues)
    summary.pending_mappings += sum(1 for mapping in result.mappings if mapping.status == DBStatus.PENDING)
    summary.fuzzy_candidates += sum(1 for mapping in result.mappings if mapping.match_method == DBMethod.FUZZY)

    for mapping in result.mappings:
        if mapping.status != DBStatus.CONFIRMED:
            continue
        if mapping.match_method == DBMethod.APPLE:
            summary.apple_confirmed += 1
        elif mapping.match_method == DBMethod.EXACT and mapping.confidence >= 0.98:
            summary.isrc_confirmed += 1
        elif mapping.match_method == DBMethod.EXACT:
            summary.exact_confirmed += 1

    for issue in result.issues:
        if issue.reason == IssueReason.AUTHORITY_CONFLICT:
            summary.authority_conflicts += 1
        elif issue.reason == IssueReason.ARTIST_CONFLICT:
            summary.artist_conflicts += 1
        elif issue.reason == IssueReason.TITLE_CONFLICT:
            summary.title_conflicts += 1
        elif issue.reason == IssueReason.DURATION_MISMATCH:
            summary.duration_conflicts += 1
        elif issue.reason == IssueReason.MULTIPLE_CANDIDATES:
            summary.multiple_candidates += 1

    summary.unreviewed_entry_matches += len(result.unreviewed_entry_ids)

def _merge_entry_group_metadata_into_song(
    connection: psycopg.Connection,
    group_id: int,
    song_id: int,
    *,
    changed_by: str,
    reason: str | None,
) -> dict[str, int]:
    entries = _load_entry_group_source_entries(connection, group_id)
    return _merge_entries_metadata_into_song(
        connection,
        song_id,
        entries,
        changed_by = changed_by,
        reason = reason,
    )

def _merge_entries_metadata_into_song(
    connection: psycopg.Connection,
    song_id: int,
    entries: Iterable[SourceEntry],
    *,
    changed_by: str,
    reason: str | None,
) -> dict[str, int]:
    entries = list(entries)
    counters = {
        'song_authorities': 0,
        'song_titles': 0,
        'song_updates': 0,
        'album_tracks': 0,
        'album_track_counts': 0,
    }

    authority_pairs: list[tuple[DBAuthority, str]] = []
    for entry in entries:
        authority_pairs.extend(_extract_entry_authorities(entry))
    for authority, authority_code in _unique_authorities(authority_pairs):
        if _upsert_song_authority_with_log(
            connection,
            song_id,
            authority,
            authority_code,
            changed_by = changed_by,
            reason = reason,
        ):
            counters['song_authorities'] += 1

    if _update_song_from_entries_with_log(
        connection,
        song_id,
        entries,
        changed_by = changed_by,
        reason = reason,
    ):
        counters['song_updates'] += 1

    for title in _merge_title_candidates(entries):
        if _upsert_song_title_with_log(
            connection,
            song_id,
            title,
            changed_by = changed_by,
            reason = reason,
        ):
            counters['song_titles'] += 1

    album_refs = [
        album_ref
        for entry in entries
        for album_ref in _extract_entry_album_refs(entry)
    ]
    album_ids = _get_album_ids_by_apple_authorities(
        connection,
        [album_ref['authority_code'] for album_ref in album_refs],
    )
    for album_ref in album_refs:
        album_id = album_ids.get(str(album_ref['authority_code']))
        if album_id is None:
            continue
        if 'track_number' in album_ref and _upsert_album_track_with_log(
            connection,
            album_id,
            song_id,
            album_ref['disc_number'],
            album_ref['track_number'],
            changed_by = changed_by,
            reason = reason,
        ):
            counters['album_tracks'] += 1
        if 'track_count' in album_ref and _upsert_album_track_count_with_log(
            connection,
            album_id,
            album_ref['disc_number'],
            album_ref['track_count'],
            changed_by = changed_by,
            reason = reason,
        ):
            counters['album_track_counts'] += 1

    return counters

def _merge_title_candidates(entries: Iterable[SourceEntry]) -> list[dict[str, Any]]:
    by_locale: dict[int, dict[str, Any]] = {}
    conflicts: set[int] = set()
    for entry in entries:
        for title in _extract_entry_titles(entry):
            existing = by_locale.get(title['locale'])
            if existing is None:
                by_locale[title['locale']] = title
                continue
            if existing['title'] != title['title']:
                conflicts.add(title['locale'])

    return [
        title
        for locale, title in sorted(by_locale.items())
        if locale not in conflicts
    ]

def _rank_mapping(mapping: MappingPlan) -> tuple[int, float]:
    status_rank = 2 if mapping.status == DBStatus.CONFIRMED else 1
    return status_rank, mapping.confidence

def _resolve_entry_artists(connection: psycopg.Connection, entry: SourceEntry) -> ArtistResolution:
    authority_ids = entry.source_artist_authority_ids
    normalized_names = tuple(sorted(entry.normalized_artist_parts))
    by_authority = get_artist_ids_by_authorities(connection, DBAuthority.APPLE_MUSIC, list(authority_ids))
    artist_ids = [by_authority[authority_id] for authority_id in authority_ids if authority_id in by_authority]
    name_matched_ids = get_artist_ids_by_normalized_names(connection, list(normalized_names))

    return ArtistResolution(
        authority_ids = authority_ids,
        artist_ids = tuple(dict.fromkeys(artist_ids)),
        name_matched_artist_ids = tuple(sorted(name_matched_ids)),
        normalized_names = normalized_names,
    )

def _resolve_entry_group_issues_with_log(
    connection: psycopg.Connection,
    group_id: int,
    *,
    changed_by: str,
    reason: str | None,
) -> int:
    with connection.cursor() as cur:
        cur.execute("""--sql
            SELECT ei.issue_id, ei.entry_id, ei.song_id, ei.match_method, ei.reason, ei.details, ei.created_at, ei.resolved_at
            FROM entry_issues ei
            JOIN entry_group_issues egi
              ON egi.issue_id = ei.issue_id
            WHERE egi.group_id = %s
              AND ei.resolved_at IS NULL
            FOR UPDATE
        """, (group_id, ))
        old_rows = [
            {
                'issue_id': int(row[0]),
                'entry_id': int(row[1]),
                'song_id': int(row[2]) if row[2] is not None else None,
                'match_method': int(row[3]) if row[3] is not None else None,
                'reason': row[4],
                'details': row[5] or {},
                'created_at': row[6],
                'resolved_at': row[7],
            }
            for row in cur.fetchall()
        ]

    for old in old_rows:
        with connection.cursor() as cur:
            cur.execute("""--sql
                UPDATE entry_issues
                SET resolved_at = now()
                WHERE issue_id = %s
                RETURNING issue_id, entry_id, song_id, match_method, reason, details, created_at, resolved_at
            """, (old['issue_id'], ))
            row = cur.fetchone()
        if row is None:
            continue
        new = {
            'issue_id': int(row[0]),
            'entry_id': int(row[1]),
            'song_id': int(row[2]) if row[2] is not None else None,
            'match_method': int(row[3]) if row[3] is not None else None,
            'reason': row[4],
            'details': row[5] or {},
            'created_at': row[6],
            'resolved_at': row[7],
        }
        _insert_change_log(
            connection,
            table_name = 'entry_issues',
            row_pk = {'issue_id': old['issue_id']},
            operation = 'UPDATE',
            old_data = old,
            new_data = new,
            changed_by = changed_by,
            reason = reason,
        )

    return len(old_rows)

def _set_mapping_with_log(
    connection: psycopg.Connection,
    mapping: MappingPlan,
    *,
    changed_by: str,
    reason: str | None,
    old: Mapping[str, Any] | None = None,
) -> None:
    if old is None:
        old = get_entry_mapping(connection, mapping.entry_id, mapping.song_id)

    if old is None:
        with connection.cursor() as cur:
            cur.execute("""--sql
                INSERT INTO entry_mapping (entry_id, song_id, confidence, match_method, status)
                VALUES (%s, %s, %s, %s, %s)
            """, (mapping.entry_id, mapping.song_id, mapping.confidence, mapping.match_method.value, mapping.status.value))
        operation = 'INSERT'
    else:
        with connection.cursor() as cur:
            cur.execute("""--sql
                UPDATE entry_mapping
                SET confidence = %s,
                    match_method = %s,
                    status = %s
                WHERE entry_id = %s
                  AND song_id = %s
            """, (mapping.confidence, mapping.match_method.value, mapping.status.value, mapping.entry_id, mapping.song_id))
        operation = 'UPDATE'

    new = get_entry_mapping(connection, mapping.entry_id, mapping.song_id)
    _insert_change_log(
        connection,
        table_name = 'entry_mapping',
        row_pk = {'entry_id': mapping.entry_id, 'song_id': mapping.song_id},
        operation = operation,
        old_data = old,
        new_data = new,
        changed_by = changed_by,
        reason = reason,
    )

def _unique_authorities(authorities: Iterable[tuple[DBAuthority, str]]) -> list[tuple[DBAuthority, str]]:
    unique: dict[tuple[int, str], tuple[DBAuthority, str]] = {}
    for authority, code in authorities:
        clean_code = _get_non_empty_string(code)
        if clean_code is None:
            continue
        unique[(authority.value, clean_code)] = (authority, clean_code)
    return [unique[key] for key in sorted(unique)]

def _upsert_album_track_count_with_log(
    connection: psycopg.Connection,
    album_id: int,
    disc_number: int,
    track_count: int,
    *,
    changed_by: str,
    reason: str | None,
) -> bool:
    with connection.cursor() as cur:
        cur.execute("""--sql
            SELECT album_id, disc_number, track_count
            FROM album_track_counts
            WHERE album_id = %s
              AND disc_number = %s
            FOR UPDATE
        """, (album_id, disc_number))
        old = cur.fetchone()
        if old is not None:
            return False

        cur.execute("""--sql
            INSERT INTO album_track_counts(album_id, disc_number, track_count)
            VALUES (%s, %s, %s)
            RETURNING album_id, disc_number, track_count
        """, (album_id, disc_number, track_count))
        row = cur.fetchone()

    if row is None:
        return False

    _insert_change_log(
        connection,
        table_name = 'album_track_counts',
        row_pk = {'album_id': album_id, 'disc_number': disc_number},
        operation = 'INSERT',
        old_data = None,
        new_data = {'album_id': int(row[0]), 'disc_number': int(row[1]), 'track_count': int(row[2])},
        changed_by = changed_by,
        reason = reason,
    )
    return True

def _upsert_album_track_with_log(
    connection: psycopg.Connection,
    album_id: int,
    song_id: int,
    disc_number: int,
    track_number: int,
    *,
    changed_by: str,
    reason: str | None,
) -> bool:
    with connection.cursor() as cur:
        cur.execute("""--sql
            SELECT album_id, song_id, disc_number, track_number
            FROM album_tracks
            WHERE album_id = %s
              AND disc_number = %s
              AND track_number = %s
            FOR UPDATE
        """, (album_id, disc_number, track_number))
        old = cur.fetchone()
        if old is not None:
            if int(old[1]) != song_id:
                raise ValueError(
                    f'Album {album_id} disc {disc_number} track {track_number} already belongs to song {int(old[1])}.'
                )
            return False

        cur.execute("""--sql
            INSERT INTO album_tracks(album_id, song_id, disc_number, track_number)
            VALUES (%s, %s, %s, %s)
            RETURNING album_id, song_id, disc_number, track_number
        """, (album_id, song_id, disc_number, track_number))
        row = cur.fetchone()

    if row is None:
        return False

    _insert_change_log(
        connection,
        table_name = 'album_tracks',
        row_pk = {'album_id': album_id, 'disc_number': disc_number, 'track_number': track_number},
        operation = 'INSERT',
        old_data = None,
        new_data = {'album_id': int(row[0]), 'song_id': int(row[1]), 'disc_number': int(row[2]), 'track_number': int(row[3])},
        changed_by = changed_by,
        reason = reason,
    )
    return True

def _upsert_mapping_with_log(
    connection: psycopg.Connection,
    mapping: MappingPlan,
    *,
    changed_by: str,
    reason: str | None,
) -> None:
    old = get_entry_mapping(connection, mapping.entry_id, mapping.song_id)
    if old is not None and old['status'] in {DBStatus.CONFIRMED.value, DBStatus.REJECTED.value}:
        return

    _set_mapping_with_log(connection, mapping, changed_by = changed_by, reason = reason, old = old)

def _upsert_song_authority_with_log(
    connection: psycopg.Connection,
    song_id: int,
    authority: DBAuthority,
    authority_code: str,
    *,
    changed_by: str,
    reason: str | None,
) -> bool:
    with connection.cursor() as cur:
        cur.execute("""--sql
            SELECT song_id
            FROM song_authorities
            WHERE authority = %s
              AND authority_code = %s
            FOR UPDATE
        """, (authority.value, authority_code))
        old = cur.fetchone()
        if old is not None:
            if int(old[0]) != song_id:
                raise ValueError(
                    f'{authority.name} authority {authority_code} already belongs to song {int(old[0])}.'
                )
            return False

        cur.execute("""--sql
            INSERT INTO song_authorities(song_id, authority, authority_code)
            VALUES (%s, %s, %s)
            RETURNING song_id, authority, authority_code
        """, (song_id, authority.value, authority_code))
        row = cur.fetchone()

    if row is None:
        return False

    _insert_change_log(
        connection,
        table_name = 'song_authorities',
        row_pk = {'authority': authority.value, 'authority_code': authority_code},
        operation = 'INSERT',
        old_data = None,
        new_data = {'song_id': int(row[0]), 'authority': int(row[1]), 'authority_code': row[2]},
        changed_by = changed_by,
        reason = reason,
    )
    return True

def _upsert_song_title_with_log(
    connection: psycopg.Connection,
    song_id: int,
    title: Mapping[str, Any],
    *,
    changed_by: str,
    reason: str | None,
) -> bool:
    locale = int(title['locale'])
    with connection.cursor() as cur:
        cur.execute("""--sql
            SELECT song_id, fallback, locale, normalized_title, title
            FROM song_titles
            WHERE song_id = %s
              AND locale = %s
            FOR UPDATE
        """, (song_id, locale))
        old = cur.fetchone()
        if old is not None:
            return False

        cur.execute("""--sql
            SELECT EXISTS (
                SELECT 1
                FROM song_titles
                WHERE song_id = %s
                  AND fallback = true
            )
        """, (song_id, ))
        has_fallback = bool(cur.fetchone()[0]) # type: ignore[index]
        fallback = not has_fallback

        cur.execute("""--sql
            INSERT INTO song_titles(song_id, fallback, locale, normalized_title, title)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING song_id, fallback, locale, normalized_title, title
        """, (song_id, fallback, locale, title['normalized_title'], title['title']))
        row = cur.fetchone()

    if row is None:
        return False

    _insert_change_log(
        connection,
        table_name = 'song_titles',
        row_pk = {'song_id': song_id, 'locale': locale},
        operation = 'INSERT',
        old_data = None,
        new_data = {
            'song_id': int(row[0]),
            'fallback': bool(row[1]),
            'locale': int(row[2]),
            'normalized_title': row[3],
            'title': row[4],
        },
        changed_by = changed_by,
        reason = reason,
    )
    return True

def _update_song_from_entries_with_log(
    connection: psycopg.Connection,
    song_id: int,
    entries: Iterable[SourceEntry],
    *,
    changed_by: str,
    reason: str | None,
) -> bool:
    old = _get_song_row(connection, song_id, lock = True)
    if old is None:
        raise ValueError(f'Unknown song_id: {song_id}')

    release_dates = [release_date for entry in entries if (release_date := _extract_entry_release_date(entry)) is not None]
    incoming_release_date = min(release_dates) if release_dates else None
    incoming_audio = next((_get_non_empty_string(entry.song.get('audio')) for entry in entries if _get_non_empty_string(entry.song.get('audio'))), None)

    next_release_date = old['release_date']
    if incoming_release_date is not None and (next_release_date is None or incoming_release_date < next_release_date):
        next_release_date = incoming_release_date

    next_audio = old['audio'] or incoming_audio
    if next_release_date == old['release_date'] and next_audio == old['audio']:
        return False

    with connection.cursor() as cur:
        cur.execute("""--sql
            UPDATE songs
            SET audio = %s,
                release_date = %s,
                updated_at = now()
            WHERE song_id = %s
            RETURNING song_id, audio, duration, genre_tag, genre_info, media_tag, release_date, vocal, created_at, updated_at
        """, (next_audio, next_release_date, song_id))
        row = cur.fetchone()

    if row is None:
        return False

    new = {
        'song_id': int(row[0]),
        'audio': row[1],
        'duration': int(row[2]),
        'genre_tag': int(row[3]),
        'genre_info': int(row[4]),
        'media_tag': int(row[5]),
        'release_date': row[6],
        'vocal': int(row[7]),
        'created_at': row[8],
        'updated_at': row[9],
    }
    _insert_change_log(
        connection,
        table_name = 'songs',
        row_pk = {'song_id': song_id},
        operation = 'UPDATE',
        old_data = old,
        new_data = new,
        changed_by = changed_by,
        reason = reason,
    )
    return True

def confirm_entry_group(
    connection: psycopg.Connection,
    group_id: int,
    canonical_song_id: int,
    *,
    changed_by: str = MATCHER_NAME,
    reason: str | None = None,
    merge_metadata: bool = True,
) -> dict[str, Any]:
    ensure_matching_schema(connection)
    reason = reason or 'confirm entry group'
    with connection.transaction():
        old_group = _get_entry_group_row(connection, group_id, lock = True)
        if old_group is None:
            raise ValueError(f'Unknown entry group: {group_id}')
        if old_group['canonical_song_id'] is not None and old_group['canonical_song_id'] != canonical_song_id:
            raise ValueError(
                f'Entry group {group_id} already points to song {old_group["canonical_song_id"]}.'
            )
        if _get_song_row(connection, canonical_song_id, lock = True) is None:
            raise ValueError(f'Unknown song_id: {canonical_song_id}')

        merge_counts = _merge_entry_group_metadata_into_song(
            connection,
            group_id,
            canonical_song_id,
            changed_by = changed_by,
            reason = reason,
        ) if merge_metadata else {}

        entry_ids = _get_unique_group_entry_ids(connection, group_id)
        for entry_id in entry_ids:
            _confirm_entry_mapping_inside_transaction(
                connection,
                entry_id,
                canonical_song_id,
                changed_by = changed_by,
                reason = reason,
            )

        if old_group['status'] != DBGroupStatus.CONFIRMED.value or old_group['canonical_song_id'] != canonical_song_id:
            with connection.cursor() as cur:
                cur.execute("""--sql
                    UPDATE entry_group
                    SET status = %s,
                        canonical_song_id = %s,
                        resolved_at = COALESCE(resolved_at, now())
                    WHERE group_id = %s
                    RETURNING group_id, status, canonical_song_id, match_method, confidence, details, created_at, resolved_at
                """, (DBGroupStatus.CONFIRMED.value, canonical_song_id, group_id))
            new_group = _get_entry_group_row(connection, group_id)
            if new_group is not None:
                _insert_change_log(
                    connection,
                    table_name = 'entry_group',
                    row_pk = {'group_id': group_id},
                    operation = 'UPDATE',
                    old_data = old_group,
                    new_data = new_group,
                    changed_by = changed_by,
                    reason = reason,
                )

        resolved_issue_count = _resolve_entry_group_issues_with_log(
            connection,
            group_id,
            changed_by = changed_by,
            reason = reason,
        )

    return {
        'group_id': group_id,
        'canonical_song_id': canonical_song_id,
        'confirmed_entry_ids': entry_ids,
        'resolved_issue_count': resolved_issue_count,
        'merge_counts': merge_counts,
    }

def confirm_entry_mapping(
    connection: psycopg.Connection,
    entry_id: int,
    song_id: int,
    *,
    changed_by: str = MATCHER_NAME,
    reason: str | None = None,
    merge_metadata: bool = True,
) -> None:
    ensure_matching_schema(connection)
    reason = reason or 'confirm entry mapping'
    with connection.transaction():
        if merge_metadata:
            entries = _load_source_entries_by_ids(connection, [entry_id])
            _merge_entries_metadata_into_song(
                connection,
                song_id,
                entries,
                changed_by = changed_by,
                reason = reason,
            )
        _confirm_entry_mapping_inside_transaction(
            connection,
            entry_id,
            song_id,
            changed_by = changed_by,
            reason = reason,
        )

def ensure_matching_schema(connection: psycopg.Connection) -> None:
    create(connection, ENTRY_MAPPING_TABLE)
    create(connection, ENTRY_ISSUES_TABLE)
    create(connection, ENTRY_GROUP_TABLE)
    create(connection, ENTRY_GROUP_ENTRIES_TABLE)
    create(connection, ENTRY_GROUP_ISSUES_TABLE)
    create(connection, CHANGE_LOG_TABLE)

def group_unmatched_entries(
    connection: psycopg.Connection,
    entries: Iterable[SourceEntry],
) -> list[NewSongGroup]:
    entries = list(entries)
    if not entries:
        return []

    parent = {entry.entry_id: entry.entry_id for entry in entries}
    entry_by_id = {entry.entry_id: entry for entry in entries}

    def find(entry_id: int) -> int:
        while parent[entry_id] != entry_id:
            parent[entry_id] = parent[parent[entry_id]]
            entry_id = parent[entry_id]
        return entry_id

    def union(left: int, right: int) -> None:
        left_root = find(left)
        right_root = find(right)
        if left_root != right_root:
            parent[right_root] = left_root

    by_isrc: dict[str, list[SourceEntry]] = {}
    for entry in entries:
        if entry.isrc:
            by_isrc.setdefault(entry.isrc, []).append(entry)

    for same_isrc_entries in by_isrc.values():
        first = same_isrc_entries[0]
        for entry in same_isrc_entries[1:]:
            union(first.entry_id, entry.entry_id)

    for index, entry in enumerate(entries):
        for candidate in entries[index + 1:]:
            if _check_entries_same_recording(entry, candidate):
                union(entry.entry_id, candidate.entry_id)

    grouped_ids: dict[int, list[int]] = {}
    for entry in entries:
        grouped_ids.setdefault(find(entry.entry_id), []).append(entry.entry_id)

    groups: list[NewSongGroup] = []
    for entry_ids in grouped_ids.values():
        group_entries = [entry_by_id[entry_id] for entry_id in sorted(entry_ids)]
        unreviewed_ids = sorted({
            legacy_id
            for group_entry in group_entries
            for legacy_id in get_unreviewed_legacy_entry_ids(
                connection,
                group_entry.raw_duration,
                group_entry.normalized_core_title,
                group_entry.normalized_artist_parts,
                DURATION_TOLERANCE_MS,
            )
        })
        groups.append(
            NewSongGroup(
                entry_ids = tuple(entry.entry_id for entry in group_entries),
                unreviewed_entry_ids = tuple(unreviewed_ids),
                isrcs = tuple(sorted({entry.isrc for entry in group_entries if entry.isrc})),
                normalized_core_titles = tuple(sorted({entry.normalized_core_title for entry in group_entries if entry.normalized_core_title})),
                min_duration_ms = min(entry.raw_duration for entry in group_entries),
                max_duration_ms = max(entry.raw_duration for entry in group_entries),
            )
        )

    return groups

def match_entry(
    connection: psycopg.Connection,
    entry: SourceEntry,
    *,
    include_fuzzy: bool = True,
    fuzzy_limit: int = DEFAULT_FUZZY_LIMIT,
    min_fuzzy_confidence: float = DEFAULT_MIN_FUZZY_CONFIDENCE,
) -> EntryMatchResult:
    result = EntryMatchResult(entry = entry)
    artist_resolution = _resolve_entry_artists(connection, entry)
    unreviewed_entry_ids = get_unreviewed_legacy_entry_ids(
        connection,
        entry.raw_duration,
        entry.normalized_core_title,
        entry.normalized_artist_parts,
        DURATION_TOLERANCE_MS,
    )

    authority_result = _match_by_authorities(connection, entry, artist_resolution)
    if authority_result.has_candidate:
        authority_result.unreviewed_entry_ids = unreviewed_entry_ids
        return authority_result

    exact_result = _match_by_exact_metadata(connection, entry, artist_resolution)
    if exact_result.has_candidate:
        exact_result.unreviewed_entry_ids = unreviewed_entry_ids
        return exact_result

    if include_fuzzy:
        fuzzy_result = _match_by_fuzzy_metadata(
            connection,
            entry,
            artist_resolution,
            fuzzy_limit = fuzzy_limit,
            min_confidence = min_fuzzy_confidence,
        )
        if fuzzy_result.has_candidate:
            fuzzy_result.unreviewed_entry_ids = unreviewed_entry_ids
            return fuzzy_result

    result.unreviewed_entry_ids = unreviewed_entry_ids
    return result

def match_source(
    connection: psycopg.Connection,
    source_id: int,
    *,
    dry_run: bool = True,
    include_fuzzy: bool = True,
    fuzzy_limit: int = DEFAULT_FUZZY_LIMIT,
    min_fuzzy_confidence: float = DEFAULT_MIN_FUZZY_CONFIDENCE,
) -> MatchSummary:
    if not dry_run:
        ensure_matching_schema(connection)
    source_type = get_source_type(connection, source_id)
    if source_type != DBAuthority.APPLE_MUSIC.value:
        raise ValueError('match_source currently expects a source with source_type APPLE_MUSIC.')

    entries = _load_source_entries(connection, source_id)
    summary = MatchSummary(source_id = source_id, dry_run = dry_run, total_entries = len(entries))
    entry_results: list[EntryMatchResult] = []
    source_isrc_issues = _build_source_isrc_conflict_issues(entries)

    for entry in entries:
        result = match_entry(
            connection,
            entry,
            include_fuzzy = include_fuzzy,
            fuzzy_limit = fuzzy_limit,
            min_fuzzy_confidence = min_fuzzy_confidence,
        )
        if entry.entry_id in source_isrc_issues:
            result.mappings = [_convert_to_pending_mapping(mapping) for mapping in result.mappings]
            result.issues.extend(source_isrc_issues[entry.entry_id])
        entry_results.append(result)
        _merge_entry_result(summary, result)

    unmatched_entries = [result.entry for result in entry_results if not result.has_candidate]
    groups = group_unmatched_entries(connection, unmatched_entries)
    summary.new_song_groups = groups

    group_by_entry_id: dict[int, NewSongGroup] = {}
    for group in groups:
        for entry_id in group.entry_ids:
            group_by_entry_id[entry_id] = group

    for result in entry_results:
        if result.has_candidate:
            continue

        group = group_by_entry_id.get(result.entry.entry_id)
        extra_details: dict[str, Any] = {}
        if group is not None:
            extra_details.update({
                'group_entry_ids': list(group.entry_ids),
                'unreviewed_entry_ids': list(group.unreviewed_entry_ids),
                'group_isrcs': list(group.isrcs),
            })
        issue = Issue.create_no_candidate(
            entry_id = result.entry.entry_id,
            searched_authorities = [
                {'authority_type': DBAuthority.APPLE_MUSIC.name, 'authority_code': result.entry.apple_music_id},
                {'authority_type': DBAuthority.ISRC.name, 'authority_code': result.entry.isrc},
            ],
            normalized_title = result.entry.normalized_core_title,
            artist_ids = list(result.entry.source_artist_authority_ids),
            duration_ms = result.entry.raw_duration,
            extra_details = extra_details,
        )
        result.issues.append(issue)
        summary.issues.append(issue)
        summary.no_candidates += 1

    if not dry_run:
        with connection.transaction():
            for mapping in summary.mappings:
                _apply_mapping_plan(connection, mapping)
            issue_ids_by_entry_id: dict[int, list[int]] = {}
            for issue in summary.issues:
                issue_id = _insert_issue(connection, issue)
                issue_ids_by_entry_id.setdefault(issue.entry_id, []).append(issue_id)

            applied_groups: list[NewSongGroup] = []
            for group in groups:
                member_entry_ids = sorted({*group.entry_ids, *group.unreviewed_entry_ids})
                group_id = _insert_entry_group(connection, group)
                _insert_entry_group_entries(connection, group_id, member_entry_ids)

                group_issue_ids = tuple(sorted({
                    issue_id
                    for entry_id in group.entry_ids
                    for issue_id in issue_ids_by_entry_id.get(entry_id, [])
                }))
                _insert_entry_group_issues(connection, group_id, group_issue_ids)
                applied_groups.append(
                    NewSongGroup(
                        entry_ids = group.entry_ids,
                        group_id = group_id,
                        unreviewed_entry_ids = group.unreviewed_entry_ids,
                        issue_ids = group_issue_ids,
                        isrcs = group.isrcs,
                        normalized_core_titles = group.normalized_core_titles,
                        min_duration_ms = group.min_duration_ms,
                        max_duration_ms = group.max_duration_ms,
                    )
                )

            summary.new_song_groups = applied_groups

    return summary

def reject_entry_mapping(
    connection: psycopg.Connection,
    entry_id: int,
    song_id: int,
    *,
    changed_by: str = MATCHER_NAME,
    reason: str | None = None,
    _inside_transaction: bool = False,
) -> None:
    def reject_mapping() -> None:
        old = get_entry_mapping(connection, entry_id, song_id)
        if old is None or old['status'] == DBStatus.REJECTED.value:
            return

        with connection.cursor() as cur:
            cur.execute("""--sql
                UPDATE entry_mapping
                SET status = %s,
                    match_method = %s
                WHERE entry_id = %s
                  AND song_id = %s
            """, (DBStatus.REJECTED.value, DBMethod.MANUAL.value, entry_id, song_id))

        new = get_entry_mapping(connection, entry_id, song_id)
        _insert_change_log(
            connection,
            table_name = 'entry_mapping',
            row_pk = {'entry_id': entry_id, 'song_id': song_id},
            operation = 'UPDATE',
            old_data = old,
            new_data = new,
            changed_by = changed_by,
            reason = reason,
        )

    if not _inside_transaction:
        ensure_matching_schema(connection)
    if _inside_transaction:
        reject_mapping()
    else:
        with connection.transaction():
            reject_mapping()
