# Reproduction Request

*Auto-generated from the Madrona form registry and procedure requirements. Edit this file to add institutional context, procedure rationale, and common pitfalls.*

procedure: **Reproduction**

## Workflow statuses

  **Submitted** (`submitted`)
→ **Rights Review** (`rights_review`)
→ **Approved** (`approved`)
→ **Denied** (`denied`)
→ **In Production** (`in_production`)
→ **Delivered** (`delivered`)
→ **Completed** (`completed`)
→ **Cancelled** (`cancelled`)

## Fields

### Identification

- **Request number** *(required)* — `request_number` (text)
- **Object** — `object_id` (text)

### Requester

- **Requester name** *(required)* — `requester_name` (text)
- **Institution** — `requester_institution` (text)
- **Email** — `requester_email` (text)
- **Phone** — `requester_phone` (text)

### Reproduction

- **Reproduction type** *(required)* — `reproduction_type` (enum)
- **Purpose** — `reproduction_purpose` (text)
- **Intended use** — `intended_use` (text)
- **Quantity** — `quantity` (integer)
- **Format requested** — `format_requested` (text)
- **Dimensions requested** — `dimensions_requested` (text)

### Rights

- **Rights cleared** — `rights_cleared` (boolean)
- **Rights check date** — `rights_check_date` (date)
- **Rights restrictions** — `rights_restrictions` (text)
- **Credit line required** — `credit_line_required` (text)

### Fees

- **Fee type** — `fee_type` (text)
- **Fee amount** — `fee_amount` (currency)
- **Fee currency** — `fee_currency` (text)
- **Fee paid** — `fee_paid` (boolean)
- **Payment date** — `payment_date` (date)

### Fulfillment

- **Master file reference** — `master_file_reference` (text)
- **Delivery method** — `delivery_method` (text)
- **Delivery date** — `delivery_date` (date)
- **Quality approved** — `quality_approved` (boolean)

### Notes

- **Notes** — `notes` (text)

## Requirements by status

### To reach Submitted (`submitted`)

- Created At (`created_at`)
- Purpose (`reproduction_purpose`)
- Requester name (`requester_name`)

### To reach Rights Review (`rights_review`)

- Created At (`created_at`)
- Purpose (`reproduction_purpose`)
- Requester name (`requester_name`)

### To reach Approved (`approved`)

- Created At (`created_at`)
- Purpose (`reproduction_purpose`)
- Reproduction type (`reproduction_type`)
- Requester name (`requester_name`)

### To reach Denied (`denied`)

- Created At (`created_at`)
- Purpose (`reproduction_purpose`)
- Reproduction type (`reproduction_type`)
- Requester name (`requester_name`)

### To reach In Production (`in_production`)

- Created At (`created_at`)
- Purpose (`reproduction_purpose`)
- Reproduction type (`reproduction_type`)
- Requester name (`requester_name`)

### To reach Delivered (`delivered`)

- Created At (`created_at`)
- Purpose (`reproduction_purpose`)
- Reproduction type (`reproduction_type`)
- Requester name (`requester_name`)

### To reach Completed (`completed`)

- Created At (`created_at`)
- Purpose (`reproduction_purpose`)
- Reproduction type (`reproduction_type`)
- Requester name (`requester_name`)

### To reach Cancelled (`cancelled`)

- Created At (`created_at`)
- Purpose (`reproduction_purpose`)
- Reproduction type (`reproduction_type`)
- Requester name (`requester_name`)

## Procedure requirement details

### Request

- **Requester name** [blocking]
  Person requesting the reproduction (Procedure: Reproduction requester).
  *Required for: submitted, rights_review, approved, denied, in_production, delivered, completed, cancelled*
- **Request date** [blocking]
  Date the request was made (Procedure: Reproduction request date).
  *Required for: submitted, rights_review, approved, denied, in_production, delivered, completed, cancelled*
- **Use purpose** [blocking]
  Intended use of the reproduction (Procedure: Reproduction purpose).
  *Required for: submitted, rights_review, approved, denied, in_production, delivered, completed, cancelled*

### Reproduction

- **Reproduction type** [blocking]
  Type of reproduction — photograph, scan, cast, etc. (Procedure: Reproduction type).
  *Required for: approved, denied, in_production, delivered, completed, cancelled*
- **Reproduction format** [recommended]
  Format of the reproduction (Procedure: Reproduction format).
- **Reproduction quantity** [recommended]
  Number of reproductions requested.

### Rights

- **Rights information** [info]
  Rights cleared via linked object rights.

### Fulfillment

- **Fulfilled by** [recommended]
  Person who fulfilled the reproduction request.
  *Required for: delivered, completed, cancelled*
- **Fulfillment date** [recommended]
  Date the reproduction was delivered.
  *Required for: delivered, completed, cancelled*
