"""
Seed roles, permissions, and role_permissions.

Creates:
- 5 system roles (admin, registrar, curator, publisher, viewer)
- 208 permissions
- 610 role-permission mappings

Run with:
    python -m seeds.seed_roles_and_permissions

Idempotent: uses ON CONFLICT DO NOTHING for all inserts.
"""

import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.config import Settings


# ---------------------------------------------------------------------------
# Roles: (role_id, role_key, display_name, description, is_system)
# ---------------------------------------------------------------------------
ROLES = [
    ("48576483-cc7e-4e38-b918-433922e0a82c", "admin", "Admin", "Full access to all organization features", True),
    ("dd4b9093-97e8-4155-aa9b-3a59402e1c5b", "curator", "Curator", "Research, document, and manage collections knowledge", True),
    ("a1b2c3d4-e5f6-7890-abcd-ef1234567890", "platform_admin", "Platform Admin", "Cross-org provisioning and platform management", True),
    ("49194715-8125-43cf-b720-8783f67fa76a", "publisher", "Publisher", "Publish media and manage digital assets", True),
    ("59cae413-d07c-42eb-9ce2-9f8c5bd67831", "registrar", "Registrar", "Manage object movement, loans, and legal compliance", True),
    ("b6db0e2a-7d7d-4e5c-8423-5979bdae0c76", "viewer", "Viewer", "Read-only access", True),
]


