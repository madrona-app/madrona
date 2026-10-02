import { useNavigate } from 'react-router-dom';
import { Workflow } from 'lucide-react';

interface FlowEmptyStateProps {
  organizationId: string;
}

/**
 * Empty state displayed when no pipelines/routes are configured.
 * Guides users to the Configuration page to set up their first pipeline.
 */
export function FlowEmptyState({ organizationId }: FlowEmptyStateProps) {
  const navigate = useNavigate();

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgb(var(--color-parchment))',
      }}
    >
      <div
        style={{
          textAlign: 'center',
          maxWidth: '400px',
          padding: '48px 32px',
        }}
      >
        {/* Icon */}
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: 'rgb(var(--color-lichen))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 24px',
          }}
        >
          <Workflow size={28} style={{ color: 'rgb(var(--color-archive))' }} />
        </div>

        {/* Title */}
        <h2
          style={{
            margin: '0 0 12px 0',
            fontSize: '20px',
            fontWeight: 500,
            color: '#2C3639',
            fontFamily: 'Georgia, serif',
          }}
        >
          No pipelines configured
        </h2>

        {/* Description */}
        <p
          style={{
            margin: '0 0 24px 0',
            fontSize: '14px',
            color: 'rgb(var(--color-archive))',
            fontFamily: 'Georgia, serif',
            lineHeight: 1.5,
          }}
        >
          Set up your first data pipeline to see how data flows from sources through your canonical
          store to destinations.
        </p>

        {/* CTA Button */}
        <button
          onClick={() => navigate(`/organizations/${organizationId}/bridge/setup`)}
          style={{
            padding: '10px 20px',
            fontSize: '14px',
            fontWeight: 500,
            fontFamily: 'Georgia, serif',
            color: 'rgb(var(--color-parchment-warm))',
            background: '#2C3639',
            border: 'none',
            borderRadius: '2px',
            cursor: 'pointer',
            transition: 'background 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#1F2A2C';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#2C3639';
          }}
        >
          Go to Configuration
        </button>
      </div>
    </div>
  );
}
