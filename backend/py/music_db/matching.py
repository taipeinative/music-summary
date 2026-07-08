from __future__ import annotations

from dataclasses import dataclass, field
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
    get_song_ids_by_authority,
    get_song_ids_by_duration_window,
    get_song_ids_by_title_and_duration,
    get_source_entries,
    get_source_type,
    get_unreviewed_legacy_entry_ids,
)
from music_db.schema import CHANGE_LOG_TABLE, ENTRY_ISSUES_TABLE, ENTRY_MAPPING_TABLE, create
from music_db.typing import DBAuthority, DBMethod, DBStatus, Issue, IssueReason
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
                    'entry_ids': list(group.entry_ids),
                    'unreviewed_entry_ids': list(group.unreviewed_entry_ids),
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
    unreviewed_entry_ids: tuple[int, ...] = ()
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

def _get_non_empty_string(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None

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
            Jsonb(dict(row_pk)),
            operation,
            Jsonb(dict(old_data)) if old_data is not None else None,
            Jsonb(dict(new_data)) if new_data is not None else None,
            changed_by,
            reason,
        ))

def _insert_issue(connection: psycopg.Connection, issue: Issue) -> None:
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
        if cur.fetchone() is not None:
            return

        cur.execute("""--sql
            INSERT INTO entry_issues(entry_id, song_id, match_method, reason, details)
            VALUES (%s, %s, %s, %s, %s)
        """, (row['entry_id'], row['song_id'], row['match_method'], row['reason'], Jsonb(row['details'])))

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

def _load_source_entries(connection: psycopg.Connection, source_id: int) -> list[SourceEntry]:
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
        for row in get_source_entries(connection, source_id)
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

def confirm_entry_mapping(
    connection: psycopg.Connection,
    entry_id: int,
    song_id: int,
    *,
    changed_by: str = MATCHER_NAME,
    reason: str | None = None,
) -> None:
    ensure_matching_schema(connection)
    with connection.transaction():
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

def ensure_matching_schema(connection: psycopg.Connection) -> None:
    create(connection, ENTRY_MAPPING_TABLE)
    create(connection, ENTRY_ISSUES_TABLE)
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
            for issue in summary.issues:
                _insert_issue(connection, issue)

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