# ---------------------------------------------------------------------------
# Permissions: (permission_id, permission_key, scope, action, display_name, description)
# ---------------------------------------------------------------------------
PERMISSIONS = [
    ("e8339919-194f-4687-a00a-8158b01dba52", "acquisitions.approve", "acquisitions", "approve", "Approve Acquisitions", "Approve acquisitions for accessioning"),
    ("874dc3d1-9b33-44be-8486-2bf1e91c3bf9", "acquisitions.create", "acquisitions", "create", "Create Acquisitions", "Create new acquisition proposals"),
    ("82d6cfdd-f5e6-42fd-bdfd-5a33e89f3c7a", "acquisitions.edit", "acquisitions", "edit", "Edit Acquisitions", "Edit acquisition records"),
    ("f3a1b2c4-d5e6-4f78-9a0b-c1d2e3f4a5b6", "acquisitions.rollback", "acquisitions", "rollback", "Rollback Acquisitions", "Revert acquisition status to a previous step"),
    ("86f68580-641a-4ee8-9e54-f77668f29676", "acquisitions.view", "acquisitions", "view", "View Acquisitions", "View acquisition and accessioning records"),
    ("694d7086-0a71-4518-813b-f09d83ca6894", "audits.approve", "audits", "approve", "Approve Audits", "Approve audit campaigns"),
    ("97c4506a-372b-42e2-82e7-000caabee4e5", "audits.create", "audits", "create", "Create Audits", "Create audit campaigns"),
    ("b51fdded-cf73-45ab-b576-f3784e6591e9", "audits.edit", "audits", "edit", "Edit Audits", "Edit audit campaigns and results"),
    ("e86c2cd9-fbf8-4585-a2f6-86fa607c885b", "audits.view", "audits", "view", "View Audits", "View audit campaigns"),
    ("5f914af8-0b7d-4435-9d5d-1fb9707d4183", "authorities.create", "authorities", "create", "Create Authorities", "Create new authority records"),
    ("dc2e5cd2-7219-416a-b6db-f047d314a603", "authorities.delete", "authorities", "delete", "Delete Authorities", "Delete authority records"),
    ("77dc8227-7659-4545-99f0-26ea0892be3b", "authorities.edit", "authorities", "edit", "Edit Authorities", "Edit authority records"),
    ("78a3a99f-c520-4778-a180-4c263f26ac26", "authorities.merge", "authorities", "merge", "Merge Authorities", "Merge duplicate authority records"),
    ("af854ecd-2658-4854-93e8-3dfaea769bf7", "authorities.view", "authorities", "view", "View Authorities", "View person and corporate body authority records"),
    ("cb56fc18-49be-4f5f-95c6-874ff301c488", "branding.edit", "branding", "edit", "Edit Branding", "Edit organization branding settings including logo upload"),
    ("2e46e8d4-c226-4e07-839c-cc928031edf3", "branding.view", "branding", "view", "View Branding", "View organization branding settings"),
    ("8e9d74d0-a3b6-4f71-950f-03f63e06dd07", "cataloging_history.create", "cataloging_history", "create", "Create Cataloging History", "Create cataloging history entries"),
    ("aeb8acd5-8a6d-4299-9ea7-45d8a2eafd4d", "cataloging_history.view", "cataloging_history", "view", "View Cataloging History", "View record change history"),
    ("83d65440-db40-4e76-9666-b2ad7742b0b6", "citations.edit", "citations", "edit", "Edit Citations", "Create, modify, and delete citations"),
    ("1e6bf17e-6c39-41f7-a584-dda31940c2a7", "citations.view", "citations", "view", "View Citations", "View bibliographic citations"),
    ("bd301036-c78d-4c0b-8216-39f16d370481", "collections.create", "collections", "create", "Create Collections", "Create new collection objects"),
    ("ffffcfce-71f0-48d5-bc4e-1127ff83dd22", "collections.delete", "collections", "delete", "Delete Collections", "Delete collection objects"),
    ("0dbd71fd-6d13-4d0e-83bf-0bb2c359873c", "collections.edit", "collections", "edit", "Edit Collections", "Edit existing collection objects"),
    ("7fcd98ff-a757-4a88-af68-06fd8d23fb0c", "collections.view", "collections", "view", "View Collections", "View collection objects and their details"),
    ("4c657c2d-cb56-4b06-9cab-c21f3985db59", "condition_reports.create", "condition_reports", "create", "Create Condition Reports", "Create new condition reports"),
    ("6e3a9f12-d4b7-4c8e-a5f1-9b2d7e8c3a4f", "condition_reports.delete", "condition_reports", "delete", "Delete Condition Reports", "Delete condition reports"),
    ("35ccad6c-7e57-43fe-ac92-bd2d325b0879", "condition_reports.edit", "condition_reports", "edit", "Edit Condition Reports", "Edit condition reports"),
    ("95638b16-e26b-4d11-a4ba-3b062e09daec", "condition_reports.review", "condition_reports", "review", "Review Condition Reports", "Approve and finalize condition reports"),
    ("f261350b-53aa-468e-b357-724bc759966f", "condition_reports.view", "condition_reports", "view", "View Condition Reports", "View condition check and examination reports"),
    ("08d8bda4-727a-4f9d-9ab2-cf9c2572952f", "connectors.edit", "connectors", "edit", "Edit Connectors", "Create, modify, and delete connector instances"),
    ("4a2f7f9b-82d1-4290-b9e9-c5371d5ad75f", "connectors.view", "connectors", "view", "View Connectors", "View connector definitions and instances"),
    ("045fb97b-fa0a-499b-a53e-667d84a77eac", "conservation.approve", "conservation", "approve", "Approve Conservation", "Approve conservation treatments"),
    ("4aaf0356-c96a-4187-9371-494912410d1c", "conservation.create", "conservation", "create", "Create Conservation", "Create conservation treatment proposals"),
    ("e5162b32-5546-4521-94be-9616baae7c7c", "conservation.edit", "conservation", "edit", "Edit Conservation", "Edit conservation treatment records"),
    ("1ef7b905-27ea-4ee5-afce-88bad793f024", "conservation.view", "conservation", "view", "View Conservation", "View conservation treatment records"),
    ("86f409d2-fea2-4891-9a8a-29c50757ce5b", "contacts.edit", "contacts", "edit", "Edit Contacts", "Create, modify, and delete contacts"),
    ("d8b45ab8-391f-4d33-8db1-f6244a5a2ac3", "contacts.view", "contacts", "view", "View Contacts", "View external contacts (depositors, lenders, borrowers, conservators)"),
    ("364ecc02-f4d4-4520-af95-0dd2cfb092c3", "critical_responses.create", "critical_responses", "create", "Create Critical Responses", "Create scholarly commentary records"),
    ("2a51ce2f-d48d-4490-bf07-8d9a40d8171f", "critical_responses.delete", "critical_responses", "delete", "Delete Critical Responses", "Delete scholarly commentary records"),
    ("30a61a4a-24aa-47d3-b20f-5ef9d80e4fa2", "critical_responses.edit", "critical_responses", "edit", "Edit Critical Responses", "Edit scholarly commentary records"),
    ("4b07f8f0-1746-475b-9411-277444a4d4e6", "critical_responses.view", "critical_responses", "view", "View Critical Responses", "View scholarly commentary records"),
    ("7478fa4b-4dff-46f1-8c5f-e787deef14e5", "data.export", "data", "export", "Export Data", "Export entity data in various formats"),
    ("55e5c23b-3de5-4ad6-86ae-74894ea3192e", "data.query", "data", "query", "Query Data", "Query and filter entity data"),
    ("2f60e44a-9ac6-43c3-b333-e2e3b87b435b", "data.view", "data", "view", "View Data", "View canonical entity data"),
    ("4e69cb84-1687-4f0b-a178-494f3eb3c642", "deaccession.approve", "deaccession", "approve", "Approve Deaccessions", "Board-level approval of deaccessions"),
    ("a2045962-dfe9-4764-adff-34b48caa2759", "deaccession.complete", "deaccession", "complete", "Complete Deaccessions", "Finalize and complete deaccession process"),
    ("ae8bb5ec-be25-4d9e-967d-ad741586f729", "deaccession.create", "deaccession", "create", "Create Deaccessions", "Create deaccession proposals"),
    ("e2b03379-e61a-4fee-9048-426a65319d6c", "deaccession.edit", "deaccession", "edit", "Edit Deaccessions", "Edit deaccession proposals"),
    ("60f5c2e9-05d5-4e22-8412-c8f5f4dfc040", "deaccession.review", "deaccession", "review", "Review Deaccessions", "Conduct committee review of deaccession proposals"),
    ("a7b8c9d0-e1f2-4a3b-5c6d-7e8f9a0b1c2d", "deaccession.rollback", "deaccession", "rollback", "Rollback Deaccessions", "Revert deaccession status to a previous step"),
    ("da4caf21-f22a-45ea-acc3-7a0406e25c00", "deaccession.view", "deaccession", "view", "View Deaccessions", "View deaccession proposals and records"),
    ("e7d98fd4-7696-44a5-902f-78fbde7fe3cc", "documentation_plans.approve", "documentation_plans", "approve", "Approve Documentation Plans", "Approve documentation plans"),
    ("7673ccc8-fe58-4a76-91db-8e8b75ea67f7", "documentation_plans.create", "documentation_plans", "create", "Create Documentation Plans", "Create documentation plans"),
    ("4c7e5fe0-bdcd-45a1-b2de-849a5baa6e69", "documentation_plans.edit", "documentation_plans", "edit", "Edit Documentation Plans", "Edit documentation plans"),
    ("1295f3c9-2b46-420c-97ab-dc2cdd55514f", "documentation_plans.view", "documentation_plans", "view", "View Documentation Plans", "View documentation plans"),
    ("67c69e1a-d5a3-45ac-af07-74138d620519", "documents.generate", "documents", "generate", "Generate Documents", "Generate PDF documents from collections data"),
    ("bf2571ba-cc01-47aa-9a8f-4887a825f836", "documents.templates.edit", "documents", "templates.edit", "Edit Document Templates", "Create and edit document templates"),
    ("f23ab3a8-13fe-4bcc-b391-d7a20e9c8d81", "documents.templates.view", "documents", "templates.view", "View Document Templates", "View document templates"),
    ("f2a85a4d-833d-40b1-aa51-32ef1203ed5a", "download_requests.create", "download_requests", "create", "Create Download Requests", "Create download requests from lightboxes"),
    ("874c7953-7c52-4dcd-a662-69c54f1a4612", "download_requests.fulfill", "download_requests", "fulfill", "Fulfill Download Requests", "Fulfill approved requests by generating download tokens"),
    ("672c08b7-bb53-490d-bf5c-13dcc9ee7eb2", "download_requests.review", "download_requests", "review", "Review Download Requests", "Review and approve/deny download requests"),
    ("7ac31e8e-692d-4d12-98d8-e3e918e0c871", "download_requests.view", "download_requests", "view", "View Download Requests", "View own download requests (users with review permission can see all)"),
    ("b3dd8b61-e880-4518-bc73-32744694bbc0", "emergency_plans.approve", "emergency_plans", "approve", "Approve Emergency Plans", "Approve emergency plans"),
    ("d18c443a-d8ee-41d2-8223-71ed3689b0c8", "emergency_plans.create", "emergency_plans", "create", "Create Emergency Plans", "Create emergency plans"),
    ("094d475f-e743-405a-8f46-3b0b80e35eed", "emergency_plans.edit", "emergency_plans", "edit", "Edit Emergency Plans", "Edit emergency plans"),
    ("04631d7d-69c4-4219-8169-84e081fa812e", "emergency_plans.view", "emergency_plans", "view", "View Emergency Plans", "View emergency preparedness plans"),
    ("c2567cc1-69c1-4d44-900a-7dcb1a4d12df", "entries.create", "entries", "create", "Create Object Entries", "Create new object entry records"),
    ("5a04d2e9-ce99-4cd6-8714-481a629eedaa", "entries.edit", "entries", "edit", "Edit Object Entries", "Edit and process object entries"),
    ("2e5e860c-b6ee-4720-84fc-f5bebad14e78", "entries.view", "entries", "view", "View Object Entries", "View incoming object entry records"),
    ("98f90790-6463-4b6c-90d6-b6447dbe7cc4", "events.edit", "events", "edit", "Edit Events", "Create, edit, and delete events"),
    ("72b01440-2a9b-423a-a20e-96ac0c279e5d", "events.view", "events", "view", "View Events", "View event records and their details"),
    ("502bc88e-e850-4c3c-a29c-db2b7588efe0", "exhibit.content.edit", "exhibit", "content_edit", "Edit Content", "Create and edit interpretive content blocks"),
    ("f1fce107-4907-44d3-adfd-f2cfe4552758", "exhibit.content.publish", "exhibit", "content_publish", "Publish Content", "Publish content blocks for public view"),
    ("3aa7cafa-6865-46d3-a86e-a931247fedfc", "exhibit.content.view", "exhibit", "content_view", "View Content", "View interpretive content blocks"),
    ("cb59f322-935c-42ae-8260-da937e20732d", "exhibit.create", "exhibit", "create", "Create Exhibitions", "Create new exhibitions"),
    ("0b257918-5e7a-436a-8050-984ba83b16cf", "exhibit.delete", "exhibit", "delete", "Delete Exhibitions", "Delete exhibitions"),
    ("1f22f65d-34bf-4f22-9c2c-adcea2853ce7", "exhibit.edit", "exhibit", "edit", "Edit Exhibitions", "Edit exhibition placements and settings"),
    ("dd8d3aa8-119f-4763-818e-5c5a1ab68069", "exhibit.publish", "exhibit", "publish", "Publish Exhibitions", "Publish exhibitions as public virtual galleries"),
    ("0b5d1b7a-0b3b-4056-a4b2-f128b22c65e5", "exhibit.view", "exhibit", "view", "View Exhibitions", "View exhibitions and virtual galleries"),
    ("5d862e7f-e592-4f31-ba4b-d8a73707264c", "exits.create", "exits", "create", "Create Object Exits", "Create new object exit records"),
    ("d19dc455-8a0d-4658-ba9e-94e39f0725cd", "exits.edit", "exits", "edit", "Edit Object Exits", "Edit and process object exits"),
    ("b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e", "exits.rollback", "exits", "rollback", "Rollback Object Exits", "Revert object exit status to a previous step"),
    ("81c3df67-2b4a-4acc-8fae-d874e5303124", "exits.view", "exits", "view", "View Object Exits", "View object exit records"),
    ("820cb83c-e6a2-4307-a1e4-6e89333d1ccb", "incidents.create", "incidents", "create", "Create Incidents", "Create incident reports"),
    ("820d9159-db98-4455-aba2-1a5c5b017a7b", "incidents.edit", "incidents", "edit", "Edit Incidents", "Edit incident reports"),
    ("f636a4b7-50f4-4eb0-9acc-b03cff9f0c6b", "incidents.investigate", "incidents", "investigate", "Investigate Incidents", "Lead incident investigations"),
    ("ec8022fb-daf5-45fa-b2d7-a04d326657bb", "incidents.resolve", "incidents", "resolve", "Resolve Incidents", "Resolve and close incident reports"),
    ("b90e4e19-718b-44a7-a085-af0096c23fcc", "incidents.view", "incidents", "view", "View Incidents", "View damage and loss incident reports"),
    ("e04f1932-353b-428a-bc1d-6c6364a1273c", "indemnity.create", "indemnity", "create", "Create Indemnity", "Create indemnity arrangements"),
    ("a55eb16a-3468-4784-bc90-c6c715f6c407", "indemnity.edit", "indemnity", "edit", "Edit Indemnity", "Edit indemnity arrangements"),
    ("3ca7189e-9651-4bde-8a4e-6e2a8c2417e1", "indemnity.submit", "indemnity", "submit", "Submit Indemnity", "Submit indemnity applications"),
    ("b144d74f-3155-4420-a08a-d1aa09ff3e27", "indemnity.view", "indemnity", "view", "View Indemnity", "View indemnity arrangements"),
    ("0d5f2194-5673-4d51-92bc-8f540048c5bf", "insurance.approve", "insurance", "approve", "Approve Insurance", "Approve insurance policies"),
    ("45d6de4f-d072-455d-b0fe-1547b12ee2d7", "insurance.claims.create", "insurance", "claims_create", "Create Claims", "Create insurance claims"),
    ("a78586af-dc5f-4361-bb52-c3d52db71574", "insurance.claims.manage", "insurance", "claims_manage", "Manage Claims", "Manage and settle insurance claims"),
    ("42b0f767-54c0-4c70-948a-8aacf40611c1", "insurance.create", "insurance", "create", "Create Insurance", "Create insurance policies and coverages"),
    ("d04574c0-f1fc-4557-8ecb-88cde2970a6b", "insurance.delete", "insurance", "delete", "Delete Insurance", "Delete insurance policies and coverages"),
    ("9945fefd-6409-4c04-bf83-d0f679bfbb01", "insurance.edit", "insurance", "edit", "Edit Insurance", "Edit insurance policies and coverages"),
    ("20949edd-3f51-434e-82ae-516cc9081211", "insurance.view", "insurance", "view", "View Insurance", "View insurance policies and coverages"),
    ("806a0f89-855c-4337-8e5c-c2396695448f", "labels.approve", "labels", "approve", "Approve Labels", "Approve labels for printing"),
    ("ecc6de21-7418-40de-bc20-239f612c77ec", "labels.edit", "labels", "edit", "Edit Labels", "Create and edit label templates and generate labels"),
    ("0948aac0-91e9-4460-ba1e-d688300e843b", "labels.view", "labels", "view", "View Labels", "View exhibition label templates and generated labels"),
    ("b0ebf06d-835c-4346-b8cb-40246f9656d7", "loans.approve", "loans", "approve", "Approve Loans", "Approve loan requests"),
    ("c70d1daf-4ff3-4b7c-ae42-30d155915a6c", "loans.create", "loans", "create", "Create Loans", "Create new loan requests"),
    ("5878b740-7ef3-4a97-95ed-344f43cc4745", "loans.edit", "loans", "edit", "Edit Loans", "Edit loan records and conditions"),
    ("c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f", "loans.rollback", "loans", "rollback", "Rollback Loans", "Revert loan status to a previous step"),
    ("30543737-2455-4070-b54e-b6578a752359", "loans.view", "loans", "view", "View Loans", "View incoming and outgoing loan records"),
    ("820ff96d-fe97-4aac-87f6-5aface88ae40", "locations.edit", "locations", "edit", "Edit Locations", "Create, modify, and delete storage locations"),
    ("4daaad81-701f-4b51-afa6-851626961796", "locations.view", "locations", "view", "View Locations", "View storage locations and hierarchy"),
    ("1bf5f59e-6e96-44de-8298-19f8f78d53a8", "lookups.manage", "lookups", "manage", "Manage Lookups", "Create and edit organization lookup values"),
    ("7e96a47b-c68f-46e4-bf7f-e849962051e6", "lookups.view", "lookups", "view", "View Lookups", "View lookup values for dropdowns"),
    ("251b69ff-5d53-46c8-8295-698750c509b3", "mappings.edit", "mappings", "edit", "Edit Mappings", "Create, modify, and delete transformation mappings"),
    ("115746c7-ab25-41b6-a033-8f3c0ea82cd3", "mappings.view", "mappings", "view", "View Mappings", "View transformation mappings and transformers"),
    ("7f7f37cb-dc3d-4e16-aa50-ce8a73ce6ece", "media.admin", "media", "admin", "Media Administration", "Administer media settings including AI tagging configuration"),
    ("829d513d-5ed3-43c0-afcc-56afa8fa2143", "media.delete", "media", "delete", "Delete Media", "Delete media assets"),
    ("7a1d953d-d8aa-44a4-8b86-69e60a3ba2a8", "media.download_derivatives", "media", "download_derivatives", "Download Derivatives", "Download thumbnails and preview versions"),
    ("551ad09b-e69a-4106-9dab-564f97cd289e", "media.download_original", "media", "download_original", "Download Original Media", "Download full resolution media files"),
    ("2d462487-fe99-4daf-aabd-12badee0a78e", "media.edit", "media", "edit", "Edit Media", "Upload, edit, and manage media assets"),
    ("f1cfaa4d-faae-45ba-a30d-52a6e1ba3d6b", "media.publish", "media", "publish", "Publish Media", "Publish media to CDN and public endpoints"),
    ("b1f2a3c4-d5e6-4a7b-8c9d-0e1f2a3b4c5d", "media.approve_rights", "media", "approve_rights", "Approve Media Rights", "Sign off on a media rights/license record"),
    ("c2a3b4d5-e6f7-4b8c-9d0e-1f2a3b4c5d6e", "media.approve_review", "media", "approve_review", "Approve Media Review", "Sign off on a media sensitive-content review"),
    ("e8059d4c-257f-4435-a11e-c163080c4cdf", "media.view", "media", "view", "View Media", "View media library and assets"),
    ("97b6ca2a-cd4f-421d-99c1-fccc339a9ee7", "media.view_unpublished", "media", "view_unpublished", "View Unpublished Media", "View media that has not been published"),
    ("f2175897-b155-4302-b69a-c4d24fd9c7cb", "media_workspaces.create", "media_workspaces", "create", "Create Media Workspaces", "Create media workspaces"),
    ("3091bd52-56e5-4a25-9f27-2543d9146e86", "media_workspaces.delete", "media_workspaces", "delete", "Delete Media Workspaces", "Delete media workspaces"),
    ("3c4dc0eb-7589-479c-8a16-71b1bf43e5f0", "media_workspaces.edit", "media_workspaces", "edit", "Edit Media Workspaces", "Edit media workspaces"),
    ("16ab48d0-632c-4415-91f8-c1d4aa44f230", "media_workspaces.execute", "media_workspaces", "execute", "Execute Media Workspace Actions", "Execute media workspace bulk actions"),
    ("6ae204b1-b1aa-478e-a374-e4a5940e1360", "media_workspaces.share", "media_workspaces", "share", "Share Media Workspaces", "Share media workspaces"),
    ("7b206af9-9cf3-4fec-9aa6-8cc0b6346439", "media_workspaces.view", "media_workspaces", "view", "View Media Workspaces", "View media workspaces"),
    ("126a93b0-3d3c-4d23-bfe9-d9b922f18650", "movements.create", "movements", "create", "Create Movements", "Create movement records (relocate objects)"),
    ("8bf05a53-2dc3-448c-a4fd-0b4341af2d2e", "movements.view", "movements", "view", "View Movements", "View movement history and tracking"),
    ("cf61c7fa-1d30-45fc-b313-f1827615850e", "object_contexts.create", "object_contexts", "create", "Create Object Contexts", "Create context records"),
    ("98a2b46a-e603-4cf4-b199-7bf2940e9ad9", "object_contexts.delete", "object_contexts", "delete", "Delete Object Contexts", "Delete context records"),
    ("a45d0eab-f8e5-4584-a05b-fe61919e5425", "object_contexts.edit", "object_contexts", "edit", "Edit Object Contexts", "Edit context records"),
    ("232d1ca7-eca1-4109-8f8a-0e0994a15613", "object_contexts.view", "object_contexts", "view", "View Object Contexts", "View architectural and historical contexts"),
    ("c6a7ff2f-2a69-46b0-a63e-04ddb2e87a09", "object_relationships.edit", "object_relationships", "edit", "Edit Object Relationships", "Create, modify, and delete object relationships"),
    ("529eb717-71da-4fd0-941a-13b88548e114", "object_relationships.view", "object_relationships", "view", "View Object Relationships", "View object relationship records"),
    ("5c436c31-205d-4d60-bbac-ec7dae89c7f2", "org.manage_members", "org", "manage_members", "Manage Members", "Invite, remove, and manage organization members"),
    ("c6789cc2-3fb7-4af1-be1f-d6ddfe27dc7f", "org.manage_roles", "org", "manage_roles", "Manage Roles", "Assign and change member roles within the organization"),
    ("1fcd6125-9822-43b9-9251-4bdadd646f30", "org.view_audit_logs", "org", "view_audit_logs", "View Audit Logs", "View organization audit logs and change history"),
    ("0c03058e-111a-4414-b07d-a36a9bb5b0d0", "data.manage", "organization", "data.manage", "data.manage", "Manage data operations including transformations and classification"),
    ("43e48e8f-468c-4170-9316-9a0578166b38", "org.manage_api_keys", "organization", "org.manage_api_keys", "org.manage_api_keys", "Create, view, and revoke API keys for organization"),
    ("1b0213a3-50a2-4e27-8069-c091d7b9527b", "org.manage_settings", "organization", "org.manage_settings", "org.manage_settings", "Manage organization settings and profile configuration"),
    ("0a8848fd-c979-4437-b89d-29457581effe", "org.users.create", "organization", "org.users.create", "org.users.create", "Create and invite user accounts within the organization"),
    ("23eb5515-48ba-4e17-8278-f84d6d7d5c28", "org.users.deactivate", "organization", "org.users.deactivate", "org.users.deactivate", "Deactivate user memberships within the organization (does not delete global user account)"),
    ("49e70e1d-a392-42b2-b8c5-7aa7eee98607", "org.users.update", "organization", "org.users.update", "org.users.update", "Update user account details and role assignments within the organization"),
    ("89e94430-7ee9-44e9-a4ae-973efdab77d4", "pipelines.edit", "pipelines", "edit", "Edit Pipelines", "Create, update, and delete pipelines"),
    ("6d1e9da8-cab8-432c-add6-ae1841562172", "pipelines.view", "pipelines", "view", "View Pipelines", "View pipeline configurations"),
    ("5e975fca-595a-4704-bf56-b6f6345b1069", "place_authorities.create", "place_authorities", "create", "Create Place Authorities", "Create place authority records"),
    ("9755e0a0-54dc-4486-91bc-d42139fc7954", "place_authorities.delete", "place_authorities", "delete", "Delete Place Authorities", "Delete place authority records"),
    ("1ffedcda-9e24-4b09-b61e-c37fe4101d00", "place_authorities.edit", "place_authorities", "edit", "Edit Place Authorities", "Edit place authority records"),
    ("9d5009b8-9781-4712-8d45-245eddf6bc0b", "place_authorities.view", "place_authorities", "view", "View Place Authorities", "View place authority records"),
    ("830d6f85-9389-4049-80e0-a97564db48d7", "platform.admin", "platform", "admin", "Platform Admin", "Full platform administration access (internal only)"),
    ("c3e2c5aa-0255-429a-823d-d45d10a52de0", "reports.create", "reports", "create", "Create Reports", "Create new reports"),
    ("93f30de9-6071-4893-87ce-cb8e8b943a8c", "reports.delete", "reports", "delete", "Delete Reports", "Delete reports"),
    ("46e61e2e-c021-43ef-8d53-adc258fac085", "reports.edit", "reports", "edit", "Edit Reports", "Edit existing reports"),
    ("cb2f5782-a2cc-4d7c-9095-82c4779ae178", "reports.execute", "reports", "execute", "Execute Reports", "Run reports and view results"),
    ("a1978f5b-ed50-4729-aa9c-954d45bd5273", "reports.export", "reports", "export", "Export Reports", "Export reports to PDF, Excel, or CSV"),
    ("d61dc7d6-9964-4886-8074-6911d07d9075", "reports.schedule", "reports", "schedule", "Schedule Reports", "Create and manage report schedules"),
    ("f67f6976-6fc2-40b2-9420-9a0d2fd3b10a", "reports.view", "reports", "view", "View Reports", "View reports and their results"),
    ("0ebf56b5-0506-4728-a11a-00febc7ff9f4", "reproduction_requests.approve", "reproduction_requests", "approve", "Approve Reproduction Requests", "Approve reproduction requests"),
    ("f8b39d0f-8c12-4df6-8229-5ef596b24be5", "reproduction_requests.create", "reproduction_requests", "create", "Create Reproduction Requests", "Create reproduction requests"),
    ("91e8c426-c687-4f72-a6dd-361557689fe1", "reproduction_requests.delete", "reproduction_requests", "delete", "Delete Reproduction Requests", "Delete reproduction requests"),
    ("d598c929-e8a3-485d-857a-96e8782fa754", "reproduction_requests.edit", "reproduction_requests", "edit", "Edit Reproduction Requests", "Edit reproduction requests"),
    ("2406a6d2-a84d-480f-ac8f-b8e9c2456b3b", "reproduction_requests.view", "reproduction_requests", "view", "View Reproduction Requests", "View reproduction requests"),
    ("497b2a93-b655-400a-ad49-262d0d57d441", "reviews.approve", "reviews", "approve", "Approve Reviews", "Approve review campaigns"),
    ("fed440ed-634b-4819-a75a-8bef2f24bb09", "reviews.create", "reviews", "create", "Create Reviews", "Create review campaigns"),
    ("9e06cbaf-5c85-4767-b53d-ce13ddca8336", "reviews.edit", "reviews", "edit", "Edit Reviews", "Edit review campaigns and assessments"),
    ("6fdf9747-f0fd-42ae-9d4e-541586006871", "reviews.view", "reviews", "view", "View Reviews", "View collections review campaigns"),
    ("571fe6fc-ead5-4fd9-b92b-b1f13393d7c8", "rights.create", "rights", "create", "Create Rights", "Create rights records"),
    ("2361a6fd-9c81-4041-9995-b0464b95d769", "rights.edit", "rights", "edit", "Edit Rights", "Edit rights records"),
    ("8f84c09b-21cb-4d80-8334-b32f5e728609", "rights.view", "rights", "view", "View Rights", "View object rights records"),
    ("211f72d6-4bcf-4e7f-8562-1aba98ccd9ab", "runs.delete", "runs", "delete", "Delete Runs", "Delete run records (admin only)"),
    ("d4f59534-ce2a-4db3-9ace-23250705d261", "runs.execute", "runs", "execute", "Execute Runs", "Trigger manual runs"),
    ("9f04f588-32f7-4851-8396-9a7c8007b21e", "runs.force_full", "runs", "force_full", "Force Full Refresh", "Force full refresh (skip incremental sync)"),
    ("d0590336-ac51-4f11-b6ae-9a988b39fb1b", "runs.rollback", "runs", "rollback", "Rollback Runs", "Rollback a completed run to reverse its changes"),
    ("61edc7b6-afef-4b95-93e1-86fee7c5b4f0", "runs.view", "runs", "view", "View Runs", "View run history and status"),
    ("a3b295cc-8489-4721-a253-07f7f8db8b2d", "runs.view_logs", "runs", "view_logs", "View Run Logs", "View detailed run logs and error messages"),
    ("ec856caa-1867-4c2f-b5f0-b95698c6b1b7", "schedules.manage", "schedules", "manage", "Manage Schedules", "Manage route schedules (create, edit, enable/disable, delete)"),
    ("e1a14600-4799-43f2-b47d-db9eeb874840", "style_period_authorities.create", "style_period_authorities", "create", "Create Style/Period Authorities", "Create style and period authority records"),
    ("3a36b2fc-167f-484a-ad01-80e9081199d0", "style_period_authorities.delete", "style_period_authorities", "delete", "Delete Style/Period Authorities", "Delete style and period authority records"),
    ("740ff00a-c255-40bc-9ea6-e8095f92ee39", "style_period_authorities.edit", "style_period_authorities", "edit", "Edit Style/Period Authorities", "Edit style and period authority records"),
    ("e0f8f67a-8870-45d4-9e15-f87ef2c76507", "style_period_authorities.view", "style_period_authorities", "view", "View Style/Period Authorities", "View style and period authority records"),
    ("5fe0ead6-19ec-4554-9eea-a2f30ac48519", "subject_authorities.create", "subject_authorities", "create", "Create Subject Authorities", "Create subject authority records"),
    ("803f67f4-2fab-4b4a-9d91-d56de934ccf4", "subject_authorities.delete", "subject_authorities", "delete", "Delete Subject Authorities", "Delete subject authority records"),
    ("c8473ed9-9365-4ba9-9b6f-c7577d35309b", "subject_authorities.edit", "subject_authorities", "edit", "Edit Subject Authorities", "Edit subject authority records"),
    ("5b90eebb-f339-44b5-bfe6-45f489f5b8d7", "subject_authorities.view", "subject_authorities", "view", "View Subject Authorities", "View subject authority records"),
    ("d0de033c-7aab-44a9-b22b-b2abcd2d2b71", "tasks.create", "tasks", "create", "Create Tasks", "Create new tasks"),
    ("2e3a428c-d3f5-4370-8d3f-cd567b31add5", "tasks.delete", "tasks", "delete", "Delete Tasks", "Delete tasks"),
    ("44c60f5f-fc5b-4e44-a653-40794e4edaa8", "tasks.edit", "tasks", "edit", "Edit Tasks", "Edit tasks"),
    ("34cfb27c-d023-4f98-a894-1a4cc7eec07b", "tasks.view", "tasks", "view", "View Tasks", "View tasks"),
    ("1013a011-f440-45df-8279-dfd3da15fc48", "touring.edit", "touring", "edit", "Edit Touring", "Manage touring exhibition venues and schedules"),
    ("501c1870-3f0d-4983-990d-9cb9a41137a0", "touring.view", "touring", "view", "View Touring", "View touring exhibition schedules and venues"),
    ("dd6f7a6a-ff0f-4dab-9f6b-125e1fcc72c8", "use_requests.approve", "use_requests", "approve", "Approve Use Requests", "Approve use requests"),
    ("e0cb4976-6cd4-498d-a3cb-19e1963faba1", "use_requests.create", "use_requests", "create", "Create Use Requests", "Create use requests"),
    ("d08825a6-28a3-4f8e-89f7-7da648d83170", "use_requests.edit", "use_requests", "edit", "Edit Use Requests", "Edit use requests"),
    ("aef827ef-56e3-4f2c-8e00-34e4a01d2e0f", "use_requests.view", "use_requests", "view", "View Use Requests", "View use of collections requests"),
    ("075d30e4-d1ae-402a-a9e2-5700ff0b3940", "valuations.create", "valuations", "create", "Create Valuations", "Create valuation records"),
    ("ced01114-aab3-49b4-b06c-a8cb2c39e80c", "valuations.delete", "valuations", "delete", "Delete Valuations", "Delete valuation records"),
    ("2b686eed-ac58-4302-b211-c7a97ff10d04", "valuations.edit", "valuations", "edit", "Edit Valuations", "Edit valuation records"),
    ("fcdbd9ff-ed42-44f5-adb5-e1f8136af031", "valuations.view", "valuations", "view", "View Valuations", "View valuation records"),
    ("5128d5e8-1976-459b-b1ab-52a8086dbfc0", "venues.edit", "venues", "edit", "Edit Venues", "Create, modify, and delete venues and floor plans"),
    ("2bace6dc-8e25-4027-8303-86303c283e22", "venues.view", "venues", "view", "View Venues", "View venues and floor plans"),
    ("b0906118-1b6d-4600-b8f5-7d68d73c413c", "workspaces.create", "workspaces", "create", "Create Workspaces", "Create new workspaces"),
    ("d484608a-ea04-4bc3-9fb4-077b99679b87", "workspaces.delete", "workspaces", "delete", "Delete Workspaces", "Delete workspaces"),
    ("a5be18bc-250d-4017-96b4-90a8612e79c4", "workspaces.edit", "workspaces", "edit", "Edit Workspaces", "Edit workspace details and add/remove items"),
    ("8eae1658-dd30-4f47-9cab-703375bfcfe7", "workspaces.execute", "workspaces", "execute", "Execute Workspace Actions", "Execute bulk actions on workspace objects"),
    ("edc4a76c-c4d2-4f5b-bf37-a31806a7ecba", "workspaces.share", "workspaces", "share", "Share Workspaces", "Share workspaces with other users"),
    ("fd994673-a488-4ebf-931e-7a9c2ce6a33d", "workspaces.view", "workspaces", "view", "View Workspaces", "View workspaces and their contents"),
]


