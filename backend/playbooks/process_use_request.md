# Use Request

*Auto-generated from the Madrona form registry and procedure requirements. Edit this file to add institutional context, procedure rationale, and common pitfalls.*

procedure: **Use of Collections**

## Fields

### Identification

- **Request number** *(required)* — `request_number` (text)
- **Request date** *(required)* — `request_date` (date)
- **Use type** *(required)* — `use_type` (enum)
- **Use purpose** *(required)* — `use_purpose` (text)
- **Use description** — `use_description` (text)

### Requester

- **Requester name** *(required)* — `requester_name` (text)
- **Requester title** — `requester_title` (text)
- **Institution** — `requester_institution` (text)
- **Email** — `requester_email` (text)
- **Phone** — `requester_phone` (text)

### Access

- **Access start date** — `access_date_start` (date)
- **Access end date** — `access_date_end` (date)
- **Location required** — `location_required` (text)
- **Special requirements** — `special_requirements` (text)

### Project

- **Project title** — `project_title` (text)
- **Project description** — `project_description` (text)
- **Project deadline** — `project_deadline` (date)
- **Funding source** — `funding_source` (text)

### Reproduction

- **Reproduction type** — `reproduction_type` (text)
- **Quantity** — `reproduction_quantity` (integer)
- **Format** — `reproduction_format` (text)
- **Intended use** — `intended_use` (text)
- **Publication details** — `publication_details` (text)
- **Credit line** — `credit_line` (text)

### Exhibition

- **Exhibition title** — `exhibition_title` (text)
- **Exhibition venue** — `exhibition_venue` (text)
- **Exhibition organizer** — `exhibition_organizer` (text)
- **Insurance value** — `insurance_value` (currency)
- **Currency** — `insurance_currency` (text)

### Approval

- **Approval date** — `approval_date` (date)
- **Approval conditions** — `approval_conditions` (text)
- **Denial reason** — `denial_reason` (text)

### Fees

- **Fee quoted** — `fee_quoted` (currency)
- **Fee paid** — `fee_paid` (currency)
- **Fee currency** — `fee_currency` (text)
- **Fee waived** — `fee_waived` (boolean)
- **Waiver reason** — `fee_waiver_reason` (text)
- **Invoice number** — `invoice_number` (text)
- **Payment date** — `payment_date` (date)

### Fulfillment

- **Fulfillment date** — `fulfillment_date` (date)
- **Fulfillment note** — `fulfillment_note` (text)

### Outcomes

- **Knowledge gained** — `knowledge_gained` (text)
- **Publication reference** — `publication_reference` (text)
- **Follow-up required** — `follow_up_required` (boolean)
- **Follow-up note** — `follow_up_note` (text)

### Notes

- **Request note** — `request_note` (text)
- **Internal note** — `internal_note` (text)
