"""
Seed lookup categories and lookup values.

Creates:
- 61 lookup categories in collections schema
- 386 system-level lookup values (organization_id IS NULL)

Run with:
    python -m seeds.seed_lookup_data

Idempotent: uses ON CONFLICT DO NOTHING for all inserts.
Must bypass RLS since collections schema has FORCE ROW LEVEL SECURITY.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.config import Settings


# ---------------------------------------------------------------------------
# Lookup Categories: (category_id, category_key, display_name, description,
#                     applicable_contexts_json, supports_icons)
# ---------------------------------------------------------------------------
LOOKUP_CATEGORIES = [
    ("fc224061-8c96-43e4-8349-df19dad8798e", "acquisition_method", "Acquisition Method", "How an object was acquired", '["acquisitions", "objects"]', True),
    ("dce3468b-1d8a-4ab3-aaf0-816347b9baed", "audit_type", "Audit Type", "Type of collections audit", '["audits"]', False),
    ("77f3f0f6-adad-406b-9ced-84684446b37b", "authority_role", "Authority Role", "Role of authority in relation to object", '["authorities"]', False),
    ("fe9e68d8-7bd2-446c-b755-d2092d369656", "authority_status", "Authority Status", "Status of authority record", '["authorities"]', False),
    ("3414c92b-7b9c-4255-b762-ab3c4b9a5253", "certainty", "Certainty", "Level of certainty for attributions", '["authorities", "contacts"]', False),
    ("574dd1c7-e296-476d-9e15-a582fdcf3b0f", "citation_type", "Citation Type", "Type of bibliographic citation", '["citations"]', False),
    ("8b9fe2f7-ad98-4bcf-8aab-5e0d58a86426", "claim_status", "Insurance Claim Status", "Status of insurance claim", '["incidents"]', False),
    ("a0b1fe56-9b2d-4073-bbc3-69aff53454a8", "classification", "Classification", "Object classification/type based on form and medium", '["objects"]', False),
    ("ac089d49-46ea-46f4-bc23-05db8c73dc79", "committee_recommendation", "Committee Recommendation", "Deaccession committee decision", '["deaccessions"]', False),
    ("0004fca3-f39e-41c2-9716-f1056cbb53e6", "condition", "Condition Rating", "Object condition assessment", '["objects", "condition_reports", "exits"]', False),
    ("a177feae-075d-4d66-ab9e-cbeca482e05e", "contact_role", "Contact Role", "Deprecated — use constituent_role_* categories", '["contacts"]', False),
    ("dba4e2d2-48a3-4d0f-9f51-df0c4102fc99", "constituent_role_object", "Object Role", "Roles for collection objects", '["collection_object"]', False),
    ("de7a54e3-fab7-42ba-97ee-eaf1b7bec1e0", "constituent_role_acquisition", "Acquisition Role", "Roles for acquisitions", '["acquisition"]', False),
    ("1759cdb2-8e21-444e-b92a-0ce2969a7e5a", "constituent_role_exhibition", "Exhibition Role", "Roles for exhibitions", '["exhibition"]', False),
    ("75d1e906-fa8f-4854-85c3-e0dc3b92e50a", "constituent_role_event", "Event Role", "Roles for events", '["event"]', False),
    ("8bc8196d-6bfc-47f0-b760-32d1017ee144", "constituent_role_shipment", "Shipment Role", "Roles for shipments", '["shipment"]', False),
    ("eb933516-b410-48f4-a3ad-97e9cd97d586", "constituent_role_conservation", "Conservation Role", "Roles for conservation treatments", '["conservation_treatment"]', False),
    ("c6064e15-d99d-41e1-b4d6-99151b192e24", "constituent_role_loan_in", "Incoming Loan Role", "Roles for incoming loans", '["loan_in"]', False),
    ("f56b92d1-3c94-4c9c-9cc5-6c9c9aee2e76", "constituent_role_loan_out", "Outgoing Loan Role", "Roles for outgoing loans", '["loan_out"]', False),
    ("043ad1b5-05f1-4427-b327-2fc3060ad886", "constituent_role_right", "Rights Role", "Roles for rights", '["right"]', False),
    ("ce3bdf0d-21ad-4ba1-868a-b52dfb82a9a6", "constituent_role_generic", "Person or Organization Role", "Generic roles for miscellaneous entity types", '["valuation", "movement", "use_request", "reproduction_request", "documentation_plan", "audit", "deaccession"]', False),
    ("1e4fefcd-2db0-40aa-81ab-2d819b333aad", "copyright_status", "Copyright Status", "Copyright status of object", '["objects", "rights"]', False),
    ("c7d4e8a1-3f2b-4a5c-9e1d-8b6f7a2c3d4e", "currency", "Currency", "Currency for monetary values", '["entries", "loans_in", "loans_out", "insurance", "valuations", "acquisitions"]', False),
    ("9a3033f2-1c6a-4eff-8137-238237a11122", "deaccession_reason", "Deaccession Reason", "Reason for deaccessioning", '["deaccessions"]', False),
    ("59147225-685c-413e-ac24-a625743dbf62", "delivery_method", "Delivery Method", "How reproductions are delivered", '["reproductions"]', False),
    ("59962155-d88a-4d6a-ba5a-671a2d120ceb", "disposal_method", "Disposal Method", "Method of disposal after deaccession", '["deaccessions"]', False),
    ("fb1bcaae-d8ff-4ee5-bd1f-77f959cb4c16", "documentation_plan_type", "Documentation Plan Type", "Type of documentation plan", '["documentation_plans"]', False),
    ("e910ad01-4972-40dc-b86f-4f92e2cdede1", "entry_duration", "Entry Duration", "Expected duration of entry", '["entries"]', False),
    ("d312dfa6-e126-471b-8d37-adee6724e887", "entry_reason", "Entry Reason", "Reason for object entry", '["entries"]', False),
    ("5cc01a37-9f5f-4eff-8b75-09cba86e90c9", "event_audience", "Event Audience", "Target audience for events", '["events"]', False),
    ("79249a17-a3de-460f-9956-b7bb96624e29", "event_type", "Event Type", "Types of events", '["events"]', False),
    ("ba81b1c4-714b-4087-a9fb-71a16697fc12", "exit_reason", "Exit Reason", "Reason for object exit", '["exits"]', False),
    ("91446fab-ff06-4a19-8b33-cd483303cdf7", "fee_type", "Fee Type", "Type of reproduction fee", '["reproductions"]', False),
    ("f21d236f-0a11-4c16-b212-78519f035bc7", "gender", "Gender", "Gender options for authority records", '["authorities"]', False),
    ("92fed719-3995-41f4-93d5-6429819f6b89", "incident_type", "Incident Type", "Type of incident", '["incidents"]', False),
    ("26d76dc7-0946-49ee-94c9-bd22f36eaf89", "legal_status", "Legal Status", "Provenance legal status", '["acquisitions"]', False),
    ("46b00a51-d4c7-47e7-b055-d0e6bd6f5d5e", "license_type", "License Type", "Type of license", '["rights"]', False),
    ("a1bb760e-7afa-4e94-9cf9-a58b12f23c2e", "life_role", "Life Role", "Professional/life role of a person", '["authorities"]', False),
    ("83c95174-fa9a-435c-b88d-2b207b387797", "loan_purpose", "Loan Purpose", "Purpose of loan", '["loans_in", "loans_out"]', False),
    ("6cfbe634-e2f6-4a0c-b52b-e39f4107a6bd", "object_status", "Object Status", "Status of collection object", '["objects"]', False),
    ("6844c7a1-5a3f-4389-9f7e-56a25685a87a", "object_type", "Object Type", "Type of collection object", '["objects"]', False),
    ("aa4eec0b-d182-4486-ace0-83e7fabaedfc", "other_number_type", "Other Number Type", "Types for alternate identification numbers on objects", '["objects"]', False),
    ("ee646b4f-80a7-4334-bcef-e6e1a8de5d0c", "packing_method", "Packing Method", "How objects are packed for transport", '["exits", "loans"]', False),
    ("3df5af8c-3d07-4b0a-b773-2e20480ca24d", "priority", "Priority", "Priority level for conservation and tasks", '["condition_reports", "conservation"]', False),
    ("aa6dabda-e30a-4cbe-a652-4ef243a2954d", "relationship_type", "Object Relationship Type", "Type of relationship between objects", '["relationships"]', False),
    ("909eb3c8-c5fe-41c0-a822-867a2b21425e", "report_type", "Condition Report Type", "Type of condition report", '["condition_reports"]', False),
    ("6f60668d-d2ff-4bd6-8989-5283c1a10fd1", "reproduction_purpose", "Reproduction Purpose", "Purpose of reproduction request", '["reproductions"]', False),
    ("2c52b5c2-b652-4358-8e92-0fd7ebacdea6", "reproduction_type", "Reproduction Type", "Type of reproduction", '["reproductions"]', False),
    ("4718e85d-b938-4edd-b645-56a216511555", "review_frequency", "Review Frequency", "Frequency of review", '["documentation_plans"]', False),
    ("31ab7275-a947-4c83-9ca2-5394beb9e30d", "review_type", "Collections Review Type", "Type of collections review", '["reviews"]', False),
    ("77783508-2ab1-4053-bb58-c15475c3d58a", "right_status", "Right Status", "Status of a right", '["rights"]', False),
    ("ce51141c-b4df-4f73-b36e-974fd496551a", "right_type", "Right Type", "Type of intellectual property right", '["rights"]', False),
    ("12e859a9-6046-4391-8009-7fdb2c8670a5", "role_qualifier", "Role Qualifier", "Qualifiers for roles (attributed to, circle of, etc.)", '["authorities", "contacts"]', False),
    ("4dd6107e-4b2d-4379-8973-e1ab81c8131d", "sample_method", "Sampling Method", "Method for audit sampling", '["audits"]', False),
    ("c9aaeadc-ccbc-4bec-accc-d6f16534243d", "shipping_method", "Shipping Method", "How objects are shipped", '["exits", "loans"]', False),
    ("d5247aec-ffad-4ea3-a922-4e83bcd1793a", "source_type", "Source Type", "Type of acquisition source", '["acquisitions"]', False),
    ("d4cbfedc-ee3e-4d1e-baf3-e0bf0f8349f4", "treatment_type", "Treatment Type", "Type of conservation treatment", '["conservation"]', False),
    ("b0b762f9-b507-4958-90df-c27a67ff110b", "use_type", "Use Type", "Type of use request", '["use_requests"]', False),
    ("0f82f987-3bd5-4511-a62a-a238cefe88e2", "valuation_method", "Valuation Method", "Method used for valuation", '["valuations"]', False),
    ("0bba9f7d-f515-4621-8bce-7fca2f5bfa2d", "valuation_type", "Valuation Type", "Purpose of valuation", '["valuations"]', False),
]


# ---------------------------------------------------------------------------
# Lookup Values: (category_key, value_id, value_key, label, description,
#                 icon_name, sort_order, is_active, is_hidden)
# icon_name: None means NULL, "" means empty string (both stored as NULL)
# ---------------------------------------------------------------------------
LOOKUP_VALUES = [
    # -- acquisition_method --
    ("acquisition_method", "bbedc1bf-ea59-4a64-8166-99d9a94f108f", "gift", "Gift", "Donated to the institution", "Gift", 0, True, False),
    ("acquisition_method", "2bf88f38-a82d-4a59-b998-94db70e1cbc5", "purchase", "Purchase", "Bought by the institution", "ShoppingCart", 1, True, False),
    ("acquisition_method", "694d230c-3a70-4c1e-b086-db154f97986f", "bequest", "Bequest", "Left to the institution in a will", "Archive", 2, True, False),
    ("acquisition_method", "4bd8792e-a8ec-4992-8c1c-451cc89bd3ce", "transfer", "Transfer", "Transferred from another institution", "Building2", 3, True, False),
    ("acquisition_method", "8768fb1a-d7e3-48d9-88c6-ff5bfb24b5c9", "exchange", "Exchange", "Exchanged with another institution", "Repeat", 4, True, False),
    ("acquisition_method", "d7f364e0-371b-4b74-a510-eb3b76d3ff66", "field_collection", "Field Collection", "Collected during fieldwork", "Archive", 5, True, False),
    ("acquisition_method", "a7958ffa-b962-4d41-b9d9-9481f8a87c49", "found_in_collection", "Found in Collection", "Discovered within existing collection", "Archive", 6, True, False),
    ("acquisition_method", "6df5f386-f3d1-4dd8-961c-ccac2bc38ef2", "other", "Other", "Other acquisition method", "Archive", 7, True, False),
    # -- audit_type --
    ("audit_type", "970601d0-86ea-4b52-94ff-a0ee3c742bea", "location", "Location Audit", "Verify object locations", None, 0, True, False),
    ("audit_type", "860b6373-bee2-4f03-9da9-27cdd32aa753", "condition", "Condition Audit", "Assess object conditions", None, 1, True, False),
    ("audit_type", "b8a4b65f-df78-4e77-8b71-2d38504817e7", "documentation", "Documentation Audit", "Review documentation", None, 2, True, False),
    ("audit_type", "d8a315f8-d7c5-465e-a9d6-a63bdc462673", "security", "Security Audit", "Security assessment", None, 3, True, False),
    ("audit_type", "a55ffb70-ba8f-409b-8d72-dbb35eb87aaa", "comprehensive", "Comprehensive", "Full audit", None, 4, True, False),
    # -- authority_role --
    ("authority_role", "33bcfca8-1c1f-48f5-8a33-e790cb6de31e", "creator", "Creator", "Created the object", None, 0, True, False),
    ("authority_role", "574a79f1-5615-4560-a5c0-25f98c9fed58", "donor", "Donor", "Donated the object", None, 1, True, False),
    ("authority_role", "6b72d29e-bd99-4cfb-8c70-cd2a613c19ce", "previous_owner", "Previous Owner", "Previously owned", None, 2, True, False),
    ("authority_role", "98721c62-3584-4540-9dea-6a81fd29bdd9", "depicted", "Depicted", "Depicted in the object", None, 3, True, False),
    ("authority_role", "f063ffa3-872a-4c06-b92f-3ee42e89a40f", "associated", "Associated", "Associated with object", None, 4, True, False),
    ("authority_role", "062116cb-9c63-46d4-9af9-9e09b91a185b", "publisher", "Publisher", "Published the work", None, 5, True, False),
    ("authority_role", "4d10bab3-b539-420c-bccc-9c95079ba253", "commissioner", "Commissioner", "Commissioned the work", None, 6, True, False),
    # -- authority_status --
    ("authority_status", "392ab959-d4af-484d-9e77-37908805bb02", "active", "Active", "Currently active record", None, 0, True, False),
    ("authority_status", "2e81656d-ae45-4fa9-8dd0-3941d2176c18", "deprecated", "Deprecated", "No longer preferred", None, 1, True, False),
    # -- certainty --
    ("certainty", "c3de09ec-a265-4cb8-99b0-0191434651d7", "certain", "Certain", "Definitely correct", None, 0, True, False),
    ("certainty", "ce43d378-b444-4c73-959a-781768a26af4", "probable", "Probable", "Likely correct", None, 1, True, False),
    ("certainty", "09fb5c79-0cc0-453b-a2b7-972a7cabbbc5", "possible", "Possible", "Possibly correct", None, 2, True, False),
    # -- citation_type --
    ("citation_type", "d24004d5-1523-4a73-864e-6151cbb3ab2d", "book", "Book", "Published book", None, 0, True, False),
    ("citation_type", "b48197a4-5a63-448d-a421-b1d41da9ac92", "article", "Article", "Journal or magazine article", None, 1, True, False),
    ("citation_type", "17f017e2-f55e-4272-adfa-5eba016df079", "catalog", "Catalog", "Collection or auction catalog", None, 2, True, False),
    ("citation_type", "329cea18-a677-4884-8a90-457503753e7e", "exhibition_catalog", "Exhibition Catalog", "Exhibition catalog", None, 3, True, False),
    ("citation_type", "4dbd7d87-10a6-4f3a-8a67-b2641baad4bc", "dissertation", "Dissertation", "Academic dissertation", None, 4, True, False),
    ("citation_type", "4dc3cf7f-7531-4213-a8fd-5127ec0f9005", "website", "Website", "Online source", None, 5, True, False),
    # -- claim_status --
    ("claim_status", "73326ae1-4a57-4e2c-a57c-0fcee8e98aa2", "submitted", "Submitted", "Claim submitted", None, 0, True, False),
    ("claim_status", "481119b4-7a92-4281-bace-c8957711aba8", "under_review", "Under Review", "Being reviewed", None, 1, True, False),
    ("claim_status", "c1b8fd0f-469e-4ac9-9053-167dd3a29e43", "approved", "Approved", "Claim approved", None, 2, True, False),
    ("claim_status", "fe9c473a-1ba8-4d1c-8e13-8778406b068a", "denied", "Denied", "Claim denied", None, 3, True, False),
    ("claim_status", "818952dd-af4c-4506-96c9-5f9845f18357", "settled", "Settled", "Claim settled", None, 4, True, False),
    # -- classification --
    ("classification", "d6f50e84-5894-4036-88eb-53b4f17ace8f", "painting", "Painting", "Works in which images are formed primarily by the application of pigments", None, 0, True, False),
    ("classification", "29d0151b-818a-4b4c-bb39-e025be368c7a", "drawing", "Drawing", "Visual works produced by drawing, typically on paper", None, 1, True, False),
    ("classification", "f3c37008-53ed-448e-9b01-708c4f505033", "print", "Print", "Pictorial works produced by transferring images from a matrix", None, 2, True, False),
    ("classification", "cc929a18-a718-4cc9-a524-7e6416713370", "photograph", "Photograph", "Images produced by the action of light on photosensitive surfaces", None, 3, True, False),
    ("classification", "9da9a249-aef5-41a0-a4e6-10c77d7a30de", "sculpture", "Sculpture", "Three-dimensional works of art", None, 4, True, False),
    ("classification", "25603860-e17d-45b3-ba06-e7eca35e0f5c", "textile", "Textile", "Objects made of interlacing fibers", None, 5, True, False),
    ("classification", "adad06b6-74e7-401a-8682-2e998382e313", "ceramic", "Ceramic", "Objects made from clay hardened by heat", None, 6, True, False),
    ("classification", "7be6182b-503f-436c-ad4b-a8cd3ba4d5e5", "glass", "Glass", "Objects made from glass", None, 7, True, False),
    ("classification", "0a24c381-00e4-4744-9ace-a139fbad1bb8", "metalwork", "Metalwork", "Objects made primarily of metal", None, 8, True, False),
    ("classification", "0a49f3f6-40eb-407b-9ef4-5e57b0be6cab", "furniture", "Furniture", "Movable articles for use or ornament in a dwelling", None, 9, True, False),
    ("classification", "87555118-7918-49b3-8d31-599790394c41", "jewelry", "Jewelry", "Objects of personal adornment", None, 10, True, False),
    ("classification", "ec0184db-a98a-4b96-b95d-95e21b280f94", "book", "Book", "Written or printed works consisting of pages", None, 11, True, False),
    ("classification", "0a9161cb-a46e-4b76-a477-b610a228ad1a", "manuscript", "Manuscript", "Handwritten documents", None, 12, True, False),
    ("classification", "14bccd5c-57fa-4892-82a0-1ebb114093b0", "archive", "Archive", "Archival materials and documents", None, 13, True, False),
    ("classification", "83588754-1d81-4cc9-a123-4eaabf331f05", "numismatic", "Numismatic", "Coins, medals, and related items", None, 14, True, False),
    ("classification", "f84b54f7-63e5-44cd-8563-34c7ec1b4d45", "costume", "Costume", "Articles of dress and accessories", None, 15, True, False),
    ("classification", "d6756161-d9ba-4942-a500-a79482727942", "tool", "Tool", "Implements used for work", None, 16, True, False),
    ("classification", "882e9ca7-2e44-4466-9e74-9dbd03aeea8c", "weapon", "Weapon", "Instruments of combat", None, 17, True, False),
    ("classification", "d19a6eb1-1292-4a4a-baba-f92012f524ac", "vessel", "Vessel", "Containers for holding substances", None, 18, True, False),
    ("classification", "acdc9d02-0b66-4538-a257-756cd2f8c8db", "architectural_element", "Architectural Element", "Components from buildings", None, 19, True, False),
    ("classification", "f64f8993-f8cb-46ae-929a-059fe40abe20", "mixed_media", "Mixed Media", "Works combining multiple media", None, 20, True, False),
    ("classification", "f2e8d76a-d4a8-42e9-9928-6df83ab0ff8e", "installation", "Installation", "Site-specific artistic works", None, 21, True, False),
    ("classification", "fd002436-d4bc-4a5b-988b-c0b43a2a7596", "digital", "Digital", "Born-digital or digitally created works", None, 22, True, False),
    ("classification", "021a6985-603d-406d-8887-e6d0892997e1", "natural_history", "Natural History Specimen", "Specimens from the natural world", None, 23, True, False),
    ("classification", "43cc1593-71f1-4535-bf32-ec80b0491a30", "ethnographic", "Ethnographic Object", "Objects related to cultural practices", None, 24, True, False),
    ("classification", "b9cd92e3-7d50-4378-99a5-a6df058c1de7", "decorative_art", "Decorative Art", "Functional objects with artistic design", None, 25, True, False),
    ("classification", "8bd90458-1f57-4941-a781-a5a15acbf5f9", "other", "Other", "Objects not fitting other classifications", None, 99, True, False),
    # -- committee_recommendation --
    ("committee_recommendation", "10774e9e-a5ac-4a63-8959-d9cd0fef4046", "approve", "Approve", "Approved for deaccession", None, 0, True, False),
    ("committee_recommendation", "9bd249ed-76d5-450a-bd95-139b8a4c95c2", "reject", "Reject", "Rejected", None, 1, True, False),
    ("committee_recommendation", "51d5cdae-87f5-40af-a541-d47da2265f0e", "defer", "Defer for Further Review", "More review needed", None, 2, True, False),
    # -- condition --
    ("condition", "b7811079-2a9f-47ba-9137-e23cdaaa3638", "excellent", "Excellent", "Object in excellent condition", None, 0, True, False),
    ("condition", "7f113aeb-7ced-4d47-9c41-29a63319caf6", "good", "Good", "Object in good condition", None, 1, True, False),
    ("condition", "804cf19c-a0ba-4daa-9540-5e9d979aee9e", "fair", "Fair", "Object in fair condition", None, 2, True, False),
    ("condition", "1b2f0aca-bd58-4e85-b50e-ff101bd0cd70", "poor", "Poor", "Object in poor condition", None, 3, True, False),
    ("condition", "a8eaf3e7-dc2a-4142-88ec-980362f48a11", "unacceptable", "Unacceptable", "Object in unacceptable condition", None, 4, True, False),
    ("condition", "219ad9e0-5114-44ae-8271-6645ad9eca11", "critical", "Critical", "Object in critical condition requiring immediate attention", None, 5, True, False),
    # -- contact_role --
    ("contact_role", "af813da3-099f-470f-9079-2bbaf8759f66", "creator", "Creator", "Created the object", None, 0, True, False),
    ("contact_role", "057626d8-f354-4dc8-b5a4-5e412647161b", "donor", "Donor", "Donated the object", None, 1, True, False),
    ("contact_role", "9a7f7e7e-3e12-4442-b8bf-87739af70172", "previous_owner", "Previous Owner", "Previously owned", None, 2, True, False),
    ("contact_role", "db8b965e-e68a-4e92-a7ba-88e79a46d8f4", "depicted", "Depicted Subject", "Depicted in the object", None, 3, True, False),
    ("contact_role", "c53affc2-ae67-4827-8bce-e033cf6a56ab", "associated", "Associated Person", "Associated with object", None, 4, True, False),
    # -- constituent_role_object --
    ("constituent_role_object", "84b7afd5-ff61-4b6c-bfcd-655481a5d6cd", "creator", "Creator", "Created the object", None, 0, True, False),
    ("constituent_role_object", "bde25cc8-da3b-4905-95ca-5c77be748f89", "maker", "Maker", "Made the object", None, 1, True, False),
    ("constituent_role_object", "d0b46bbf-e71f-4299-b925-68968e280304", "manufacturer", "Manufacturer", "Manufactured the object", None, 2, True, False),
    ("constituent_role_object", "78007a56-5b71-4e1b-a8c9-1aeba21aa076", "designer", "Designer", "Designed the object", None, 3, True, False),
    ("constituent_role_object", "28833b7e-b985-4732-bb94-dab32277a2a8", "donor", "Donor", "Donated the object", None, 4, True, False),
    ("constituent_role_object", "830232f5-2d0f-4613-8d34-73502c602e75", "previous_owner", "Previous Owner", "Previously owned the object", None, 5, True, False),
    ("constituent_role_object", "752a0973-6257-469e-9a52-fe5b5104300d", "commissioner", "Commissioner", "Commissioned the object", None, 6, True, False),
    ("constituent_role_object", "1a4c70e7-57d5-4856-9330-b514842496b8", "patron", "Patron", "Patronized the creation", None, 7, True, False),
    ("constituent_role_object", "6df80e00-5625-4ada-b4e6-74a1e351c699", "depicted", "Depicted", "Depicted in the object", None, 8, True, False),
    ("constituent_role_object", "191d9d00-9c8a-4050-93ba-bb780248643b", "associated", "Associated", "Associated with the object", None, 9, True, False),
    ("constituent_role_object", "77bb915a-f545-486f-b9fe-7c4455603c55", "publisher", "Publisher", "Published the work", None, 10, True, False),
    ("constituent_role_object", "986dc10a-e9f8-4212-bb27-95a3154fde7e", "printer", "Printer", "Printed the work", None, 11, True, False),
    ("constituent_role_object", "440c1d7f-7f31-4cf0-9fa0-398624b5d686", "author", "Author", "Authored the work", None, 12, True, False),
    ("constituent_role_object", "066a3341-ae11-441e-8419-1774d0673dd5", "editor", "Editor", "Edited the work", None, 13, True, False),
    ("constituent_role_object", "3d215f44-b4c8-4f11-818e-73a85a873828", "photographer", "Photographer", "Photographed the object", None, 14, True, False),
    ("constituent_role_object", "03d12ac6-70bb-4419-8d8f-965bd1f08f61", "artist", "Artist", "Created the artwork", None, 15, True, False),
    # -- constituent_role_acquisition --
    ("constituent_role_acquisition", "ebc0d767-5258-4e8a-baff-2e5b11956ede", "donor", "Donor", "Donated the object", None, 0, True, False),
    ("constituent_role_acquisition", "6e63de2d-d327-49ce-8d36-ec3a0bb94173", "source", "Source", "Source of the acquisition", None, 1, True, False),
    ("constituent_role_acquisition", "41d14b44-9ca5-4cb2-bc52-c7745484c1d9", "appraiser", "Appraiser", "Appraised the object", None, 2, True, False),
    ("constituent_role_acquisition", "59750d4c-a65e-4715-ad81-825ba382533d", "agent", "Agent", "Acted as agent", None, 3, True, False),
    ("constituent_role_acquisition", "80eabb9d-260b-4b4f-bf3e-d16019840b50", "associated", "Associated", "Associated with the acquisition", None, 4, True, False),
    # -- constituent_role_exhibition --
    ("constituent_role_exhibition", "d364b425-83f2-45b0-8826-b1c452c6108a", "curator", "Curator", "Curated the exhibition", None, 0, True, False),
    ("constituent_role_exhibition", "67dca357-f1a8-476b-b989-6f18744a4346", "organizer", "Organizer", "Organized the exhibition", None, 1, True, False),
    ("constituent_role_exhibition", "3ec6aa2c-1f5e-40ed-9110-72cff9df8524", "designer", "Designer", "Designed the exhibition", None, 2, True, False),
    ("constituent_role_exhibition", "eb33b6f5-8c35-442b-a7ee-9c03e71021fc", "contact", "Contact", "Point of contact", None, 3, True, False),
    ("constituent_role_exhibition", "227dde1c-c616-4703-8c43-1d8e03b93ff2", "lender", "Lender", "Lent objects to the exhibition", None, 4, True, False),
    ("constituent_role_exhibition", "25923369-df5a-439c-b17c-5dbbeb5315f5", "associated", "Associated", "Associated with the exhibition", None, 5, True, False),
    # -- constituent_role_event --
    ("constituent_role_event", "f8703ca7-86e8-4e64-898c-e046b53e82a0", "associated", "Associated", "Associated with the event", None, 0, True, False),
    ("constituent_role_event", "9512501f-0d26-449c-ba2f-1e2cd2143550", "organizer", "Organizer", "Organized the event", None, 1, True, False),
    ("constituent_role_event", "73b04cd6-6d71-4e89-96f6-e2f3e05b61d5", "participant", "Participant", "Participated in the event", None, 2, True, False),
    ("constituent_role_event", "3d8fa3d0-e946-40d3-88b1-9e4da28f3a70", "speaker", "Speaker", "Spoke at the event", None, 3, True, False),
    ("constituent_role_event", "f18eea6c-8994-496b-a10b-25dff69cf580", "contact", "Contact", "Point of contact", None, 4, True, False),
    # -- constituent_role_shipment --
    ("constituent_role_shipment", "585ea0dd-bd6d-4c94-a738-7c5405e3dd03", "shipper", "Shipper", "Shipped the objects", None, 0, True, False),
    ("constituent_role_shipment", "c30ebd83-e49a-4399-9177-1c71c3f04f43", "carrier", "Carrier", "Carried the shipment", None, 1, True, False),
    ("constituent_role_shipment", "9b00af26-a40e-4310-bf60-16c84c885fe5", "courier", "Courier", "Couriered the shipment", None, 2, True, False),
    ("constituent_role_shipment", "084a8a7a-833b-48e0-81ec-4b976158f1b9", "contact", "Contact", "Point of contact", None, 3, True, False),
    # -- constituent_role_conservation --
    ("constituent_role_conservation", "2a1095b0-e724-497d-bb50-46a771f7b6a8", "examiner", "Examiner", "Examined the object", None, 0, True, False),
    ("constituent_role_conservation", "e7d8651e-5447-4545-8fe4-9ab7fd6f745e", "conservator", "Conservator", "Treated the object", None, 1, True, False),
    ("constituent_role_conservation", "67c896ce-bcd8-4d20-8c93-cfa92bc21324", "analyst", "Analyst", "Performed analysis", None, 2, True, False),
    ("constituent_role_conservation", "8be041f4-1395-455e-b4e4-b3451125e3dd", "contact", "Contact", "Point of contact", None, 3, True, False),
    # -- constituent_role_loan_in --
    ("constituent_role_loan_in", "6696e25c-89b2-4b3a-bbeb-252746fd5403", "lender", "Lender", "Lent the object", None, 0, True, False),
    ("constituent_role_loan_in", "52198492-5db8-4209-b463-55a878a69836", "contact", "Contact", "Point of contact", None, 1, True, False),
    ("constituent_role_loan_in", "224e1686-1d51-4823-bb8b-532ba747b89c", "courier", "Courier", "Couriered the object", None, 2, True, False),
    ("constituent_role_loan_in", "23cd7c24-2980-43f1-bf35-21360d0d1d98", "insurer", "Insurer", "Insured the object", None, 3, True, False),
    # -- constituent_role_loan_out --
    ("constituent_role_loan_out", "c1160c76-2f39-46b0-bb1b-66e5c4ba3ec2", "borrower", "Borrower", "Borrowed the object", None, 0, True, False),
    ("constituent_role_loan_out", "7f986f79-0697-472f-b292-164f8d2b558f", "contact", "Contact", "Point of contact", None, 1, True, False),
    ("constituent_role_loan_out", "3f69c757-0137-4aba-937a-28e8b4612909", "courier", "Courier", "Couriered the object", None, 2, True, False),
    ("constituent_role_loan_out", "7d8e7061-6ef7-473a-9ecc-8dd663494960", "insurer", "Insurer", "Insured the object", None, 3, True, False),
    # -- constituent_role_right --
    ("constituent_role_right", "8e4d1788-487b-4231-b44f-d744cf60d9d5", "rights_holder", "Rights Holder", "Holds the rights", None, 0, True, False),
    ("constituent_role_right", "6665640c-a1b4-4886-aa67-992946c396d1", "licensee", "Licensee", "Licensed the rights", None, 1, True, False),
    ("constituent_role_right", "19188c09-0527-43bb-84cc-b0fea974e478", "licensor", "Licensor", "Granted the license", None, 2, True, False),
    ("constituent_role_right", "bfa59d82-0420-44a8-bede-d748ba7bb0b9", "contact", "Contact", "Point of contact", None, 3, True, False),
    # -- constituent_role_generic --
    ("constituent_role_generic", "1f606367-1a0e-44ea-95d3-4ada8252f61e", "contact", "Contact", "Point of contact", None, 0, True, False),
    ("constituent_role_generic", "d653b7cd-74a3-4cd9-8f50-12c8b83643dd", "associated", "Associated", "Associated with the record", None, 1, True, False),
    ("constituent_role_generic", "3d6c0548-3dca-4cfe-a060-247d2a6f8f63", "appraiser", "Appraiser", "Appraised the object", None, 2, True, False),
    ("constituent_role_generic", "6c758df3-0c56-4c34-bd6b-f264776a8ad7", "handler", "Handler", "Handled the object", None, 3, True, False),
    ("constituent_role_generic", "e0e72336-9b1f-4218-9d51-69604127b139", "recipient", "Recipient", "Received the object", None, 4, True, False),
    ("constituent_role_generic", "ef6a10fe-4092-46d1-9648-7f9e3707735f", "depositor", "Depositor", "Deposited the object", None, 5, True, False),
    # -- copyright_status --
    ("copyright_status", "67808501-2b4f-4389-8468-77244b0b1b99", "public_domain", "Public Domain", "In public domain", None, 0, True, False),
    ("copyright_status", "f1afa59d-56e3-4e58-a554-94b142b84357", "in_copyright", "In Copyright", "Protected by copyright", None, 1, True, False),
    ("copyright_status", "a026188e-832e-4d8b-a238-6b364b21bc72", "copyright_undetermined", "Copyright Undetermined", "Status unknown", None, 2, True, False),
    ("copyright_status", "c7da0c1d-054e-4db0-9952-56896b32e879", "orphan_work", "Orphan Work", "Rights holder unknown", None, 3, True, False),
    ("copyright_status", "ecfbcef2-e929-46c6-a9c6-1a531628dabf", "cc_by", "CC BY", "Creative Commons Attribution", None, 4, True, False),
    ("copyright_status", "6d54af8e-f8d0-4f56-b630-2e1bca3d65a6", "cc_by_sa", "CC BY-SA", "Creative Commons Attribution-ShareAlike", None, 5, True, False),
    ("copyright_status", "7c86f1de-b64f-4e7f-9d7e-f55f6b6db541", "cc_by_nc", "CC BY-NC", "Creative Commons Attribution-NonCommercial", None, 6, True, False),
    # -- currency --
    ("currency", "a1b2c3d4-0001-4000-8000-000000000001", "USD", "US Dollar", "United States Dollar", None, 0, True, False),
    ("currency", "a1b2c3d4-0002-4000-8000-000000000002", "EUR", "Euro", "Euro", None, 1, True, False),
    ("currency", "a1b2c3d4-0003-4000-8000-000000000003", "GBP", "British Pound", "Pound Sterling", None, 2, True, False),
    ("currency", "a1b2c3d4-0004-4000-8000-000000000004", "CAD", "Canadian Dollar", "Canadian Dollar", None, 3, True, False),
    ("currency", "a1b2c3d4-0005-4000-8000-000000000005", "AUD", "Australian Dollar", "Australian Dollar", None, 4, True, False),
    ("currency", "a1b2c3d4-0006-4000-8000-000000000006", "CHF", "Swiss Franc", "Swiss Franc", None, 5, True, False),
    ("currency", "a1b2c3d4-0007-4000-8000-000000000007", "JPY", "Japanese Yen", "Japanese Yen", None, 6, True, False),
    ("currency", "a1b2c3d4-0008-4000-8000-000000000008", "CNY", "Chinese Yuan", "Chinese Yuan Renminbi", None, 7, True, False),
    ("currency", "a1b2c3d4-0009-4000-8000-000000000009", "SEK", "Swedish Krona", "Swedish Krona", None, 8, True, False),
    ("currency", "a1b2c3d4-0010-4000-8000-000000000010", "NOK", "Norwegian Krone", "Norwegian Krone", None, 9, True, False),
    ("currency", "a1b2c3d4-0011-4000-8000-000000000011", "DKK", "Danish Krone", "Danish Krone", None, 10, True, False),
    ("currency", "a1b2c3d4-0012-4000-8000-000000000012", "NZD", "New Zealand Dollar", "New Zealand Dollar", None, 11, True, False),
    ("currency", "a1b2c3d4-0013-4000-8000-000000000013", "MXN", "Mexican Peso", "Mexican Peso", None, 12, True, False),
    ("currency", "a1b2c3d4-0014-4000-8000-000000000014", "SGD", "Singapore Dollar", "Singapore Dollar", None, 13, True, False),
    ("currency", "a1b2c3d4-0015-4000-8000-000000000015", "HKD", "Hong Kong Dollar", "Hong Kong Dollar", None, 14, True, False),
    ("currency", "a1b2c3d4-0016-4000-8000-000000000016", "KRW", "South Korean Won", "South Korean Won", None, 15, True, False),
    ("currency", "a1b2c3d4-0017-4000-8000-000000000017", "INR", "Indian Rupee", "Indian Rupee", None, 16, True, False),
    ("currency", "a1b2c3d4-0018-4000-8000-000000000018", "BRL", "Brazilian Real", "Brazilian Real", None, 17, True, False),
    ("currency", "a1b2c3d4-0019-4000-8000-000000000019", "ZAR", "South African Rand", "South African Rand", None, 18, True, False),
    ("currency", "a1b2c3d4-0020-4000-8000-000000000020", "ILS", "Israeli Shekel", "Israeli New Shekel", None, 19, True, False),
    # -- deaccession_reason --
    ("deaccession_reason", "187e3544-c874-4735-a8c6-651dc59b993c", "duplicate", "Duplicate", "Duplicate of another object", None, 0, True, False),
    ("deaccession_reason", "f389d500-9f2a-41aa-b97f-42bbaf3f7fcb", "outside_scope", "Outside Collection Scope", "No longer fits collection scope", None, 1, True, False),
    ("deaccession_reason", "760a619c-b23b-4a9e-84b8-ec385383e7eb", "deterioration", "Deterioration Beyond Repair", "Condition is beyond conservation", None, 2, True, False),
    ("deaccession_reason", "921d2a90-ba8a-460d-a157-e2d20c931735", "repatriation", "Repatriation", "Being returned to origin", None, 3, True, False),
    ("deaccession_reason", "3493b1fa-d6c3-4ae8-9291-f4bf2ab6237a", "theft_loss", "Theft or Loss", "Object was stolen or lost", None, 4, True, False),
    ("deaccession_reason", "847a640b-9dd9-4a09-a5d6-06940457881f", "other", "Other", "Other reason", None, 5, True, False),
    # -- delivery_method --
    ("delivery_method", "742d2183-6c6d-4d9d-8250-23c994fe1600", "download", "Digital Download", "Electronic download", None, 0, True, False),
    ("delivery_method", "26fa266d-6fee-44da-8e17-d69afd635fcf", "physical", "Physical Delivery", "Physical shipping", None, 1, True, False),
    ("delivery_method", "90edfdb3-5a33-405b-9c1f-84dc9cf6563c", "api", "API Access", "Via API", None, 2, True, False),
    # -- disposal_method --
    ("disposal_method", "0eba6144-e324-4053-a2c8-27017bd12742", "sale", "Sale", "Sold", None, 0, True, False),
    ("disposal_method", "8ba556aa-6d22-4dac-80c1-a7859cf1097b", "gift", "Gift/Donation", "Donated to another institution", None, 1, True, False),
    ("disposal_method", "021a2acb-04c2-4f40-a87d-40459249d105", "exchange", "Exchange", "Exchanged with another institution", None, 2, True, False),
    ("disposal_method", "2494576f-8216-4cc8-9b91-fd2de70d04e7", "destruction", "Destruction", "Destroyed", None, 3, True, False),
    ("disposal_method", "825cb868-dc73-4bf5-903f-252c79d854f0", "repatriation", "Repatriation", "Returned to origin", None, 4, True, False),
    # -- documentation_plan_type --
    ("documentation_plan_type", "c6b5ceb7-0cb2-4df3-95e8-d4ef32fc4947", "documentation_policy", "Documentation Policy", "Overall documentation policy", None, 0, True, False),
    ("documentation_plan_type", "68a5cddf-fa40-43c6-b8cb-233648e76b3b", "cataloging_plan", "Cataloging Plan", "Cataloging plan", None, 1, True, False),
    ("documentation_plan_type", "dfcc5a08-dd93-480f-95a0-b42ad9ef14e5", "photography_plan", "Photography Plan", "Photography plan", None, 2, True, False),
    ("documentation_plan_type", "c4770b2d-78b2-4054-9e8e-620e3c4c95a2", "digitisation_plan", "Digitisation Plan", "Digitisation plan", None, 3, True, False),
    ("documentation_plan_type", "2eec9e30-778d-4900-b88f-3024b593700e", "inventory_plan", "Inventory Plan", "Inventory plan", None, 4, True, False),
    # -- entry_duration --
    ("entry_duration", "49720a1c-af49-4e71-9f76-6cceb60f0abd", "1_week", "1 Week", "One week", None, 0, True, False),
    ("entry_duration", "a8632bf5-24f1-4916-8cea-e2001424645d", "1_month", "1 Month", "One month", None, 1, True, False),
    ("entry_duration", "e32fb6f4-ef52-451e-986c-ea304d08e60f", "3_months", "3 Months", "Three months", None, 2, True, False),
    ("entry_duration", "1f9823ed-9028-43cb-ba2b-b44378d9e3bf", "6_months", "6 Months", "Six months", None, 3, True, False),
    ("entry_duration", "23e243e7-c415-4b4b-b8a6-dc4253aaf9f3", "indefinite", "Indefinite", "No set end date", None, 4, True, False),
    # -- entry_reason --
    ("entry_reason", "8bda11f7-a8c6-4107-aa34-fd3f0822b6e0", "loan_consideration", "Loan Consideration", "For potential loan", None, 0, True, False),
    ("entry_reason", "b1f4ce30-cf02-48c4-8aad-9a0737c01ed0", "gift_offer", "Gift Offer", "Offered as gift", None, 1, True, False),
    ("entry_reason", "c2fdd79c-139e-4fb9-a099-618b8935105e", "identification", "Identification", "For identification", None, 2, True, False),
    ("entry_reason", "283025d6-976b-42fa-802f-7fd26edfa922", "conservation", "Conservation", "For conservation", None, 3, True, False),
    ("entry_reason", "064c4c29-b455-47e8-91c8-83ed46b8cd44", "photography", "Photography", "For photography", None, 4, True, False),
    ("entry_reason", "9901f1d8-2817-4584-91f2-9d82297fa765", "research", "Research", "For research", None, 5, True, False),
    ("entry_reason", "118b263d-c310-4db3-9385-175f850ffb00", "other", "Other", "Other reason", None, 6, True, False),
    # -- event_audience --
    ("event_audience", "0970cc61-5cc3-4798-ad61-a758e77005b2", "public", "Public", "Open to the general public", None, 0, True, False),
    ("event_audience", "d6ba1a0d-1277-4c9b-a90c-c31a5618cbd6", "members", "Members", "Members only", None, 1, True, False),
    ("event_audience", "844cf503-0a04-4751-b3b6-02aff7f314f5", "internal", "Internal", "Staff only", None, 2, True, False),
    ("event_audience", "69e7d44b-021e-44bc-97cd-50115dd812ea", "students", "Students", "Student groups", None, 3, True, False),
    ("event_audience", "b2f3dca0-1e2d-4713-97f7-f1dcf52a04dc", "donors", "Donors", "Donors and supporters", None, 4, True, False),
    ("event_audience", "3d13bc8c-238a-49e7-9059-06d032c66bd4", "invitation_only", "Invitation Only", "By invitation only", None, 5, True, False),
    # -- event_type --
    ("event_type", "e3a750bb-5019-4d05-a733-3acebe42f20f", "teaching_session", "Teaching Session", "Educational session with students", None, 0, True, False),
    ("event_type", "8cfb64de-ab36-4db2-aecd-b4feeab7aea5", "program", "Program", "Public or member program", None, 1, True, False),
    ("event_type", "d8371e8b-ea5c-4c09-850f-5f38c40ba240", "opening_reception", "Opening Reception", "Exhibition or gallery opening event", None, 2, True, False),
    ("event_type", "bb0409f0-aee4-4082-928e-8b2ed41ea822", "donor_development", "Donor Development", "Donor cultivation event", None, 3, True, False),
    ("event_type", "5b52041a-5c71-4bf4-bc41-5042ff923630", "internal", "Internal", "Internal staff event", None, 4, True, False),
    # -- exit_reason --
    ("exit_reason", "f0c2c6df-69d3-46c0-95b2-b43fc41a5cff", "enquiry_return", "Enquiry Return", "Return after enquiry", None, 0, True, False),
    ("exit_reason", "e197b07a-bee9-4701-a012-0661fe0225f3", "loan_return", "Loan Return", "Return of loaned object", None, 1, True, False),
    ("exit_reason", "b4990d08-8f82-4644-87f9-3e28b9dc9ce3", "loan_out", "Loan Out", "Object going out on loan", None, 2, True, False),
    ("exit_reason", "70feafd3-5bda-4ca2-bf68-7153bfe4a19b", "transfer", "Transfer", "Transfer to another institution", None, 3, True, False),
    ("exit_reason", "77086819-5ffc-451a-b613-b832ca1e1fbc", "disposal", "Disposal", "Object being disposed of", None, 4, True, False),
    ("exit_reason", "ce6e3990-4323-4a1a-b3ae-f137e4af0e4c", "deaccession", "Deaccession", "Object being deaccessioned", None, 5, True, False),
    ("exit_reason", "c088c1ee-0db4-477f-b8cd-c7b996236e8a", "conservation", "Conservation", "Going for conservation treatment", None, 6, True, False),
    ("exit_reason", "ac8339ab-eae5-40cc-94b3-ef18c3b6b24a", "photography", "Photography", "Going for photography", None, 7, True, False),
    ("exit_reason", "60f59cba-7355-46b4-827c-4621139db72e", "repatriation", "Repatriation", "Being repatriated", None, 8, True, False),
    ("exit_reason", "0d624089-669a-4683-b6da-8ac0f9ccd66e", "other", "Other", "Other exit reason", None, 9, True, False),
    # -- fee_type --
    ("fee_type", "df0ae3ec-2ce5-4676-bbd6-91e7efd5fe6c", "flat", "Flat Fee", "Fixed flat fee", None, 0, True, False),
    ("fee_type", "6aab987a-c159-4d02-b83f-2693fe904703", "per_image", "Per Image", "Fee per image", None, 1, True, False),
    ("fee_type", "83f5a5f6-944c-46a9-a236-ad819b49e75b", "commercial_rate", "Commercial Rate", "Commercial pricing", None, 2, True, False),
    ("fee_type", "5a64d7fd-9bd7-4f77-9ef3-e5bb2cf76c5b", "educational_rate", "Educational Rate", "Educational discount", None, 3, True, False),
    ("fee_type", "d9bb0d4a-3807-4895-9d6f-6bfc7d76587a", "waived", "Waived", "Fee waived", None, 4, True, False),
    # -- gender --
    ("gender", "c1215344-d4e5-483b-ab94-4f7774705280", "male", "Male", "Male", None, 0, True, False),
    ("gender", "e4e62f4b-8943-4506-9642-bce3cc2bdd84", "female", "Female", "Female", None, 1, True, False),
    ("gender", "4b90ceeb-656e-4b42-99ea-ecdd2a694342", "non-binary", "Non-binary", "Non-binary", None, 2, True, False),
    ("gender", "ec1e65d7-23ef-4add-a954-9acd2680535f", "other", "Other", "Other", None, 3, True, False),
    # -- incident_type --
    ("incident_type", "1cf465de-dd02-4350-a69e-7d8b2479401f", "damage", "Damage", "Physical damage", None, 0, True, False),
    ("incident_type", "1ac6c424-3d10-4e1e-8dda-883aed11cca6", "loss", "Loss", "Object lost", None, 1, True, False),
    ("incident_type", "e323c264-59c5-48b6-8ece-ef51aad9b4be", "theft", "Theft", "Object stolen", None, 2, True, False),
    ("incident_type", "13562336-d266-41b4-aece-9fb03301805d", "vandalism", "Vandalism", "Vandalism", None, 3, True, False),
    ("incident_type", "d8e339c3-22fd-4b50-95ad-214e4334db4c", "environmental", "Environmental", "Environmental damage", None, 4, True, False),
    ("incident_type", "a7b3e1f2-c456-4d89-9012-3e4f5a6b7c8d", "fire", "Fire", "Fire damage", None, 5, True, False),
    ("incident_type", "b8c4f2e3-d567-4e9a-0123-4f5a6b7c8d9e", "water", "Water / Flood", "Water or flood damage", None, 6, True, False),
    ("incident_type", "c9d5e3f4-e678-4fab-1234-5a6b7c8d9e0f", "pest", "Pest / Infestation", "Pest or infestation damage", None, 7, True, False),
    ("incident_type", "c897fe99-fd42-4526-a6cf-28749cd7fcf5", "other", "Other", "Other incident", None, 8, True, False),
    # -- insurance_coverage_type --
    # -- legal_status --
    ("legal_status", "d3d0893f-9964-4444-9f03-5fe790d4ab36", "clear", "Clear", "No legal issues", None, 0, True, False),
    ("legal_status", "0c87df2a-ccfb-4c57-b0ce-c46adb0cd8ae", "pending_provenance", "Pending Provenance Research", "Provenance research in progress", None, 1, True, False),
    ("legal_status", "254580b7-fd69-4b52-a1aa-acefcec1ff9a", "disputed", "Disputed", "Ownership or provenance disputed", None, 2, True, False),
    ("legal_status", "4d33e25e-29af-4496-8908-bb86f7ee21ef", "restricted", "Restricted", "Subject to restrictions", None, 3, True, False),
    # -- license_type --
    ("license_type", "c54841c3-1d6f-4b5b-a394-0cbd21118842", "exclusive", "Exclusive License", "Exclusive license", None, 0, True, False),
    ("license_type", "a84c80fd-a6b7-4874-9fe0-cb8a8eb0fa8c", "non_exclusive", "Non-Exclusive License", "Non-exclusive license", None, 1, True, False),
    ("license_type", "0f28b261-16e1-4fdc-9c47-54f137fa43ea", "creative_commons", "Creative Commons", "Creative Commons license", None, 2, True, False),
    ("license_type", "f9bce8bb-47ca-49f4-8a99-e2ca9c27045d", "public_domain_dedication", "Public Domain Dedication", "Dedicated to public domain", None, 3, True, False),
    # -- life_role --
    ("life_role", "580be82f-7039-4b19-95ca-81ee049f36c7", "artist", "Artist", "Visual artist", None, 0, True, False),
    ("life_role", "ac2e1e3b-e0b2-4b05-a85d-e28c033793a8", "painter", "Painter", "Painter", None, 1, True, False),
    ("life_role", "ef92b391-d5cd-45dc-a8f7-386b00309224", "sculptor", "Sculptor", "Sculptor", None, 2, True, False),
    ("life_role", "4614a613-dde0-44e7-bb52-ddd0a29b0d3e", "photographer", "Photographer", "Photographer", None, 3, True, False),
    ("life_role", "d5f80346-8dfd-48de-a08c-8fb8b2384ddd", "printmaker", "Printmaker", "Printmaker", None, 4, True, False),
    ("life_role", "4f83c95c-13a2-4df7-8718-780491fb6700", "architect", "Architect", "Architect", None, 5, True, False),
    ("life_role", "53803756-57cd-4ef7-ab53-159922eb39c2", "designer", "Designer", "Designer", None, 6, True, False),
    ("life_role", "74d9d246-5772-45eb-8af6-a321c447e426", "craftsman", "Craftsman", "Craftsman", None, 7, True, False),
    ("life_role", "1ac7ff1c-b60e-483b-b727-68e24310a8b6", "ceramicist", "Ceramicist", "Ceramicist", None, 8, True, False),
    ("life_role", "5bba3411-2c5b-436a-bb4c-f91a718f08cb", "goldsmith", "Goldsmith", "Goldsmith", None, 9, True, False),
    ("life_role", "6c54e9aa-35f3-4adf-a2ed-d27fd6f24634", "silversmith", "Silversmith", "Silversmith", None, 10, True, False),
    ("life_role", "2ca9227f-5d84-4c39-921e-a4f632539fd7", "textile_artist", "Textile Artist", "Textile artist", None, 11, True, False),
    ("life_role", "f4705de7-9c90-49d0-8e4d-9e4999e0ef1a", "furniture_maker", "Furniture Maker", "Furniture maker", None, 12, True, False),
    ("life_role", "c176c6d9-a0d3-4365-b791-3e2f947640b9", "illustrator", "Illustrator", "Illustrator", None, 13, True, False),
    ("life_role", "6ab16c66-21c1-4131-ac70-12ee9d55fa72", "engraver", "Engraver", "Engraver", None, 14, True, False),
    ("life_role", "569bc94c-2968-4cbb-af83-8e5cbef7afb0", "collector", "Collector", "Art collector", None, 15, True, False),
    ("life_role", "558c5285-ce18-417e-a21a-7948fcecc766", "dealer", "Dealer", "Art dealer", None, 16, True, False),
    ("life_role", "3dda807b-b79b-4ef7-a8ab-b55bb657f392", "patron", "Patron", "Art patron", None, 17, True, False),
    ("life_role", "f0a4e5a9-7f3f-4f87-a7f3-bdca37b1fee9", "author", "Author", "Author", None, 18, True, False),
    ("life_role", "a79e7a82-7c4a-4f31-9136-363526e6156a", "critic", "Critic", "Art critic", None, 19, True, False),
    # -- loan_purpose --
    ("loan_purpose", "017be684-2bdd-41cc-b1d2-8ef91dd5b56f", "exhibition", "Exhibition", "For exhibition", None, 0, True, False),
    ("loan_purpose", "042e9a27-e7be-45c6-9980-f3e21abe9010", "research", "Research", "For research", None, 1, True, False),
    ("loan_purpose", "604883e8-8d07-4884-adbe-894d06f9b967", "conservation", "Conservation", "For conservation", None, 2, True, False),
    ("loan_purpose", "55cae7d6-0d68-4fab-a829-a7d7c79ce01c", "education", "Education", "For educational purposes", None, 3, True, False),
    ("loan_purpose", "dac629fe-05cc-4d75-9d28-45fb3877e548", "long_term", "Long-term Loan", "Extended loan period", None, 4, True, False),
    ("loan_purpose", "fad64411-91ae-4c6d-8a57-3aa3bfb230d4", "other", "Other", "Other purpose", None, 5, True, False),
    # -- object_status --
    ("object_status", "f95ad48c-f034-4814-9ed7-22acbdf4df5b", "pending", "Pending", "Pending accessioning", None, 0, True, False),
    ("object_status", "4595879e-3157-449c-8dd8-6bca1c6191a9", "accessioned", "Accessioned", "Formally accessioned", None, 1, True, False),
    ("object_status", "28cf50e8-1bd7-4cca-b5ef-849f338507fd", "active", "Active", "Active in collection", None, 2, True, False),
    ("object_status", "1c25ecb5-a01d-4a6f-923a-01ccc16b64cb", "on_loan", "On Loan", "Currently on loan", None, 3, True, False),
    ("object_status", "dd983dd8-24dc-4b53-b9f5-a521901f07af", "in_conservation", "In Conservation", "Under conservation", None, 4, True, False),
    ("object_status", "9818dfb9-ea92-4d8c-bba2-2e45aded1625", "deaccessioned", "Deaccessioned", "Removed from collection", None, 5, True, False),
    ("object_status", "947adaf9-58f8-425e-b2d4-3c5a7da0d997", "missing", "Missing", "Location unknown", None, 6, True, False),
    # -- object_type --
    ("object_type", "731edfe8-3488-4fc0-a4f9-7c817186ef61", "painting", "Painting", "Painting", None, 0, True, False),
    ("object_type", "1779f8e2-161a-4910-93b0-74d006fc0174", "sculpture", "Sculpture", "Sculpture", None, 1, True, False),
    ("object_type", "738a60f4-8a55-41a9-bb8f-b6446eb07f19", "photograph", "Photograph", "Photograph", None, 2, True, False),
    ("object_type", "eacbae64-eaef-4195-9ea9-030d77153f95", "print", "Print", "Print", None, 3, True, False),
    ("object_type", "3ec115b1-c04e-451b-922e-f7c20c7364ff", "drawing", "Drawing", "Drawing", None, 4, True, False),
    ("object_type", "bc94a6e4-0f69-4862-8b3f-a514b8644012", "textile", "Textile", "Textile", None, 5, True, False),
    ("object_type", "6ada295b-a4b9-4314-a20a-9b961322c32d", "ceramic", "Ceramic", "Ceramic", None, 6, True, False),
    ("object_type", "f865d30b-7c8e-4d33-a836-cbd79b8e1459", "furniture", "Furniture", "Furniture", None, 7, True, False),
    ("object_type", "4e671d13-4608-41f3-b702-c5a7290fe005", "decorative_art", "Decorative Art", "Decorative art", None, 8, True, False),
    ("object_type", "f01ec905-f2bb-434e-a728-db8457e27fff", "manuscript", "Manuscript", "Manuscript", None, 9, True, False),
    ("object_type", "0a81b5d6-dacf-4014-bf7b-9b0ae92a9534", "book", "Book", "Book", None, 10, True, False),
    ("object_type", "c40ae149-650a-4313-a61c-56e11a62e16f", "archive", "Archive", "Archival material", None, 11, True, False),
    ("object_type", "78f7e2ad-cbe3-46d8-8ac2-00c008756167", "other", "Other", "Other type", None, 12, True, False),
    # -- other_number_type --
    ("other_number_type", "5f35e70d-ac2b-4eb3-9528-a154a134c7a6", "alternate", "Alternate", "General alternate number", None, 0, True, False),
    ("other_number_type", "bbe00e5d-cc76-4f26-95ab-a5f2e50509e9", "previous_accession", "Previous Accession Number", "Prior accession number from this institution", None, 1, True, False),
    ("other_number_type", "c33ea5cd-3053-4bee-91ef-69e85c612ac0", "donor_number", "Donor Number", "Number assigned by donor", None, 2, True, False),
    ("other_number_type", "a62e5239-7688-4cad-ac63-d58822e6d227", "old_inventory", "Old Inventory Number", "Previous inventory number", None, 3, True, False),
    ("other_number_type", "1fbe84e1-79aa-4364-b20e-20325d177b97", "catalog_raisonne", "Catalog Raisonne Number", "Number from catalog raisonne", None, 4, True, False),
    ("other_number_type", "dbacaa86-6943-4133-8af8-e2ff945430a4", "exhibition_number", "Exhibition Number", "Number assigned for exhibition", None, 5, True, False),
    ("other_number_type", "491f9e1c-78c2-4bc8-b3e0-279d5cb04473", "loan_number", "Loan Number", "Number from lending institution", None, 6, True, False),
    ("other_number_type", "f252f1e2-688c-4218-b510-52ef6235f354", "registration_number", "Registration Number", "Registration number", None, 7, True, False),
    ("other_number_type", "909349c9-5cc7-4ca1-bf3e-b28023f6e5a1", "other", "Other", "Other number type", None, 8, True, False),
    # -- packing_method --
    ("packing_method", "7c59b1b5-aa9e-4ffc-832f-1cdb02c83a1f", "soft_pack", "Soft Pack", "Soft packing materials", None, 0, True, False),
    ("packing_method", "675a766a-c5c0-4120-866f-5b57f2577d9c", "museum_crate", "Museum Crate", "Professional museum crate", None, 1, True, False),
    ("packing_method", "6b58db1a-99cb-44bf-a947-53d0cc15eba8", "cardboard_box", "Cardboard Box", "Standard cardboard box", None, 2, True, False),
    ("packing_method", "94f29ace-8e7b-4c31-b9ae-96b76834a9a8", "travel_frame", "Travel Frame", "Travel frame for paintings", None, 3, True, False),
    ("packing_method", "9c8086b6-2801-46e9-af51-e45af0c5fdea", "custom", "Custom", "Custom packing solution", None, 4, True, False),
    ("packing_method", "86679695-182c-4bcd-b6c1-98afe3de71b1", "none", "None", "No special packing", None, 5, True, False),
    # -- priority --
    ("priority", "0a16f16f-34a3-4bf3-abb7-c2ce11b1a8ab", "urgent", "Urgent", "Requires immediate attention", None, 0, True, False),
    ("priority", "82f0fe04-8542-4654-aceb-28d9075757ac", "high", "High", "High priority", None, 1, True, False),
    ("priority", "ad271db1-a702-47da-a958-db4db22b626d", "medium", "Medium", "Medium priority", None, 2, True, False),
    ("priority", "9cec7e5d-29f9-478a-9498-8f292cd74953", "low", "Low", "Low priority", None, 3, True, False),
    # -- relationship_type --
    ("relationship_type", "cbe1efa4-70b7-448d-b33b-85f3161dbec9", "study_for", "Study For", "Preparatory study", None, 0, True, False),
    ("relationship_type", "13b3e4e8-71ad-4a66-943f-366ac2317d61", "copy_of", "Copy Of", "Copy of another work", None, 1, True, False),
    ("relationship_type", "929c6533-d852-486a-94b0-df9aab2f07fa", "part_of", "Part Of", "Part of a larger work", None, 2, True, False),
    ("relationship_type", "64b7fff1-e68b-4751-b525-35138c12d4a9", "pendant_of", "Pendant Of", "Companion piece", None, 3, True, False),
    ("relationship_type", "4357ff11-66e2-4101-94ef-d09baffccf70", "version_of", "Version Of", "Alternative version", None, 4, True, False),
    ("relationship_type", "8e96ac78-7430-43de-baf8-216d850a5646", "related_to", "Related To", "Generally related", None, 5, True, False),
    ("relationship_type", "28c42920-81de-4fc0-a4a7-0fcb1a25cbc6", "derived_from", "Derived From", "Based on another work", None, 6, True, False),
    # -- report_type --
    ("report_type", "510f4bf0-b3f6-420b-a271-0b859f0bb10a", "intake", "Intake", "Initial condition on arrival", None, 0, True, False),
    ("report_type", "55116290-5c79-4419-b8c1-0b645f8e98d0", "loan_out", "Loan Out", "Condition before loan departure", None, 1, True, False),
    ("report_type", "a23c4b9d-4a09-49cc-ae8a-9e6e65f7f5e4", "loan_in", "Loan In", "Condition on loan arrival", None, 2, True, False),
    ("report_type", "341815f8-9d27-46e5-be10-0a0f9a9f0957", "periodic", "Periodic", "Regular condition check", None, 3, True, False),
    ("report_type", "1bcd8a58-6376-4d15-b5ca-edcd7ec051f7", "conservation", "Conservation", "Conservation assessment", None, 4, True, False),
    ("report_type", "4fbc4499-04bf-47b3-be50-900933c49c9c", "incident", "Incident", "Following an incident", None, 5, True, False),
    # -- reproduction_purpose --
    ("reproduction_purpose", "2af25c39-abb8-43f8-a2a1-9f1284c6fb2c", "publication", "Publication", "For publication", None, 0, True, False),
    ("reproduction_purpose", "f061d2c0-b91a-4ccb-85fc-6127c888b94c", "exhibition", "Exhibition", "For exhibition", None, 1, True, False),
    ("reproduction_purpose", "958f0865-f6ee-4770-88c5-a108a904b121", "research", "Research", "For research", None, 2, True, False),
    ("reproduction_purpose", "a094180b-0438-4bef-b0bd-ce09d8a244d2", "commercial", "Commercial", "For commercial use", None, 3, True, False),
    ("reproduction_purpose", "53c1cc99-2d9a-4a05-b174-ac0cefdb6217", "educational", "Educational", "For educational use", None, 4, True, False),
    ("reproduction_purpose", "f05e021b-e430-43e0-94c0-03b0a8102ac1", "personal", "Personal", "For personal use", None, 5, True, False),
    # -- reproduction_type --
    ("reproduction_type", "97c66e2a-bfa9-453d-9eb9-7f95438435d3", "photograph", "Photograph", "Photographic reproduction", None, 0, True, False),
    ("reproduction_type", "e8fe9b3c-ddcb-4af6-848e-752c9658a1f5", "scan", "Scan", "Digital scan", None, 1, True, False),
    ("reproduction_type", "af7c217a-d965-4773-9cde-eb1f48591f25", "cast", "Cast/Mold", "Physical cast or mold", None, 2, True, False),
    ("reproduction_type", "817ab834-d9bd-4e39-9091-8fdd0220e1f5", "3d_print", "3D Print", "3D printed reproduction", None, 3, True, False),
    ("reproduction_type", "683ad237-d9f9-4569-b280-cf2302563dd5", "digital_copy", "Digital Copy", "Digital file copy", None, 4, True, False),
    ("reproduction_type", "f7e8b60e-f5b1-49f8-9018-a5b3373a069e", "print", "Print", "Printed reproduction", None, 5, True, False),
    ("reproduction_type", "90189b1b-394d-4760-91a3-f31fdaaa8254", "film", "Film", "Film reproduction", None, 6, True, False),
    # -- review_frequency --
    ("review_frequency", "5abc1977-5b8d-46e2-a704-d9b116ce2f18", "monthly", "Monthly", "Every month", None, 0, True, False),
    ("review_frequency", "70992a86-1c7b-4892-8fc1-3b2f89e6e55f", "quarterly", "Quarterly", "Every quarter", None, 1, True, False),
    ("review_frequency", "bb49a450-da0b-49d3-b4fb-57f42d8b782e", "biannually", "Bi-annually", "Twice per year", None, 2, True, False),
    ("review_frequency", "af7e969c-fa48-4320-a041-72fcae3b3459", "annually", "Annually", "Every year", None, 3, True, False),
    # -- review_type --
    ("review_type", "fb4931b1-1f38-4dc0-9bd8-928be6362272", "significance", "Significance Assessment", "Assess significance", None, 0, True, False),
    ("review_type", "5d2025f1-1195-4a17-ba22-d9f50431af24", "relevance", "Relevance Review", "Review relevance", None, 1, True, False),
    ("review_type", "c74d99af-9c16-4661-b689-5be93b488f3f", "care", "Care Assessment", "Care assessment", None, 2, True, False),
    ("review_type", "a55b37f3-4c3e-4138-abb5-6749721cfba0", "deaccession", "Deaccession Review", "Deaccession review", None, 3, True, False),
    ("review_type", "09333547-d48e-4e43-88a7-f59366507551", "rationalization", "Rationalization", "Rationalization review", None, 4, True, False),
    # -- right_status --
    ("right_status", "1370b47d-4421-4d3c-8108-114eff1b4aab", "unknown", "Unknown", "Status unknown", None, 0, True, False),
    ("right_status", "854f0d8a-91fd-413d-986e-491da8ebdadd", "public_domain", "Public Domain", "In public domain", None, 1, True, False),
    ("right_status", "9da4c954-d4f0-491e-88de-dcb5ecac2654", "owned", "Owned by Institution", "Institution owns the rights", None, 2, True, False),
    ("right_status", "81db677c-8050-4c77-8594-9d4fefd2d5b8", "licensed", "Licensed", "Licensed to institution", None, 3, True, False),
    ("right_status", "12a33c00-2b1f-49b3-999d-1dd479c5cf8d", "granted", "Granted to Third Party", "Rights granted to others", None, 4, True, False),
    # -- right_type --
    ("right_type", "7df79a5c-eee2-439c-b827-0e5113d48e8c", "copyright", "Copyright", "Copyright", None, 0, True, False),
    ("right_type", "bf650df9-c0de-4302-bcc8-3cc09db2d073", "reproduction", "Reproduction", "Reproduction rights", None, 1, True, False),
    ("right_type", "7d0a37b3-70bf-4580-a587-60596ca082fe", "exhibition", "Exhibition", "Exhibition rights", None, 2, True, False),
    ("right_type", "bd91228f-2c50-46b8-9ee8-2eeaa24b8ec6", "publication", "Publication", "Publication rights", None, 3, True, False),
    ("right_type", "67ad721c-84c0-49f9-a801-c95bb45b6e48", "broadcast", "Broadcast", "Broadcast rights", None, 4, True, False),
    ("right_type", "2b49321c-6a43-4980-9345-7a3ea758d325", "digital", "Digital", "Digital rights", None, 5, True, False),
    # -- role_qualifier --
    ("role_qualifier", "1ba3c08d-a62f-4122-97b3-776af78e6a76", "attributed_to", "Attributed to", "Work attributed to this person", None, 0, True, False),
    ("role_qualifier", "bac4e234-0104-4027-8136-6a722c72722f", "circle_of", "Circle of", "From the circle of", None, 1, True, False),
    ("role_qualifier", "5374b8c4-0471-41e0-b6ba-df7364eb0a27", "after", "After", "Copy after or in the style of", None, 2, True, False),
    ("role_qualifier", "645f0c3d-f68c-4af4-b674-f83e54c03e16", "school_of", "School of", "From the school of", None, 3, True, False),
    ("role_qualifier", "ba93c5c2-e6c7-4d04-976a-7195f10af2d8", "follower_of", "Follower of", "By a follower of", None, 4, True, False),
    ("role_qualifier", "fcfc5afb-75b0-4f02-81eb-be29443454cc", "workshop_of", "Workshop of", "From the workshop of", None, 5, True, False),
    ("role_qualifier", "b673ce2f-48ec-48c0-bc2a-bc2d574e4ce5", "manner_of", "Manner of", "In the manner of", None, 6, True, False),
    ("role_qualifier", "b169168b-46cc-4102-9deb-307dac5a5bf4", "studio_of", "Studio of", "From the studio of", None, 7, True, False),
    ("role_qualifier", "528a9b7f-ef76-4f63-b937-8f37bdce2ae7", "copy_after", "Copy after", "Copy after the original", None, 8, True, False),
    ("role_qualifier", "1314d76d-d416-4125-bd58-49d71687e7f5", "style_of", "Style of", "In the style of", None, 9, True, False),
    # -- sample_method --
    ("sample_method", "b81587e4-12fd-4865-814c-cb9ef68a1766", "complete", "Complete (100%)", "Check everything", None, 0, True, False),
    ("sample_method", "aed134eb-575c-474f-8f72-aafc411ab993", "random", "Random Sample", "Random selection", None, 1, True, False),
    ("sample_method", "57df4406-4620-40c0-a919-976facca2e9b", "stratified", "Stratified Sample", "Stratified sampling", None, 2, True, False),
    ("sample_method", "1d0f99db-d71c-4709-8f2a-0c2646ec7d27", "systematic", "Systematic Sample", "Systematic approach", None, 3, True, False),
    ("sample_method", "b23bfddc-ad5d-4019-968e-cd928e6baf41", "targeted", "Targeted Selection", "Targeted items", None, 4, True, False),
    # -- shipping_method --
    ("shipping_method", "1c07eb68-e79c-4ef0-8aca-a2dc0fc49e3f", "courier", "Courier", "Professional art courier", None, 0, True, False),
    ("shipping_method", "99031c60-8ac1-4047-a441-7117d8451771", "freight", "Freight", "Freight shipping", None, 1, True, False),
    ("shipping_method", "5f330e09-68c4-4f67-bdf8-9c6c1f0f69b9", "hand_carry", "Hand Carry", "Hand carried", None, 2, True, False),
    ("shipping_method", "91aa4b97-ef98-4f62-868e-eab84429fb5e", "registered_mail", "Registered Mail", "Registered postal service", None, 3, True, False),
    ("shipping_method", "4f4df1cb-8224-4c2a-9e92-95904c213ebd", "pickup", "Pickup by Recipient", "Recipient picks up", None, 4, True, False),
    ("shipping_method", "8e7ebc85-5e82-4640-8a4b-5f3adaf4e565", "other", "Other", "Other shipping method", None, 5, True, False),
    # -- source_type --
    ("source_type", "e74d315a-0615-4849-aba5-bf90454c817a", "individual", "Individual", "Private individual", None, 0, True, False),
    ("source_type", "39cfa194-1704-47da-86c0-90ae2e531325", "institution", "Institution", "Museum, library, or other institution", None, 1, True, False),
    ("source_type", "8891777f-fb7e-4888-a769-ec27806703c8", "estate", "Estate", "Estate of a deceased person", None, 2, True, False),
    ("source_type", "2ac6ae8d-f0da-4136-b048-285b0788d8ec", "dealer", "Dealer/Gallery", "Art dealer or gallery", None, 3, True, False),
    ("source_type", "f893915b-5dc8-49f3-b41c-4b6add8cc006", "auction", "Auction House", "Auction house", None, 4, True, False),
    ("source_type", "382663e7-ec95-42c5-93bb-255dfc82b31d", "other", "Other", "Other source type", None, 5, True, False),
    # -- treatment_type --
    ("treatment_type", "3621a068-9106-4d89-a1c6-a1296dbde86b", "preventive", "Preventive", "Preventive conservation", None, 0, True, False),
    ("treatment_type", "c6cdb9f5-7e16-416c-a7bb-a9be72baebe5", "remedial", "Remedial", "Remedial treatment", None, 1, True, False),
    ("treatment_type", "91de17be-9d65-41c1-9346-b30724012394", "restoration", "Restoration", "Restoration work", None, 2, True, False),
    ("treatment_type", "483f172f-873e-4aab-8ed8-401e58cb903c", "analysis", "Analysis", "Technical analysis", None, 3, True, False),
    ("treatment_type", "a197e1df-6e99-4e0e-a612-2bacb1a7917b", "other", "Other", "Other treatment", None, 4, True, False),
    # -- use_type --
    ("use_type", "508c8f10-59fe-49b3-b665-29fc6f2edddf", "research", "Research", "Research access", None, 0, True, False),
    ("use_type", "64cd0146-cc77-4b91-98fb-c20958462457", "exhibition", "Exhibition", "Exhibition use", None, 1, True, False),
    ("use_type", "6482b01e-1413-4e92-80b4-739481ce43bf", "reproduction", "Reproduction", "Reproduction request", None, 2, True, False),
    ("use_type", "9c0767bb-15ef-4d69-9065-e9f1c4bbc7a6", "education", "Education", "Educational use", None, 3, True, False),
    ("use_type", "fe41fc49-c4b4-4e6a-bbda-18a8115f74bd", "publication", "Publication", "Publication use", None, 4, True, False),
    # -- valuation_method --
    ("valuation_method", "5fb40f87-5fa5-4e8e-86c1-70482c743868", "comparable_sales", "Comparable Sales", "Based on similar sales", None, 0, True, False),
    ("valuation_method", "6f3c57f9-a05f-48dc-b18f-a7dee029ac56", "replacement_cost", "Replacement Cost", "Cost to replace or reproduce", None, 1, True, False),
    ("valuation_method", "77c23d77-31c2-43c9-8965-55dc617bfe5f", "income_approach", "Income Approach", "Based on income potential", None, 2, True, False),
    ("valuation_method", "642a0700-dd42-4c8c-8297-be5dbde2ef20", "expert_opinion", "Expert Opinion", "Professional appraiser opinion", None, 3, True, False),
    ("valuation_method", "106a616a-4d2e-40e5-9f93-4b7b137e5e41", "formula", "Formula", "Calculated by formula", None, 4, True, False),
    # -- valuation_type --
    ("valuation_type", "a53258de-3dd5-480f-b279-16aa8407070d", "insurance", "Insurance", "Insurance valuation", None, 0, True, False),
    ("valuation_type", "bf186305-7734-4c05-84f4-5e3345fdb774", "market", "Market Value", "Fair market value", None, 1, True, False),
    ("valuation_type", "4ef15da1-c25f-477d-bb3c-f1f95bd76667", "replacement", "Replacement Cost", "Cost to replace", None, 2, True, False),
    ("valuation_type", "0897b8f2-7df1-4e6b-bea3-34d6f4df1785", "probate", "Probate", "For estate purposes", None, 3, True, False),
    ("valuation_type", "e46a244b-3dc5-4e3c-883a-b4f90d57e8d1", "donation", "Donation", "For tax deduction purposes", None, 4, True, False),
]


# ---------------------------------------------------------------------------
# SQL statements
# ---------------------------------------------------------------------------

INSERT_CATEGORY_SQL = text("""
    INSERT INTO collections.lookup_categories
        (category_id, category_key, display_name, description,
         applicable_contexts, supports_icons)
    VALUES
        (CAST(:category_id AS uuid), :category_key, :display_name, :description,
         CAST(:applicable_contexts AS jsonb), :supports_icons)
    ON CONFLICT (category_key) DO NOTHING