# ---------------------------------------------------------------------------
# Backfill from the permission registry.
#
# PERMISSIONS above is hand-maintained and had drifted: 21 keys were granted
# to roles in ROLE_PERMISSIONS but never defined here, so INSERT_ROLE_PERMISSION
# joined against a permissions row that did not exist and inserted nothing —
# silently, with rowcount 0. Those grants were dropped on every seed run, which
# made 47 route dependencies permanently unreachable for non-platform-admins.
# The rows originally came from pre-consolidation migrations, which left the
# chain when the schema was consolidated.
#
# app.permissions.metadata.PERMISSION_REGISTRY is the real source of truth and
# already described all 21. Rather than hand-copying them (and drifting again),
# derive anything missing from the registry. Ids are uuid5-derived so they are
# stable across installs and across runs; existing rows keep their literal ids
# because INSERT_PERMISSION is ON CONFLICT (permission_key) DO NOTHING.
# ---------------------------------------------------------------------------
_PERMISSION_ID_NAMESPACE = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")


def _registry_backfill() -> list[tuple]:
    from app.permissions.metadata import PERMISSION_REGISTRY

    known = {row[1] for row in PERMISSIONS}
    extra = []
    for meta in PERMISSION_REGISTRY.values():
        if meta.key in known:
            continue
        extra.append((
            str(uuid.uuid5(_PERMISSION_ID_NAMESPACE, meta.key)),
            meta.key,
            meta.scope,
            meta.action,
            meta.display_name,
            meta.description,
        ))
    return sorted(extra, key=lambda r: r[1])


