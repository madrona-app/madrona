/**
 * TermsAcceptancePanel Component
 *
 * Comprehensive UI for capturing and documenting depositor acceptance
 * of terms and conditions per procedure requirements.
 */

import { useState } from 'react';
import Checkbox from '../Checkbox';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle,
  AlertCircle,
  FileText,
  Calendar,
  User,
  X,
  Download,
  Eye,
  Clock,
  Search,
} from 'lucide-react';
import { getContact } from '../../lib/api';
import { formatDateShort, formatDateTime } from '../../lib/formatters';
import { ContactSelectorSlideOver } from './ConstituentSelectorSlideOver';

export interface TermsAcceptanceData {
  termsAccepted: boolean;
  acceptedDate: string;
  acceptedById: string;
  acceptedBy?: string; // Deprecated - for backwards compatibility display only
  signatureReference: string;
  signatureMediaId?: string;
  acceptanceMethod: 'signature' | 'email' | 'verbal' | 'online';
  acceptanceNote?: string;
}

export interface TermsAcceptancePanelProps {
  data: TermsAcceptanceData;
  onChange: (data: Partial<TermsAcceptanceData>) => void;
  isEditing: boolean;
  organizationId: string;
  entryId?: string;
  termsDocumentUrl?: string;
  onUploadSignature?: (file: File) => Promise<string | null>;
  onGenerateReceipt?: () => void;
  isGeneratingReceipt?: boolean;
}

const ACCEPTANCE_METHODS = [
  { value: 'signature', label: 'Physical Signature', description: 'Signed paper form' },
  { value: 'email', label: 'Email Confirmation', description: 'Written email acceptance' },
  { value: 'verbal', label: 'Verbal Agreement', description: 'Documented verbal acceptance' },
  { value: 'online', label: 'Online Acceptance', description: 'Digital form submission' },
];

