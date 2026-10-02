import { CheckSquare } from 'lucide-react';
import { WorkspaceSection, EditableField, EditableCheckbox } from '../../../components/workspace';
import type { FormData } from './types';

interface ClosingSectionProps {
  formData: FormData;
  isExpanded: boolean;
  isEditing: boolean;
  order: number | undefined;
  onToggle: () => void;
  onUpdateField: <K extends keyof FormData>(field: K, value: FormData[K]) => void;
}

export function ClosingSection({
  formData,
  isExpanded,
  isEditing,
  order,
  onToggle,
  onUpdateField,
}: ClosingSectionProps) {
  return (
    <WorkspaceSection
      id="closing"
      title="Closing"
      icon={<CheckSquare size={18} />}
      isExpanded={isExpanded}
      onToggle={onToggle}
      isEditing={isEditing}
      order={order}
    >
      <div className="space-y-6">
        {/* Invoice checklist item */}
        <div className="border border-lichen rounded-lg p-4">
          <EditableCheckbox
            label="Invoice sent"
            value={formData.closing_invoice_sent}
            isEditing={isEditing}
            onChange={(v) => onUpdateField('closing_invoice_sent', v)}
          />
          {formData.closing_invoice_sent && (
            <div className="mt-4 ml-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <EditableField
                label="Invoice date"
                value={formData.closing_invoice_date}
                isEditing={isEditing}
                onChange={(v) => onUpdateField('closing_invoice_date', v)}
                type="date"
              />
              <EditableField
                label="Invoice reference"
                value={formData.closing_invoice_reference}
                isEditing={isEditing}
                onChange={(v) => onUpdateField('closing_invoice_reference', v)}
              />
              <EditableField
                label="Invoice amount"
                value={formData.closing_invoice_amount}
                isEditing={isEditing}
                onChange={(v) => onUpdateField('closing_invoice_amount', v)}
                type="number"
              />
              <EditableField
                label="Invoice currency"
                value={formData.closing_invoice_currency}
                isEditing={isEditing}
                onChange={(v) => onUpdateField('closing_invoice_currency', v)}
              />
            </div>
          )}
        </div>

        {/* Receipt acknowledged checklist item */}
        <div className="border border-lichen rounded-lg p-4">
          <EditableCheckbox
            label="Safe receipt of objects acknowledged"
            value={formData.receipt_acknowledged}
            isEditing={isEditing}
            onChange={(v) => onUpdateField('receipt_acknowledged', v)}
          />
          {formData.receipt_acknowledged && (
            <div className="mt-4 ml-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <EditableField
                label="Acknowledgment date"
                value={formData.receipt_acknowledged_date}
                isEditing={isEditing}
                onChange={(v) => onUpdateField('receipt_acknowledged_date', v)}
                type="date"
              />
              <EditableField
                label="Acknowledgment reference"
                value={formData.receipt_acknowledged_reference}
                isEditing={isEditing}
                onChange={(v) => onUpdateField('receipt_acknowledged_reference', v)}
              />
            </div>
          )}
        </div>

        {/* Conditions met checklist item */}
        <div className="border border-lichen rounded-lg p-4">
          <EditableCheckbox
            label="All loan conditions met"
            value={formData.conditions_met_confirmed}
            isEditing={isEditing}
            onChange={(v) => onUpdateField('conditions_met_confirmed', v)}
          />
          {formData.conditions_met_confirmed && (
            <div className="mt-4 ml-6 space-y-4">
              <EditableField
                label="Conditions met date"
                value={formData.conditions_met_date}
                isEditing={isEditing}
                onChange={(v) => onUpdateField('conditions_met_date', v)}
                type="date"
              />
              <EditableField
                label="Conditions met notes"
                value={formData.conditions_met_note}
                isEditing={isEditing}
                onChange={(v) => onUpdateField('conditions_met_note', v)}
                multiline
              />
            </div>
          )}
        </div>

        {/* Closing notes — always shown */}
        <div>
          <EditableField
            label="Closing notes"
            value={formData.closing_note}
            isEditing={isEditing}
            onChange={(v) => onUpdateField('closing_note', v)}
            multiline
          />
        </div>
      </div>
    </WorkspaceSection>
  );
}