PERMISSIONS += _registry_backfill()

# ---------------------------------------------------------------------------
# Role-Permission mappings: {role_key: [permission_key, ...]}
# ---------------------------------------------------------------------------
ROLE_PERMISSIONS = {
    "admin": [
        "acquisitions.approve", "acquisitions.create", "acquisitions.edit", "acquisitions.rollback", "acquisitions.view",
        "audits.approve", "audits.create", "audits.edit", "audits.view",
        "authorities.create", "authorities.delete", "authorities.edit", "authorities.merge", "authorities.view",
        "barcodes.manage", "barcodes.scan", "barcodes.view",
        "branding.edit", "branding.view",
        "cataloging_history.create", "cataloging_history.view",
        "citations.edit", "citations.view",
        "collections.create", "collections.delete", "collections.edit", "collections.view", "collections.view_all_departments",
        "condition_reports.create", "condition_reports.delete", "condition_reports.edit", "condition_reports.review", "condition_reports.view",
        "connectors.edit", "connectors.view",
        "conservation.approve", "conservation.create", "conservation.edit", "conservation.view",
        "constituents.create", "constituents.edit", "constituents.merge", "constituents.view",
        "contacts.edit", "contacts.view",
        "content.delete", "content.edit", "content.publish", "content.view",
        "critical_responses.create", "critical_responses.delete", "critical_responses.edit", "critical_responses.view",
        "data.export", "data.manage", "data.query", "data.view",
        "deaccession.approve", "deaccession.complete", "deaccession.create", "deaccession.edit",
        "deaccession.review", "deaccession.rollback", "deaccession.view",
        "departments.create", "departments.delete", "departments.edit", "departments.manage_members", "departments.view",
        "discover.publish",
        "documentation_plans.approve", "documentation_plans.create", "documentation_plans.edit", "documentation_plans.view",
        "documents.generate", "documents.templates.edit", "documents.templates.view",
        "download_requests.create", "download_requests.fulfill", "download_requests.review", "download_requests.view",
        "emergency_plans.approve", "emergency_plans.create", "emergency_plans.edit", "emergency_plans.view",
        "entries.create", "entries.edit", "entries.view",
        "events.edit", "events.view",
        "exhibit.content.edit", "exhibit.content.publish", "exhibit.content.view",
        "exhibit.create", "exhibit.delete", "exhibit.edit", "exhibit.publish", "exhibit.view",
        "exits.create", "exits.edit", "exits.rollback", "exits.view",
        "incidents.create", "incidents.edit", "incidents.investigate", "incidents.resolve", "incidents.view",
        "indemnity.create", "indemnity.edit", "indemnity.submit", "indemnity.view",
        "insurance.approve", "insurance.claims.create", "insurance.claims.manage",
        "insurance.create", "insurance.delete", "insurance.edit", "insurance.view",
        "labels.approve", "labels.edit", "labels.view",
        "loans.approve", "loans.create", "loans.edit", "loans.rollback", "loans.view",
        "locations.view",
        "lookups.manage", "lookups.view",
        "mappings.edit", "mappings.view",
        "media.admin", "media.delete", "media.download_derivatives", "media.download_original",
        "media.edit", "media.publish", "media.view", "media.view_unpublished",
        "media_workspaces.create", "media_workspaces.delete", "media_workspaces.edit",
        "media_workspaces.execute", "media_workspaces.share", "media_workspaces.view",
        "movements.create", "movements.view",
        "nagpra.create", "nagpra.edit", "nagpra.view",
        "object_contexts.create", "object_contexts.delete", "object_contexts.edit", "object_contexts.view",
        "object_relationships.edit", "object_relationships.view",
        "org.manage_api_keys", "org.manage_members", "org.manage_roles", "org.manage_settings",
        "org.users.create", "org.users.deactivate", "org.users.update",
        "org.view_audit_logs",
        "pipelines.edit", "pipelines.view",
        "place_authorities.create", "place_authorities.delete", "place_authorities.edit", "place_authorities.view",
        "reports.create", "reports.delete", "reports.edit", "reports.execute", "reports.export", "reports.schedule", "reports.view",
        "reproduction_requests.approve", "reproduction_requests.create", "reproduction_requests.delete",
        "reproduction_requests.edit", "reproduction_requests.view",
        "reviews.approve", "reviews.create", "reviews.edit", "reviews.view",
        "rights.create", "rights.edit", "rights.view",
        "runs.delete", "runs.execute", "runs.force_full", "runs.rollback", "runs.view", "runs.view_logs",
        "schedules.manage",
        "style_period_authorities.create", "style_period_authorities.delete", "style_period_authorities.edit", "style_period_authorities.view",
        "subject_authorities.create", "subject_authorities.delete", "subject_authorities.edit", "subject_authorities.view",
        "tasks.create", "tasks.delete", "tasks.edit", "tasks.view",
        "touring.edit", "touring.view",
        "use_requests.approve", "use_requests.create", "use_requests.edit", "use_requests.view",
        "valuations.create", "valuations.delete", "valuations.edit", "valuations.view",
        "venues.edit", "venues.view",
        "workspaces.create", "workspaces.delete", "workspaces.edit", "workspaces.execute", "workspaces.share", "workspaces.view",
    ],
    "curator": [
        "acquisitions.view",
        "authorities.create", "authorities.edit", "authorities.view",
        "barcodes.view",
        "branding.view",
        "cataloging_history.create", "cataloging_history.view",
        "citations.edit", "citations.view",
        "collections.create", "collections.edit", "collections.view",
        "condition_reports.create", "condition_reports.edit", "condition_reports.view",
        "conservation.view",
        "constituents.create", "constituents.edit", "constituents.view",
        "contacts.view",
        "critical_responses.create", "critical_responses.edit", "critical_responses.view",
        "data.export", "data.query", "data.view",
        "discover.publish",
        "documentation_plans.create", "documentation_plans.edit", "documentation_plans.view",
        "documents.generate", "documents.templates.view",
        "download_requests.create", "download_requests.view",
        "emergency_plans.view",
        "entries.view",
        "events.view",
        "exhibit.content.view", "exhibit.view",
        "exits.view",
        "incidents.view",
        "loans.view",
        "locations.view",
        "lookups.view",
        "media.download_derivatives", "media.download_original", "media.edit", "media.publish", "media.view", "media.view_unpublished",
        "media_workspaces.create", "media_workspaces.edit",
        "media_workspaces.execute", "media_workspaces.share", "media_workspaces.view",
        "movements.view",
        "object_contexts.create", "object_contexts.edit", "object_contexts.view",
        "object_relationships.edit", "object_relationships.view",
        "place_authorities.create", "place_authorities.edit", "place_authorities.view",
        "reproduction_requests.view",
        "rights.view",
        "runs.view",
        "style_period_authorities.create", "style_period_authorities.edit", "style_period_authorities.view",
        "subject_authorities.create", "subject_authorities.edit", "subject_authorities.view",
        "tasks.create", "tasks.delete", "tasks.edit", "tasks.view",
        "touring.view",
        "use_requests.view",
        "valuations.view",
        "workspaces.create", "workspaces.edit", "workspaces.execute", "workspaces.view",
    ],
    "platform_admin": [
        # platform_admin gets all admin permissions (via seed logic) PLUS platform.admin.
        # This is the ONLY role with platform-level access.
        "platform.admin",
    ],
    "publisher": [
        "collections.create", "collections.edit", "collections.view",
        "data.export", "data.query", "data.view",
        "discover.publish",
        "documents.generate", "documents.templates.view",
        "download_requests.create", "download_requests.view",
        "locations.view",
        "lookups.view",
        "media.download_derivatives", "media.download_original", "media.edit", "media.publish", "media.view", "media.view_unpublished",
        "media_workspaces.create", "media_workspaces.delete", "media_workspaces.edit",
        "media_workspaces.execute", "media_workspaces.share", "media_workspaces.view",
        "reproduction_requests.view",
        "rights.view",
        "runs.view",
        "tasks.create", "tasks.delete", "tasks.edit", "tasks.view",
        "use_requests.view",
    ],
    "registrar": [
        "acquisitions.approve", "acquisitions.create", "acquisitions.edit", "acquisitions.rollback", "acquisitions.view",
        "audits.create", "audits.edit", "audits.view",
        "authorities.create", "authorities.delete", "authorities.edit", "authorities.merge", "authorities.view",
        "barcodes.manage", "barcodes.scan", "barcodes.view",
        "branding.view",
        "cataloging_history.create", "cataloging_history.view",
        "citations.edit", "citations.view",
        "collections.create", "collections.delete", "collections.edit", "collections.view",
        "condition_reports.create", "condition_reports.delete", "condition_reports.edit", "condition_reports.review", "condition_reports.view",
        "connectors.edit", "connectors.view",
        "conservation.approve", "conservation.create", "conservation.edit", "conservation.view",
        "constituents.create", "constituents.edit", "constituents.merge", "constituents.view",
        "contacts.edit", "contacts.view",
        "critical_responses.create", "critical_responses.edit", "critical_responses.view",
        "data.export", "data.manage", "data.query", "data.view",
        "deaccession.create", "deaccession.edit", "deaccession.review", "deaccession.view",
        "discover.publish",
        "documentation_plans.approve", "documentation_plans.create", "documentation_plans.edit", "documentation_plans.view",
        "documents.generate", "documents.templates.view",
        "download_requests.create", "download_requests.fulfill", "download_requests.review", "download_requests.view",
        "emergency_plans.approve", "emergency_plans.create", "emergency_plans.edit", "emergency_plans.view",
        "entries.create", "entries.edit", "entries.view",
        "events.edit", "events.view",
        "exhibit.content.edit", "exhibit.content.view",
        "exhibit.create", "exhibit.edit", "exhibit.view",
        "exits.create", "exits.edit", "exits.rollback", "exits.view",
        "incidents.create", "incidents.edit", "incidents.investigate", "incidents.resolve", "incidents.view",
        "indemnity.create", "indemnity.edit", "indemnity.view",
        "insurance.claims.create", "insurance.claims.manage",
        "insurance.create", "insurance.edit", "insurance.view",
        "labels.edit", "labels.view",
        "loans.approve", "loans.create", "loans.edit", "loans.rollback", "loans.view",
        "locations.view",
        "lookups.view",
        "mappings.edit", "mappings.view",
        "media.download_derivatives", "media.download_original", "media.edit", "media.view", "media.view_unpublished",
        "media_workspaces.create", "media_workspaces.delete", "media_workspaces.edit",
        "media_workspaces.execute", "media_workspaces.share", "media_workspaces.view",
        "movements.create", "movements.view",
        "nagpra.create", "nagpra.edit", "nagpra.view",
        "object_contexts.create", "object_contexts.edit", "object_contexts.view",
        "object_relationships.edit", "object_relationships.view",
        "pipelines.edit", "pipelines.view",
        "place_authorities.create", "place_authorities.delete", "place_authorities.edit", "place_authorities.view",
        "reports.create", "reports.delete", "reports.edit", "reports.execute", "reports.export", "reports.schedule", "reports.view",
        "reproduction_requests.approve", "reproduction_requests.create", "reproduction_requests.delete",
        "reproduction_requests.edit", "reproduction_requests.view",
        "reviews.create", "reviews.edit", "reviews.view",
        "rights.create", "rights.edit", "rights.view",
        "runs.execute", "runs.force_full", "runs.view", "runs.view_logs",
        "runs.rollback",
        "schedules.manage",
        "style_period_authorities.create", "style_period_authorities.delete", "style_period_authorities.edit", "style_period_authorities.view",
        "subject_authorities.create", "subject_authorities.delete", "subject_authorities.edit", "subject_authorities.view",
        "tasks.create", "tasks.delete", "tasks.edit", "tasks.view",
        "touring.edit", "touring.view",
        "use_requests.approve", "use_requests.create", "use_requests.edit", "use_requests.view",
        "valuations.create", "valuations.edit", "valuations.view",
        "venues.edit", "venues.view",
        "workspaces.create", "workspaces.edit", "workspaces.execute", "workspaces.view",
    ],
    "viewer": [
        # View access to all collections entities
        "acquisitions.view", "audits.view", "authorities.view",
        "barcodes.view", "branding.view",
        "cataloging_history.view", "citations.view",
        "collections.view", "condition_reports.view", "conservation.view",
        "constituents.view", "contacts.view", "critical_responses.view",
        "deaccession.view", "documentation_plans.view",
        "download_requests.create", "download_requests.view",
        "emergency_plans.view", "entries.view", "events.view",
        "exhibit.content.view", "exhibit.view", "exits.view",
        "incidents.view", "indemnity.view", "insurance.view",
        "labels.view", "loans.view", "locations.view", "lookups.view",
        "media.download_derivatives", "media.view",
        "media_workspaces.view",
        "movements.view",
        "nagpra.view",
        "object_contexts.view", "object_relationships.view",
        "place_authorities.view",
        "reports.view", "reproduction_requests.view", "reviews.view",
        "rights.view", "runs.view",
        "style_period_authorities.view", "subject_authorities.view",
        "tasks.create", "tasks.delete", "tasks.edit", "tasks.view",
        "touring.view",
        "use_requests.view",
        "valuations.view", "venues.view",
        "workspaces.view",
    ],
}