export function TermsAcceptancePanel({
  data,
  onChange,
  isEditing,
  organizationId,
  entryId: _entryId,
  termsDocumentUrl,
  onGenerateReceipt,
  isGeneratingReceipt = false,
}: TermsAcceptancePanelProps) {
  const [showContactSelector, setShowContactSelector] = useState(false);

  // Fetch accepted by contact details
  const { data: acceptedByContact } = useQuery({
    queryKey: ['contact', organizationId, data.acceptedById],
    queryFn: () => getContact(organizationId, data.acceptedById),
    enabled: !!organizationId && !!data.acceptedById,
  });

  const acceptedByName = acceptedByContact?.name || data.acceptedBy || '';

  const handleAcceptanceToggle = (accepted: boolean) => {
    onChange({
      termsAccepted: accepted,
      acceptedDate: accepted && !data.acceptedDate
        ? new Date().toISOString().split('T')[0]
        : data.acceptedDate,
    });
  };

  return (
    <div className="space-y-6">
      {/* Terms Document Link */}
      {termsDocumentUrl && (
        <div className="flex items-center justify-between p-3 bg-stone/30 rounded-lg">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-archive" />
            <span className="text-sm text-ink">Terms & Conditions Document</span>
          </div>
          <a
            href={termsDocumentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm text-bark hover:text-copper-dark"
          >
            <Eye className="h-4 w-4" />
            View Document
          </a>
        </div>
      )}

      {/* Acceptance Status Card */}
      <div className={`p-4 rounded-lg border-2 ${
        data.termsAccepted
          ? 'border-semantic-success/40 bg-semantic-success/10'
          : 'border-semantic-warning/40 bg-semantic-warning/10'
      }`}>
        <div className="flex items-start gap-3">
          {data.termsAccepted ? (
            <CheckCircle className="h-6 w-6 text-semantic-success flex-shrink-0" />
          ) : (
            <AlertCircle className="h-6 w-6 text-semantic-warning flex-shrink-0" />
          )}
          <div className="flex-1">
            <h4 className={`text-sm font-medium ${
              data.termsAccepted
                ? 'text-semantic-success'
                : 'text-semantic-warning'
            }`}>
              {data.termsAccepted ? 'Terms Accepted' : 'Acceptance Pending'}
            </h4>
            <p className={`text-sm mt-1 ${
              data.termsAccepted
                ? 'text-semantic-success/80'
                : 'text-semantic-warning/80'
            }`}>
              {data.termsAccepted
                ? `Accepted by ${acceptedByName || 'depositor'} on ${data.acceptedDate ? formatDateShort(data.acceptedDate) : 'date not recorded'}`
                : 'Depositor has not yet accepted your terms and conditions.'
              }
            </p>
          </div>
          {isEditing && (
            <label className="flex items-center gap-2 cursor-pointer" data-field="terms_accepted">
              <Checkbox
                checked={data.termsAccepted}
                onChange={(e) => handleAcceptanceToggle(e.target.checked)}
                data-field="terms_accepted"
                id="field-terms_accepted"
              />
              <span className="text-sm font-medium text-ink">
                {data.termsAccepted ? 'Accepted' : 'Mark as Accepted'}
              </span>
            </label>
          )}
        </div>
      </div>

      {/* Acceptance Details Form */}
      {(isEditing || data.termsAccepted) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Accepted By */}
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-bark mb-1.5">
              <User className="h-4 w-4" />
              Accepted By
            </label>
            {isEditing ? (
              <div className="flex items-center gap-2">
                {data.acceptedById && acceptedByContact ? (
                  <div className="flex-1 flex items-center gap-2 px-3 py-2 border border-lichen rounded-lg bg-parchment">
                    <User size={16} className="text-archive flex-shrink-0" />
                    <span className="text-sm text-ink truncate">{acceptedByContact.name}</span>
                    <button
                      type="button"
                      onClick={() => onChange({ acceptedById: '' })}
                      className="ml-auto p-1 text-archive hover:text-semantic-error"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowContactSelector(true)}
                    className="flex-1 flex items-center gap-2 px-3 py-2 border-2 border-dashed border-lichen rounded-lg text-archive hover:border-bark hover:text-bark transition-colors"
                  >
                    <Search size={16} />
                    <span className="text-sm">Search or create contact...</span>
                  </button>
                )}
                {data.acceptedById && (
                  <button
                    type="button"
                    onClick={() => setShowContactSelector(true)}
                    className="px-3 py-2 text-sm text-bark hover:text-copper-dark"
                  >
                    Change
                  </button>
                )}
              </div>
            ) : (
              <p className="text-sm text-ink">{acceptedByName || 'Not recorded'}</p>
            )}
          </div>

          {/* Acceptance Date */}
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-bark mb-1.5">
              <Calendar className="h-4 w-4" />
              Acceptance Date
            </label>
            {isEditing ? (
              <input
                type="date"
                value={data.acceptedDate || ''}
                onChange={(e) => onChange({ acceptedDate: e.target.value })}
                className="w-full px-3 py-2 border border-lichen rounded-md text-sm focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
              />
            ) : (
              <p className="text-sm text-ink">
                {data.acceptedDate ? formatDateShort(data.acceptedDate) : 'Not recorded'}
              </p>
            )}
          </div>

          {/* Acceptance Method */}
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-bark mb-1.5">
              <CheckCircle className="h-4 w-4" />
              Acceptance Method
            </label>
            {isEditing ? (
              <select
                value={data.acceptanceMethod || 'signature'}
                onChange={(e) => onChange({ acceptanceMethod: e.target.value as TermsAcceptanceData['acceptanceMethod'] })}
                className="w-full px-3 py-2 border border-lichen rounded-md text-sm focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
              >
                {ACCEPTANCE_METHODS.map((method) => (
                  <option key={method.value} value={method.value}>
                    {method.label}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-sm text-ink">
                {ACCEPTANCE_METHODS.find(m => m.value === data.acceptanceMethod)?.label || 'Physical Signature'}
              </p>
            )}
          </div>

        </div>
      )}

      {/*
        Signature reference and upload were removed from this panel. Signed
        documents (the scanned entry form) are now attached via the
        polymorphic SignedDocumentSlot component rendered alongside this
        panel in TermsSection. The panel focuses on the acceptance metadata.
      */}

      {/* Acceptance Notes */}
      {(isEditing || data.acceptanceNote) && (
        <div>
          <label className="text-sm font-medium text-bark mb-1.5 block">
            Acceptance Notes
          </label>
          {isEditing ? (
            <textarea
              value={data.acceptanceNote || ''}
              onChange={(e) => onChange({ acceptanceNote: e.target.value })}
              placeholder="Additional notes about how acceptance was obtained..."
              rows={3}
              className="w-full px-3 py-2 border border-lichen rounded-md text-sm focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            />
          ) : (
            <p className="text-sm text-ink whitespace-pre-wrap">
              {data.acceptanceNote || 'No notes recorded'}
            </p>
          )}
        </div>
      )}

      {/* Generate Receipt Button */}
      {!isEditing && data.termsAccepted && onGenerateReceipt && (
        <div className="pt-4 border-t border-lichen">
          <button
            type="button"
            onClick={onGenerateReceipt}
            disabled={isGeneratingReceipt}
            className="flex items-center gap-2 px-4 py-2 bg-bark text-parchment rounded-md hover:bg-bark/90 transition-colors disabled:opacity-50"
          >
            {isGeneratingReceipt ? (
              <>
                <Clock className="h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Generate Receipt with Terms
              </>
            )}
          </button>
          <p className="text-xs text-archive mt-2">
            Creates a PDF receipt including terms acceptance confirmation for the depositor.
          </p>
        </div>
      )}

      {/* Audit Trail (read-only) */}
      {!isEditing && data.termsAccepted && (
        <div className="pt-4 border-t border-lichen">
          <h4 className="text-sm font-medium text-bark mb-2">Acceptance Audit Trail</h4>
          <div className="text-xs text-archive space-y-1 bg-stone/30 rounded-md p-3">
            <p>
              <span className="font-medium">Status:</span>{' '}
              {data.termsAccepted ? 'Accepted' : 'Pending'}
            </p>
            {acceptedByName && (
              <p>
                <span className="font-medium">Accepted by:</span> {acceptedByName}
              </p>
            )}
            {data.acceptedDate && (
              <p>
                <span className="font-medium">Date:</span>{' '}
                {formatDateTime(data.acceptedDate)}
              </p>
            )}
            {data.acceptanceMethod && (
              <p>
                <span className="font-medium">Method:</span>{' '}
                {ACCEPTANCE_METHODS.find(m => m.value === data.acceptanceMethod)?.label}
              </p>
            )}
            {data.signatureReference && (
              <p>
                <span className="font-medium">Reference:</span> {data.signatureReference}
              </p>
            )}
            {data.signatureMediaId && (
              <p>
                <span className="font-medium">Signature document:</span> Attached
              </p>
            )}
          </div>
        </div>
      )}

      {/* Contact Selector */}
      <ContactSelectorSlideOver
        isOpen={showContactSelector}
        organizationId={organizationId}
        onClose={() => setShowContactSelector(false)}
        onSelect={(contactId) => {
          onChange({ acceptedById: contactId });
          setShowContactSelector(false);
        }}
        title="Select Accepting Party"
        subtitle="Search for the person who accepted the terms"
      />
    </div>
  );
}

export default TermsAcceptancePanel;
