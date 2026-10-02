import type { NodeProps } from 'reactflow';

export interface MadronaContainerNodeData {
  onClick?: () => void;
}

export default function MadronaContainerNode({ data }: NodeProps<MadronaContainerNodeData>) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (data.onClick && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      data.onClick();
    }
  };

  return (
    <div
      onClick={data.onClick}
      onKeyDown={handleKeyDown}
      role={data.onClick ? 'button' : undefined}
      tabIndex={data.onClick ? 0 : undefined}
      title={data.onClick ? 'Canonical Store' : undefined}
      style={{
        width: '100%',
        height: '100%',
        background: 'rgba(243, 236, 221, 0.3)', // Subtle interior warmth
        border: '3px solid #C5BFB5', // Heavier boundary than connectors (3px vs 1px)
        borderRadius: '2px', // Subtle corners
        position: 'relative',
        boxSizing: 'border-box',
        cursor: data.onClick ? 'pointer' : 'default',
        transition: 'border-color 0.15s ease',
        boxShadow: 'inset 0 0 0 1px rgba(107, 122, 126, 0.08)', // Subtle interior depth
      }}
      onMouseEnter={(e) => {
        if (data.onClick) {
          e.currentTarget.style.borderColor = '#ADA79D'; // Subtle darkening only
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = '#C5BFB5';
      }}
    >
      {/* Handles removed - Madrona is a container, not a connection point */}
      
    </div>
  );
}