# ---------------------------------------------------------------------------
# SQL statements
# ---------------------------------------------------------------------------

# Media approval governance — granted with the media DAM draft gates.
# rights sign-off: registrar (legal/rights) + curator + admins; review: curator + admins.
for _r in ("admin", "platform_admin", "registrar", "curator"):
    ROLE_PERMISSIONS.setdefault(_r, []).append("media.approve_rights")
for _r in ("admin", "platform_admin", "curator"):
    ROLE_PERMISSIONS.setdefault(_r, []).append("media.approve_review")


INSERT_ROLE = text("""
    -- Idempotent via WHERE NOT EXISTS (system role = organization_id IS NULL)
    -- rather than ON CONFLICT: the roles unique constraint differs across
    -- environments (migration 20260403 replaced the plain UNIQUE(role_key)
    -- with partial system/org indexes, and that migration is now archived), so
    -- a constraint/index-specific arbiter is not portable. Casts keep psycopg
    -- from deducing inconsistent param types for the reused :role_key.
    INSERT INTO public.roles (role_id, role_key, display_name, description, is_system)
    SELECT (:role_id)::uuid, (:role_key)::text, (:display_name)::text,
           (:description)::text, (:is_system)::boolean
    WHERE NOT EXISTS (
        SELECT 1 FROM public.roles
        WHERE role_key = (:role_key)::text AND organization_id IS NULL
    )
""")

