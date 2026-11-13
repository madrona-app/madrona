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

  // A React Flow node contains Handle divs, which cannot live inside a native
  // <button>, so a clickable node is a role="button" div with Enter/Space
  // support. Props are applied together so a static node has none of them.
  const buttonProps = data.onClick
    ? {
        role: 'button' as const,
        tabIndex: 0,
        'aria-label': 'Canonical Store',
        onClick: data.onClick,
        onKeyDown: handleKeyDown,
        onMouseEnter: (e: React.MouseEvent<HTMLDivElement>) => {
          e.currentTarget.style.borderColor = '#ADA79D'; // Subtle darkening only
        },
        onMouseLeave: (e: React.MouseEvent<HTMLDivElement>) => {
          e.currentTarget.style.borderColor = '#C5BFB5';
        },
      }
    : {};

  return (
    <div
      {...buttonProps}
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
    >
      {/* Handles removed - Madrona is a container, not a connection point */}
      
    </div>
  );
}
