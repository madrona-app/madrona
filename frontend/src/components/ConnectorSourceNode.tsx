import { useState } from 'react';
import { Handle, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';

export interface ConnectorSourceNodeData {
  name: string;
  lastSync?: string;
  onClick?: () => void;
  isPlaceholder?: boolean;
}

export default function ConnectorSourceNode({ data }: NodeProps<ConnectorSourceNodeData>) {
  const isPlaceholder = data.isPlaceholder || false;
  const defaultBorderColor = isPlaceholder ? '#E8E4DC' : 'rgb(var(--color-stone))';
  const [hovered, setHovered] = useState(false);
  // Hover darkens the border. State-driven (not imperative el.style) so the
  // var()-based default survives — both for real browsers and jsdom.
  const borderColor = hovered && !isPlaceholder && data.onClick ? '#ADA79D' : defaultBorderColor;

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
      title={!isPlaceholder ? data.name : undefined}
      style={{
        background: 'rgb(var(--color-parchment))',
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor,
        borderRadius: '2px',
        padding: '16px 20px',
        minWidth: '180px',
        maxWidth: '220px',
        cursor: data.onClick ? 'pointer' : 'default',
        transition: 'border-color 0.15s ease',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>        
        <div style={{ 
          fontSize: '14px', 
          fontWeight: 500, 
          color: isPlaceholder ? '#9B9389' : 'rgb(var(--color-forest))',
          fontFamily: 'Georgia, Cambria, serif',
          wordWrap: 'break-word',
          overflowWrap: 'break-word',
          hyphens: 'auto',
        }}>
          {data.name}
        </div>
        
        {data.lastSync && (
          <div style={{ fontSize: '11px', color: 'rgb(var(--color-archive))', marginTop: '2px' }}>
            {data.lastSync}
          </div>
        )}
      </div>
      
      <Handle type="source" position={Position.Right} style={{ background: 'rgb(var(--color-archive))' }} />
    </div>
  );
}
