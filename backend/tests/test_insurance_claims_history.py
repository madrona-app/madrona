"""Claims listed on the policy and indemnity pages, with their history.

The policy workspace lists claims on the policy's coverages (policy_id
filter) and each claim's change history comes from the entity-history API
as entity type insurance_claim.
"""
import json
from datetime import date

from app.models import CollectionObject, IndemnityArrangement, InsuranceCoverage, InsurancePolicy


def _claims(org):
    return f"/api/organizations/{org.organization_id}/collections/insurance/claims"


def test_policy_claims_and_their_history(auth_setup, db_session):
    from app.models import Role
    from tests.conftest import _create_permission, _create_role_permission

    client, org, user = auth_setup
    org_id = org.organization_id
    # History is gated on the area's own view permission.
    role = db_session.query(Role).filter(Role.role_key == "admin").first()
    _create_role_permission(db_session, role, _create_permission(db_session, "insurance.view"))
    obj = CollectionObject(organization_id=org_id, object_number="INS.1")
    policies = [
        InsurancePolicy(organization_id=org_id, policy_number=f"FA-{i}",
                        effective_date=date(2026, 1, 1), expiration_date=date(2026, 12, 31))
        for i in range(2)
    ]
    ind = IndemnityArrangement(organization_id=org_id, program="us_arts", reference_number="AAI-1")
    db_session.add_all([obj, *policies, ind])
    db_session.flush()
    covs = [InsuranceCoverage(organization_id=org_id, policy_id=p.policy_id, covered_entity_type="collection_object",
                              covered_entity_id=obj.object_id) for p in policies]
    db_session.add_all(covs)
    db_session.commit()

    def create(**body):
        resp = client.post(_claims(org), data=json.dumps(body), content_type="application/json")
        assert resp.status_code == 201, resp.get_json()
        return resp.get_json()["claim_id"]

    mine = create(claim_number="CLM-1", coverage_id=str(covs[0].coverage_id), claimed_amount=1200)
    create(claim_number="CLM-2", coverage_id=str(covs[1].coverage_id))
    indemnity_claim = create(claim_number="CLM-3", indemnity_id=str(ind.indemnity_id))

    listed = client.get(_claims(org), query_string={"policy_id": str(policies[0].policy_id)}).get_json()
    assert [c["claim_number"] for c in listed["claims"]] == ["CLM-1"]
    listed = client.get(_claims(org), query_string={"indemnity_id": str(ind.indemnity_id)}).get_json()
    assert [c["claim_id"] for c in listed["claims"]] == [indemnity_claim]

    resp = client.patch(f"{_claims(org)}/{mine}", data=json.dumps({"adjuster_name": "R. Moss"}),
                        content_type="application/json")
    assert resp.status_code == 200, resp.get_json()
    assert client.post(f"{_claims(org)}/{mine}/file").status_code == 200

    resp = client.get(f"/api/organizations/{org_id}/entity-history/insurance_claim/{mine}")
    assert resp.status_code == 200, resp.get_json()
    items = resp.get_json()["items"]
    kinds = [e["change_type"] for e in items]
    assert kinds.count("created") == 1 and kinds.count("updated") >= 2
    assert all(e["changed_by_email"] == user.email for e in items)
    diffs = {d["field_name"]: (d["old_value"], d["new_value"])
             for e in items if e["change_type"] == "updated" for d in e["field_diffs"]}
    assert diffs["adjuster_name"] == (None, "R. Moss")
    assert diffs["status"] == ("draft", "filed")