INSERT_PERMISSION = text("""
    INSERT INTO public.permissions (permission_id, permission_key, scope, action, display_name, description)
    VALUES (:permission_id, :permission_key, :scope, :action, :display_name, :description)
    ON CONFLICT (permission_key) DO NOTHING
""")

# `organization_id IS NULL` scopes this to SYSTEM roles, and is load-bearing.
#
# Without it the join matched on role_key alone, so an org-scoped CUSTOM role
# whose key collided with a system one was granted that system role's entire
# permission set — on every container start, since entrypoint.sh runs this
# seed on boot. Role keys are slugified display names and uniqueness is only
# checked within the org, so an admin naming a role "Registrar" got all 185
# registrar permissions, and naming one "Platform Admin" got platform.admin,
# i.e. cross-tenant access. INSERT_ROLE above already filters this way.
INSERT_ROLE_PERMISSION = text("""
    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT r.role_id, p.permission_id
    FROM public.roles r, public.permissions p
    WHERE r.role_key = :role_key
      AND r.organization_id IS NULL
      AND p.permission_key = :permission_key
    ON CONFLICT (role_id, permission_id) DO NOTHING
""")


# ---------------------------------------------------------------------------
# Seed function
# ---------------------------------------------------------------------------

def _assert_role_grants_are_definable() -> None:
    """Fail loudly if a role grants a permission that will never be inserted.

    INSERT_ROLE_PERMISSION joins roles to permissions by key, so a grant naming
    a permission that does not exist inserts zero rows and reports nothing —
    the grant just silently disappears, and every route depending on it 403s
    for everyone. That is how 21 permissions went missing without anyone
    noticing. A seed that cannot do what it was asked should say so.
    """
    defined = {row[1] for row in PERMISSIONS}
    granted = {key for keys in ROLE_PERMISSIONS.values() for key in keys}
    undefined = sorted(granted - defined)
    if undefined:
        raise RuntimeError(
            "ROLE_PERMISSIONS grants permissions that are not defined in "
            "PERMISSIONS and are absent from app.permissions.metadata."
            "PERMISSION_REGISTRY, so they would be silently dropped: "
            f"{undefined}"
        )


