"""
Seed initial page documentation for the inline help system.

Run with:
    python -m seeds.seed_page_docs

This creates default documentation for all pages in all organizations.
Admins can customize the documentation through the UI.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import Organization, OrgScopedDoc


# Default documentation content for each page
DEFAULT_DOCS = {
    "flow.overview": {
        "title": "Pipeline Overview",
        "summary": "Monitor your data pipelines at a glance",
        "body_markdown": """## Overview

The Pipeline Overview provides a high-level view of your data integration pipelines and their current status.

### What You'll See

- **Pipeline Status**: Visual indicators showing which pipelines are active, paused, or have errors
- **Recent Activity**: A timeline of recent runs and their outcomes
- **Quick Actions**: Start manual runs or access pipeline configuration

### Getting Started

1. Review your active pipelines in the main view
2. Click on any pipeline card to see detailed information
3. Use the "Run Now" button to trigger a manual sync

### Tips

- Green indicators mean the pipeline ran successfully
- Yellow indicates warnings that may need attention
- Red indicates errors that require investigation
"""
    },
    "runs.list": {
        "title": "Run History",
        "summary": "View and manage all pipeline execution runs",
        "body_markdown": """## Run History

This page shows a complete history of all pipeline runs across your organization.

### Understanding Run Status

- **Completed**: The run finished successfully
- **Running**: Currently in progress
- **Failed**: The run encountered an error
- **Cancelled**: The run was manually stopped

### Filtering Runs

Use the filters at the top to narrow down runs by:
- Pipeline name
- Status
- Date range
- Trigger type (scheduled, manual, or source-triggered)

### Actions

- Click any run to view detailed logs and entity changes
- Use "Run Now" to trigger a new run for any pipeline
"""
    },
    "runs.detail": {
        "title": "Run Details",
        "summary": "Detailed view of a specific pipeline run",
        "body_markdown": """## Run Details

This page shows comprehensive information about a specific pipeline run.

### Overview Section

- **Status**: Current state of the run
- **Duration**: How long the run took
- **Trigger**: What initiated this run
- **Counts**: Entities processed, created, updated, and skipped

### Entity Changes

View all entities that were affected by this run:
- **Created**: New entities added to your canonical store
- **Updated**: Existing entities that were modified
- **Unchanged**: Entities that matched existing data

### Logs

The logs section shows detailed execution information, useful for debugging issues.

### Tips

- Use the diff view to see exactly what changed for each entity
- Export results for further analysis
"""
    },
    "datasets.list": {
        "title": "Datasets",
        "summary": "Manage your canonical data collections",
        "body_markdown": """## Datasets

Datasets are collections of canonical entities organized by type or purpose.

### What is a Dataset?

A dataset groups related entities together. For example:
- "Artworks" - All artwork records from your collections
- "Artists" - Biographical information about creators
- "Exhibitions" - Past and upcoming exhibitions

### Managing Datasets

- **View**: Click any dataset to see its entities
- **Configure**: Adjust display fields and visibility settings
- **Export**: Download dataset contents in various formats

### Dataset Statistics

Each dataset card shows:
- Total entity count
- Last updated timestamp
- Source pipeline information
"""
    },
    "datasets.detail": {
        "title": "Dataset Details",
        "summary": "Explore and manage entities within a dataset",
        "body_markdown": """## Dataset Details

This page lets you explore all entities within a specific dataset.

### Browsing Entities

- Use the search bar to find specific entities
- Apply filters to narrow results
- Sort by any visible field

### Entity Cards

Each entity card shows:
- Key identifying information
- Thumbnail image (if available)
- Quick actions menu

### Bulk Actions

Select multiple entities to:
- Export selected items
- Compare entity data
- View change history

### Display Fields

Customize which fields appear on entity cards using the display settings.
"""
    },
    "entities.search": {
        "title": "Entity Search",
        "summary": "Search across all your canonical entities",
        "body_markdown": """## Entity Search

Search across all entities in your organization, regardless of dataset.

### Search Tips

- Use quotes for exact phrases: "Vincent van Gogh"
- Search specific fields: title:Sunflowers
- Combine terms: painting AND 1888

### Filters

Narrow results by:
- Dataset
- Entity type
- Date ranges
- Custom fields

### Results

Search results show:
- Matching entities with highlighted terms
- Dataset and type information
- Quick preview on hover
"""
    },
    "entities.detail": {
        "title": "Entity Details",
        "summary": "Complete view of a single entity",
        "body_markdown": """## Entity Details

View all information about a specific canonical entity.

### Sections

- **Overview**: Key identifying information
- **Properties**: All entity attributes
- **Media**: Images and other media files
- **History**: Change log over time
- **Related**: Connected entities

### Actions

- **Edit**: Modify entity data (if permitted)
- **Export**: Download entity in various formats
- **Compare**: View differences between versions

### Change History

See when and how this entity was modified, including:
- Source of each change
- Before/after values
- User who triggered the sync
"""
    },
    "setup.wizard": {
        "title": "Setup",
        "summary": "Configure your data integration environment",
        "body_markdown": """## Setup Overview

The Setup section helps you configure and manage your data integration environment.

### Getting Started

1. **Connectors**: Set up connections to your data sources and destinations
2. **Pipelines**: Create data flows between connectors
3. **Datasets**: Organize your canonical data
4. **Display Fields**: Customize how data appears

### Quick Links

- Add a new connector
- Create a pipeline
- Configure schedules
- Manage transformations
"""
    },
    "setup.connectors": {
        "title": "Connectors",
        "summary": "Manage data source and destination connections",
        "body_markdown": """## Connectors

