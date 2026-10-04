module.exports = { groupSql: (buildSongJoins, buildSongProjection) => `      SELECT
        eg.group_id,
        eg.status,
        eg.canonical_song_id,
        eg.match_method,
        eg.confidence,
        eg.details,
        eg.created_at,
        eg.resolved_at,
        COALESCE(entries.entries, '[]'::jsonb) AS entries,
        COALESCE(issues.issues, '[]'::jsonb) AS issues,
        ${buildSongProjection()}

      FROM entry_group eg
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'entry_id', e.entry_id,
            'source_id', e.source_id,
            'source_item_id', e.source_item_id,
            'source_type', src.source_type,
            'source_file', src.source_file,
            'raw_title', e.raw_title,
            'raw_artist', e.raw_artist,
            'raw_album', e.raw_album,
            'raw_duration', e.raw_duration,
            'entry_artwork', COALESCE(
              e.raw_json ->> 'album_artwork',
              e.raw_json #>> '{albums,0,artwork}'
            )
          )
          ORDER BY e.entry_id
        ) AS entries
        FROM entry_group_entries ege
        JOIN entries e
          ON e.entry_id = ege.entry_id
        JOIN sources src
          ON src.source_id = e.source_id
        WHERE ege.group_id = eg.group_id
      ) entries ON TRUE
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'issue_id', ei.issue_id,
            'entry_id', ei.entry_id,
            'song_id', ei.song_id,
            'match_method', ei.match_method,
            'reason', ei.reason,
            'details', ei.details,
            'created_at', ei.created_at,
            'resolved_at', ei.resolved_at
          )
          ORDER BY ei.resolved_at NULLS FIRST, ei.issue_id
        ) AS issues
        FROM entry_group_issues egi
        JOIN entry_issues ei
          ON ei.issue_id = egi.issue_id
        WHERE egi.group_id = eg.group_id
      ) issues ON TRUE
      ${buildSongJoins('eg.canonical_song_id')}
    ` };