def seed_roles_and_permissions():
    """Seed roles, permissions, and role_permissions."""
    _assert_role_grants_are_definable()
    settings = Settings()
    engine = create_engine(settings.database_url.unicode_string())

    print("\n" + "=" * 80)
    print("Seeding Roles, Permissions, and Role-Permission Mappings")
    print("=" * 80)

    with Session(engine) as session:
        # ----- Roles -----
        print("\nRoles:")
        print("-" * 40)
        roles_inserted = 0
        for role_id, role_key, display_name, description, is_system in ROLES:
            result = session.execute(INSERT_ROLE, {
                "role_id": role_id,
                "role_key": role_key,
                "display_name": display_name,
                "description": description,
                "is_system": is_system,
            })
            if result.rowcount > 0:
                roles_inserted += 1
                print(f"  + {role_key:20} {display_name}")
            else:
                print(f"  . {role_key:20} {display_name} (exists)")

        # ----- Permissions -----
        print("\nPermissions:")
        print("-" * 40)
        perms_inserted = 0
        for perm_id, perm_key, scope, action, display_name, description in PERMISSIONS:
            result = session.execute(INSERT_PERMISSION, {
                "permission_id": perm_id,
                "permission_key": perm_key,
                "scope": scope,
                "action": action,
                "display_name": display_name,
                "description": description,
            })
            if result.rowcount > 0:
                perms_inserted += 1
        print(f"  Inserted {perms_inserted} / {len(PERMISSIONS)} permissions")

        # ----- Role-Permission Mappings -----
        print("\nRole-Permission Mappings:")
        print("-" * 40)
        total_mappings = 0
        mappings_inserted = 0
        for role_key, perm_keys in ROLE_PERMISSIONS.items():
            role_inserted = 0
            for perm_key in perm_keys:
                total_mappings += 1
                result = session.execute(INSERT_ROLE_PERMISSION, {
                    "role_key": role_key,
                    "permission_key": perm_key,
                })
                if result.rowcount > 0:
                    role_inserted += 1
                    mappings_inserted += 1
            print(f"  {role_key:20} {role_inserted:3} / {len(perm_keys):3} new mappings")

        session.commit()

        # ----- Summary -----
        role_count = session.execute(text("SELECT count(*) FROM public.roles")).scalar()
        perm_count = session.execute(text("SELECT count(*) FROM public.permissions")).scalar()
        mapping_count = session.execute(text("SELECT count(*) FROM public.role_permissions")).scalar()

        print("\n" + "=" * 80)
        print(f"Roles:       {roles_inserted} inserted (total: {role_count})")
        print(f"Permissions: {perms_inserted} inserted (total: {perm_count})")
        print(f"Mappings:    {mappings_inserted} inserted (total: {mapping_count})")
        print("=" * 80 + "\n")


if __name__ == "__main__":
    seed_roles_and_permissions()
