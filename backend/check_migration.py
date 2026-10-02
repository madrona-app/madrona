#!/usr/bin/env python3
"""Check if data has been migrated to route_sources/destinations tables."""

from sqlalchemy import create_engine, text
from app.config import Settings
import os

settings = Settings()
engine = create_engine(str(settings.database_url))

with engine.connect() as conn:
    # Check pipeline_sources count
    sources_count = conn.execute(text('SELECT COUNT(*) FROM flow.pipeline_sources')).scalar()
    print(f'pipeline_sources table has {sources_count} rows')

    # Check pipeline_destinations count
    destinations_count = conn.execute(text('SELECT COUNT(*) FROM flow.pipeline_destinations')).scalar()
    print(f'pipeline_destinations table has {destinations_count} rows')

    # Check pipelines
    routes_result = conn.execute(text('''
        SELECT COUNT(*) as total
        FROM flow.pipelines
    ''')).fetchone()

    print(f'\npipelines table:')
    print(f'  Total pipelines: {routes_result[0]}')

    # Check a specific pipeline to see if it has entries in both tables
    if routes_result[0] > 0:
        print('\n Sample pipeline with sources and destinations:')
        sample = conn.execute(text('''
            SELECT
                p.pipeline_id,
                (SELECT COUNT(*) FROM flow.pipeline_sources ps WHERE ps.pipeline_id = p.pipeline_id) as sources_count,
                (SELECT COUNT(*) FROM flow.pipeline_destinations pd WHERE pd.pipeline_id = p.pipeline_id) as destinations_count
            FROM flow.pipelines p
            LIMIT 3
        ''')).fetchall()

        for row in sample:
            print(f'  Pipeline {row[0]}: {row[1]} sources, {row[2]} destinations')
