import { Handle, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';

export interface ConnectorDestinationNodeData {
  name: string;
  lastSync?: string;
  onClick?: () => void;
  isPlaceholder?: boolean;
}

export default function ConnectorDestinationNode({ data }: NodeProps<ConnectorDestinationNodeData>) {
  const isPlaceholder = data.isPlaceholder || false;
  const defaultBorderColor = isPlaceholder ? '#EEEDEA' : '#EEEDEA'; // Even lighter border for more de-emphasis

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
        onClick: data.onClick,
        onKeyDown: handleKeyDown,
        onMouseEnter: (e: React.MouseEvent<HTMLDivElement>) => {
          if (!isPlaceholder) {
            e.currentTarget.style.borderColor = '#C5C0B8';
            e.currentTarget.style.opacity = '1';
          }
        },
        onMouseLeave: (e: React.MouseEvent<HTMLDivElement>) => {
          e.currentTarget.style.borderColor = defaultBorderColor;
          e.currentTarget.style.opacity = '0.75';
        },
      }
    : {};

  return (
    <div
      {...buttonProps}
      title={!isPlaceholder ? data.name : undefined}
      style={{
        background: '#FCFCFB', // Very light, neutral background
        border: `1px solid ${defaultBorderColor}`, // Very low contrast border
        borderRadius: '2px',
        padding: '12px 16px', // Further reduced padding
        minWidth: '160px', // Smaller
        maxWidth: '200px',
        cursor: data.onClick ? 'pointer' : 'default',
        transition: 'border-color 0.15s ease, opacity 0.15s ease',
        opacity: 0.75, // More de-emphasis (was 0.85)
      }}
    >
      {/* Handle positioned on left - receives data FROM dataset */}
      <Handle 
        type="target" 
        position={Position.Left} 
        style={{ 
          background: '#B5AFA5', // More muted color
          opacity: 0.5,
          width: 7,
          height: 7,
        }} 
      />
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>        
        <div style={{ 
          fontSize: '12px', // Smaller text (was 13px)
          fontWeight: 400, // Lighter than sources (500)
          color: isPlaceholder ? '#B5AFA5' : 'rgb(var(--color-archive))', // More muted color
          fontFamily: 'Georgia, Cambria, serif',
          wordWrap: 'break-word',
          overflowWrap: 'break-word',
          hyphens: 'auto',
        }}>
          {data.name}
        </div>
        
        {data.lastSync && (
          <div style={{ fontSize: '10px', color: '#9B9389', marginTop: '2px' }}>
            {data.lastSync}
          </div>
        )}
      </div>
    </div>
  );
}