""")

INSERT_VALUE_SQL = text("""
    INSERT INTO collections.lookup_values
        (value_id, category_id, organization_id, value_key, label,
         description, icon_name, sort_order, is_active, is_hidden)
    SELECT
        CAST(:value_id AS uuid),
        lc.category_id,
        NULL,
        :value_key,
        :label,
        :description,
        :icon_name,
        :sort_order,
        :is_active,
        :is_hidden
    FROM collections.lookup_categories lc
    WHERE lc.category_key = :category_key
    ON CONFLICT DO NOTHING
""")


# ---------------------------------------------------------------------------
# Seed function
# ---------------------------------------------------------------------------

def seed_lookup_data():
    """Seed lookup categories and lookup values."""
    settings = Settings()
    engine = create_engine(settings.database_url.unicode_string())

    print("\n" + "=" * 70)
    print("Seeding Lookup Categories and Lookup Values")
    print("=" * 70)

    with Session(engine) as session:
        # Bypass RLS for this seeding session
        session.execute(text("SET LOCAL row_security = off"))

        # ----- Categories -----
        print("\nCategories:")
        print("-" * 40)
        categories_inserted = 0
        for cat in LOOKUP_CATEGORIES:
            (category_id, category_key, display_name, description,
             applicable_contexts_json, supports_icons) = cat

            result = session.execute(INSERT_CATEGORY_SQL, {
                "category_id": category_id,
                "category_key": category_key,
                "display_name": display_name,
                "description": description,
                "applicable_contexts": applicable_contexts_json,
                "supports_icons": supports_icons,
            })
            if result.rowcount > 0:
                categories_inserted += 1
                print(f"  + {category_key}")
            else:
                print(f"  . {category_key} (exists)")

        # ----- Values -----
        print(f"\nValues ({len(LOOKUP_VALUES)} total):")
        print("-" * 40)
        values_inserted = 0
        current_category = None
        for val in LOOKUP_VALUES:
            (category_key, value_id, value_key, label, description,
             icon_name, sort_order, is_active, is_hidden) = val

            if category_key != current_category:
                current_category = category_key
                print(f"\n  [{category_key}]")

            result = session.execute(INSERT_VALUE_SQL, {
                "value_id": value_id,
                "category_key": category_key,
                "value_key": value_key,
                "label": label,
                "description": description,
                "icon_name": icon_name if icon_name else None,
                "sort_order": sort_order,
                "is_active": is_active,
                "is_hidden": is_hidden,
            })
            if result.rowcount > 0:
                values_inserted += 1
                print(f"    + {value_key}")
            else:
                print(f"    . {value_key} (exists)")

        session.commit()

        # ----- Summary -----
        cat_count = session.execute(
            text("SELECT count(*) FROM collections.lookup_categories")
        ).scalar()
        val_count = session.execute(
            text("SELECT count(*) FROM collections.lookup_values "
                 "WHERE organization_id IS NULL")
        ).scalar()

        print("\n" + "=" * 70)
        print(f"Categories inserted: {categories_inserted} / {len(LOOKUP_CATEGORIES)}")
        print(f"Values inserted:     {values_inserted} / {len(LOOKUP_VALUES)}")
        print(f"Total categories:    {cat_count}")
        print(f"Total system values: {val_count}")
        print("=" * 70 + "\n")


if __name__ == "__main__":
    seed_lookup_data()