Connectors link Madrona to your external data sources and destinations.

### Connector Types

- **Sources**: Where data comes from (APIs, databases, files)
- **Destinations**: Where data goes (spreadsheets, databases, APIs)

### Adding a Connector

1. Click "Add Connector"
2. Select the connector type
3. Enter required credentials
4. Test the connection
5. Save and activate

### Managing Connectors

- **Test**: Verify the connection works
- **Edit**: Update credentials or settings
- **Disable**: Temporarily stop data flow
- **Delete**: Remove the connector entirely
"""
    },
    "setup.pipelines": {
        "title": "Pipelines",
        "summary": "Configure data flow between connectors",
        "body_markdown": """## Pipelines

Pipelines define how data flows from sources to your canonical store.

### Creating a Pipeline

1. Select a source connector
2. Choose which data to sync
3. Configure transformation rules
4. Set up a schedule (optional)
5. Activate the pipeline

### Pipeline Settings

- **Schedule**: When to automatically run
- **Transformations**: How to map and transform data
- **Filters**: Which records to include/exclude
- **Error Handling**: What to do when issues occur

### Monitoring

View pipeline health including:
- Recent run status
- Success/failure rates
- Average run duration
"""
    },
    "pipelines.detail": {
        "title": "Pipeline Configuration",
        "summary": "Detailed pipeline settings and monitoring",
        "body_markdown": """## Pipeline Configuration

Configure all aspects of a specific pipeline.

### Sections

- **Overview**: Basic pipeline information
- **Source**: Source connector and query settings
- **Mapping**: Field transformations
- **Schedule**: Automated run timing
- **History**: Past run results

### Field Mapping

Define how source fields map to canonical fields:
- Direct mappings
- Transformations
- Default values
- Validation rules

### Scheduling

Set up automatic runs:
- Hourly, daily, or weekly
- Specific times
- Source-triggered (on data change)
"""
    },
    "connectors.settings": {
        "title": "Connector Settings",
        "summary": "Configure connector credentials and options",
        "body_markdown": """## Connector Settings

Manage the configuration for a specific connector.

### Connection Settings

- **Credentials**: API keys, passwords, tokens
- **Endpoint**: URLs and connection strings
- **Options**: Connector-specific settings

### Security

- Credentials are encrypted at rest
- Use test mode before going live
- Rotate credentials regularly

### Troubleshooting

If connection fails:
1. Verify credentials are correct
2. Check network connectivity
3. Review API rate limits
4. Contact support if issues persist
"""
    },
    "admin.users": {
        "title": "User Management",
        "summary": "Manage organization members and permissions",
        "body_markdown": """## User Management

Manage who has access to your organization and what they can do.

### Roles

- **Admin**: Full access to all features
- **Engineer**: Configure pipelines and connectors
- **Analyst**: Query and export data
- **Viewer**: Read-only access

### Actions

- **Invite**: Send invitation to new members
- **Edit**: Change a member's role
- **Remove**: Revoke access

### Best Practices

- Use the principle of least privilege
- Review access regularly
- Remove inactive users promptly
"""
    },
    "admin.email-events": {
        "title": "Email Events",
        "summary": "Monitor email delivery and notifications",
        "body_markdown": """## Email Events

Track all emails sent by the system.

### Event Types

- **Sent**: Email was delivered successfully
- **Bounced**: Email could not be delivered
- **Complained**: Recipient marked as spam

### Troubleshooting

If emails aren't being received:
1. Check the recipient's spam folder
2. Verify the email address is correct
3. Review bounce messages for details
4. Contact support for persistent issues
"""
    },
    "settings.user": {
        "title": "User Settings",
        "summary": "Manage your personal account settings",
        "body_markdown": """## User Settings

Configure your personal account preferences.

### Profile

- Display name
- Email address
- Timezone

### Security

- Change password
- Enable two-factor authentication
- View active sessions

### Notifications

Configure which notifications you receive:
- Run completions
- Error alerts
- System updates
"""
    },
}


def seed_page_docs():
    """Create default documentation for all organizations."""
    settings = Settings()
    engine = create_engine(settings.database_url.unicode_string())

    with Session(engine) as session:
        # Get all organizations
        organizations = session.query(Organization).filter(
            Organization.status == "active"
        ).all()

        if not organizations:
            print("No active organizations found. Skipping documentation seeding.")
            return

        docs_created = 0
        docs_skipped = 0

        for org in organizations:
            print(f"\nOrganization: {org.name} ({org.slug})")
            print("-" * 50)

            for page_key, content in DEFAULT_DOCS.items():
                # Check if doc already exists
                existing = session.query(OrgScopedDoc).filter(
                    OrgScopedDoc.organization_id == org.organization_id,
                    OrgScopedDoc.page_key == page_key
                ).first()

                if existing:
                    print(f"  ✓ {page_key} (exists)")
                    docs_skipped += 1
                    continue

                # Create new doc
                doc = OrgScopedDoc(
                    organization_id=org.organization_id,
                    page_key=page_key,
                    title=content["title"],
                    summary=content["summary"],
                    body_markdown=content["body_markdown"],
                    audience="all",
                )
                session.add(doc)
                docs_created += 1
                print(f"  + {page_key} (created)")

        session.commit()

        print("\n" + "=" * 60)
        print(f"Created {docs_created} documentation entries")
        print(f"Skipped {docs_skipped} existing entries")
        print("=" * 60)


if __name__ == "__main__":
    seed_page_docs()
