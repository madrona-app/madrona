import { X } from 'lucide-react';
import { formatRelativeTime } from '../lib/utils';
import type { Run } from '../lib/schemas';
import { useOrganization } from '../contexts/useOrganization';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useAccessibleModal, getModalAriaProps } from '../hooks/useAccessibleModal';

interface MadronaSyncDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  latestRun: Run | null;
}

export default function MadronaSyncDrawer({
  isOpen,
  onClose,
  latestRun,
}: MadronaSyncDrawerProps) {
  const { isMobile } = useBreakpoint();
  const { activeOrganizationId } = useOrganization();
  const { modalRef, titleId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'madrona-sync-drawer',
  });

  if (!isOpen) return null;

  const counts = latestRun?.counts;

  return (
    <>
      {/* Backdrop - click to close, keyboard handled by modal's Escape key */}
      { }
      <div
        className="drawer-backdrop"
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          zIndex: 999,
        }}
      />

      {/* Drawer */}
      <div
        ref={modalRef}
        {...getModalAriaProps(titleId)}
        className="drawer"
        style={{
          position: 'fixed',
          top: isMobile ? 'auto' : 0,
          right: isMobile ? 0 : 0,
          bottom: 0,
          left: isMobile ? 0 : 'auto',
          width: isMobile ? '100%' : '400px',
          maxWidth: isMobile ? '100%' : '90vw',
          maxHeight: isMobile ? '90vh' : '100vh',
          background: 'white',
          boxShadow: isMobile ? '0 -4px 12px rgba(0, 0, 0, 0.15)' : '-4px 0 12px rgba(0, 0, 0, 0.15)',
          borderRadius: isMobile ? '12px 12px 0 0' : 0,
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Drag handle for mobile */}
        {isMobile && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              padding: '12px 0 8px',
            }}
          >
            <div
              style={{
                width: '36px',
                height: '4px',
                background: 'rgb(var(--color-stone))',
                borderRadius: '2px',
              }}
            />
          </div>
        )}

        {/* Header */}
        <div
          style={{
            padding: isMobile ? '12px 16px 16px' : '20px 24px',
            borderBottom: '1px solid #E6E4DF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <h2 id={titleId} style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
            Pipeline Run
          </h2>
          <button
            onClick={onClose}
            aria-label="Close drawer"
            style={{
              background: 'none',
              border: 'none',
              padding: isMobile ? '10px' : '4px',
              minWidth: isMobile ? '44px' : 'auto',
              minHeight: isMobile ? '44px' : 'auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: 'rgb(var(--color-archive))',
              marginRight: isMobile ? '-10px' : 0,
            }}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '16px' : '24px', WebkitOverflowScrolling: 'touch' }}>
          {/* Purpose */}
          <div style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '12px' }}>
              Purpose
            </h3>
            <div style={{ fontSize: '14px', color: 'rgb(var(--color-accessible-gray))', lineHeight: '1.6' }}>
              <p style={{ margin: '0 0 12px 0' }}>
                <strong>Normalization:</strong> Align field names and vocabularies to canonical entity structure.
              </p>
              <p style={{ margin: '0 0 12px 0' }}>
                <strong>Change detection:</strong> Identify entity-level differences since last run.
              </p>
              <p style={{ margin: '0' }}>
                <strong>Incremental publish:</strong> Only changed entities are emitted downstream (if enabled).
              </p>
            </div>
          </div>

          {/* Latest Run */}
          {latestRun && counts && (
            <div style={{ marginBottom: '24px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '12px' }}>
                Latest run
              </h3>
              <div
                style={{
                  background: 'rgb(var(--color-parchment-warm))',
                  border: '1px solid #E6E4DF',
                  borderRadius: '8px',
                  padding: '12px',
                  marginBottom: '12px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '14px', color: 'rgb(var(--color-archive))' }}>Entities evaluated</span>
                  <span style={{ fontSize: '16px', fontWeight: 600, color: 'rgb(var(--color-ink))' }}>{counts.processed}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '14px', color: 'rgb(var(--color-archive))' }}>New</span>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: 'rgb(var(--color-ink))' }}>{counts.created}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '14px', color: 'rgb(var(--color-archive))' }}>Updated</span>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: 'rgb(var(--color-ink))' }}>{counts.updated}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '14px', color: 'rgb(var(--color-archive))' }}>Unchanged</span>
                  <span style={{ fontSize: '14px', color: 'rgb(var(--color-archive))' }}>{counts.noop}</span>
                </div>
              </div>
              <div style={{ fontSize: '13px', color: 'rgb(var(--color-archive))', textAlign: 'center' }}>
                Current as of {formatRelativeTime(latestRun.started_at || latestRun.finished_at || '')}
              </div>
            </div>
          )}

          {!latestRun && (
            <div
              style={{
                padding: '16px',
                background: 'rgb(var(--color-parchment-warm))',
                border: '1px solid #E6E4DF',
                borderRadius: '8px',
                fontSize: '14px',
                color: 'rgb(var(--color-archive))',
                textAlign: 'center',
              }}
            >
              No pipeline runs yet.
            </div>
          )}

          {/* View History Link */}
          {latestRun && (
            <div style={{ marginTop: '16px', textAlign: 'center' }}>
              <a
                href={activeOrganizationId ? `/organizations/${activeOrganizationId}/bridge/runs` : '/runs'}
                style={{
                  fontSize: '13px',
                  color: 'rgb(var(--color-bark))',
                  textDecoration: 'none',
                  borderBottom: '1px solid transparent',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
              >
                View history
              </a>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
