from __future__ import annotations

import argparse
from datetime import datetime
import json
from pathlib import Path
import sys

from music_db.matching import (
    DEFAULT_FUZZY_LIMIT,
    DEFAULT_MIN_FUZZY_CONFIDENCE,
    match_source,
)
from music_db.query import get_source_by_file
import psycopg

BACKEND_DIR = Path(__file__).resolve().parents[1]
DEFAULT_LOG_PATH = BACKEND_DIR / 'log' / 'match.log'

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding = 'utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding = 'utf-8')


def main() -> int:
    parser = argparse.ArgumentParser(description = 'Match imported Apple Music entries against canonical songs.')
    parser.add_argument('--host', required = True, help = 'Host server address.')
    parser.add_argument('--dbname', required = True, help = 'The database name.')
    parser.add_argument('--user', required = True, help = 'The user name.')
    parser.add_argument('--password', required = True, help = 'The password of the user.')

    source = parser.add_mutually_exclusive_group(required = True)
    source.add_argument('--source-id', type = int, help = 'The imported Apple Music source_id to match.')
    source.add_argument('--source-file', help = 'The normalized source_file value to resolve and match.')

    parser.add_argument('--apply', action = 'store_true', help = 'Write planned mappings and review issues.')
    parser.add_argument('--no-fuzzy', action = 'store_true', help = 'Skip fuzzy candidate generation.')
    parser.add_argument('--fuzzy-limit', type = int, default = DEFAULT_FUZZY_LIMIT, help = 'Maximum fuzzy candidates per entry.')
    parser.add_argument('--min-fuzzy-confidence', type = float, default = DEFAULT_MIN_FUZZY_CONFIDENCE, help = 'Minimum fuzzy confidence score.')
    parser.add_argument('--json', action = 'store_true', help = 'Print the summary as JSON.')
    parser.add_argument('--details', action = 'store_true', help = 'Include planned mappings, issues, and new-song groups in the output.')
    parser.add_argument('--no-log', action = 'store_true', help = 'Do not write backend/log/match.log.')
    parser.add_argument('--log-path', default = str(DEFAULT_LOG_PATH), help = 'Path to the matching log file.')

    if len(sys.argv) == 1:
        parser.print_help()
        return 0

    args = parser.parse_args()
    started_at = datetime.now().astimezone()

    try:
        with psycopg.connect(
            host = args.host,
            dbname = args.dbname,
            user = args.user,
            password = args.password,
        ) as conn:
            source_id = args.source_id
            if source_id is None:
                source_id = get_source_by_file(conn, args.source_file)
                if source_id is None:
                    raise ValueError(f'Unknown source_file: {args.source_file}')

            summary = match_source(
                conn,
                source_id,
                dry_run = not args.apply,
                include_fuzzy = not args.no_fuzzy,
                fuzzy_limit = args.fuzzy_limit,
                min_fuzzy_confidence = args.min_fuzzy_confidence,
            )

        finished_at = datetime.now().astimezone()
        if not args.no_log:
            _write_summary_log(
                summary.to_dict(include_details = True),
                started_at,
                finished_at,
                Path(args.log_path),
            )

        if args.json:
            print(json.dumps(summary.to_dict(include_details = args.details), ensure_ascii = False, indent = 2))
        else:
            _print_summary(summary.to_dict(include_details = args.details))

    except Exception as ex:
        parser.error(str(ex))
        return 2

    return 0


def _format_summary_lines(summary: dict) -> list[str]:
    mode = 'dry-run' if summary['dry_run'] else 'apply'
    lines = [
        f'> Source {summary["source_id"]} matching summary ({mode})',
        f'>   Total entries: {summary["total_entries"]}',
        f'>   Confirmed mappings: {summary["confirmed_mappings"]}',
        f'>     Apple Music ID: {summary["apple_confirmed"]}',
        f'>     ISRC: {summary["isrc_confirmed"]}',
        f'>     Title / artist / duration: {summary["exact_confirmed"]}',
        f'>   Pending mappings: {summary["pending_mappings"]}',
        f'>   Fuzzy candidates: {summary["fuzzy_candidates"]}',
        f'>   New-song groups: {summary["new_song_groups"]}',
        f'>   Unreviewed A entry matches: {summary["unreviewed_entry_matches"]}',
        f'>   No canonical candidate: {summary["no_candidates"]}',
        f'>   Review issues planned: {summary["planned_issues"]}',
        f'>     Authority conflicts: {summary["authority_conflicts"]}',
        f'>     Artist conflicts: {summary["artist_conflicts"]}',
        f'>     Title conflicts: {summary["title_conflicts"]}',
        f'>     Duration conflicts: {summary["duration_conflicts"]}',
        f'>     Multiple candidates: {summary["multiple_candidates"]}',
    ]

    if 'mappings' in summary:
        lines.append('>   Planned mappings:')
        for mapping in summary['mappings']:
            lines.append(
                f'>     entry {mapping["entry_id"]} -> song {mapping["song_id"]} '
                f'[{mapping["status"]}, {mapping["match_method"]}, {mapping["confidence"]:.4f}]'
            )

    if 'groups' in summary:
        lines.append('>   New-song groups:')
        for group in summary['groups']:
            lines.append(
                f'>     entries {group["entry_ids"]}; '
                f'unreviewed A {group["unreviewed_entry_ids"]}; '
                f'ISRC {group["isrcs"]}'
            )

    if 'issues' in summary:
        lines.append('>   Review issues:')
        for issue in summary['issues']:
            issue_song_id = issue['song_id'] if issue['song_id'] is not None else '-'
            issue_method = issue['match_method'] if issue['match_method'] is not None else '-'
            lines.append(
                f'>     entry {issue["entry_id"]} / song {issue_song_id} '
                f'[{issue["reason"]}, method {issue_method}]'
            )

    return lines


def _print_summary(summary: dict) -> None:
    for line in _format_summary_lines(summary):
        print(line)


def _write_summary_log(summary: dict, started_at: datetime, finished_at: datetime, log_path: Path) -> None:
    log_path = log_path.resolve()
    log_path.parent.mkdir(parents = True, exist_ok = True)

    previous_path = log_path.with_name('match-prev.log')
    if log_path.exists():
        log_path.replace(previous_path)

    elapsed = finished_at - started_at
    lines = [
        '# Match report',
        f'Run started: {started_at.isoformat(timespec = "seconds")}',
        f'Run finished: {finished_at.isoformat(timespec = "seconds")}',
        f'Elapsed seconds: {elapsed.total_seconds():.3f}',
        '',
        '## Dry-run report' if summary['dry_run'] else '## Apply report',
        *_format_summary_lines(summary),
        ''
    ]
    log_path.write_text('\n'.join(lines), encoding = 'utf-8')


if __name__ == '__main__':
    main()
