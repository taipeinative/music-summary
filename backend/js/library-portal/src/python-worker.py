'''Dedicated Portal transaction owner. Credentials travel over stdin, never argv.'''
import json
import re
import sys
from pathlib import Path
from datetime import date, datetime
from decimal import Decimal

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'py'))
import psycopg
from psycopg.rows import dict_row
from music_db import matching

TABLES = json.loads(Path(__file__).with_name('audit-tables.json').read_text())


def encode(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    raise TypeError(type(value).__name__)


def audit(connection, metadata):
    for table, keys in TABLES.items():
        join = ' AND '.join(f'o.{key} = n.{key}' for key in keys)
        pk = ', '.join(f"'{key}', COALESCE(to_jsonb(n)->'{key}', to_jsonb(o)->'{key}')" for key in keys)
        connection.execute(f'''INSERT INTO change_log(table_name,row_pk,operation,old_data,new_data,changed_by,reason)
            SELECT %s, jsonb_build_object({pk}),
                CASE WHEN o.{keys[0]} IS NULL THEN 'INSERT' WHEN n.{keys[0]} IS NULL THEN 'DELETE' ELSE 'UPDATE' END,
                to_jsonb(o), to_jsonb(n), %s, %s
            FROM audit_before_{table} o FULL JOIN public.{table} n ON {join}
            WHERE to_jsonb(o) IS DISTINCT FROM to_jsonb(n)''',
            (table, metadata['changedBy'], metadata['reason']))


def main():
    connection = None
    metadata = None
    # Only this short-lived API process replaces scattered legacy log calls.
    matching._insert_change_log = lambda *args, **kwargs: None
    matching.ensure_matching_schema = lambda connection: None
    try:
        for line in sys.stdin:
            try:
                message = json.loads(line)
                command = message['command']
                response = {'rows': []}
                if command == 'begin':
                    config = message['config']
                    metadata = message['metadata']
                    if not metadata.get('changedBy') or not metadata.get('reason'):
                        raise ValueError('Audit metadata is required')
                    connection = psycopg.connect(host=config['host'], port=config['port'], dbname=config['database'], user=config['user'], password=config['password'])
                    connection.execute("SET LOCAL lock_timeout = '15s'")
                    connection.execute('LOCK TABLE ' + ', '.join(f'public.{table}' for table in TABLES) + ' IN SHARE ROW EXCLUSIVE MODE')
                    for table in TABLES:
                        connection.execute(f'CREATE TEMP TABLE audit_before_{table} ON COMMIT DROP AS SELECT * FROM public.{table}')
                elif command == 'query':
                    params = []
                    def parameter(match):
                        params.append(message['params'][int(match[1]) - 1])
                        return '%s'
                    sql = re.sub(r'\$(\d+)', parameter, message['sql'].replace('%', '%%'))
                    with connection.cursor(row_factory=dict_row) as cursor:
                        cursor.execute(sql, params)
                        if cursor.description:
                            response['rows'] = cursor.fetchall()
                        response['rowCount'] = cursor.rowcount
                elif command == 'confirm':
                    for mapping in message['mappings']:
                        matching.confirm_entry_mapping(connection, int(mapping['entryId']), int(mapping['songId']), changed_by=metadata['changedBy'], reason=metadata['reason'])
                elif command == 'commit':
                    audit(connection, metadata)
                    connection.commit()
                elif command == 'rollback':
                    connection.rollback()
                else:
                    raise ValueError('Unknown worker command')
                print(json.dumps(response, default=encode), flush=True)
            except Exception as error:
                if connection:
                    connection.rollback()
                print(json.dumps({'error': str(error)}), flush=True)
    finally:
        if connection:
            connection.close()


if __name__ == '__main__':
    main()
