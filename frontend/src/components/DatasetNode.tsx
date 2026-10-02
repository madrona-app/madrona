import { Handle, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';
import { formatNumber } from '../lib/formatters';

export interface DatasetNodeData {
  name: string;
  entityCount: number;
  highlighted?: boolean;
  onClick?: () => void;
  sourceCount?: number;
  destinationCount?: number;
}

export default function DatasetNode({ data }: NodeProps<DatasetNodeData>) {
  const borderColor = data.highlighted ? '#8B7355' : '#B5AFA5';
  const sourceCount = data.sourceCount || 0;
  const destinationCount = data.destinationCount || 0;
  const showPipeline = sourceCount > 0 || destinationCount > 0;

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
      title={data.name}
      style={{
        background: 'linear-gradient(135deg, #FEFDFB 0%, #F9F7F4 100%)', // Subtle gradient for depth
        border: `3px solid ${borderColor}`, // Thicker border for prominence
        borderRadius: '6px', // Slightly rounded for modern feel
        padding: '18px 22px 16px 22px', // Adjusted bottom padding for pipeline info
        minWidth: '200px', // Increased to accommodate longer pipeline text
        minHeight: '95px', // Increased for better proportions
        maxWidth: '200px', // Add maxWidth to prevent growth
        cursor: data.onClick ? 'pointer' : 'default',
        transition: 'all 0.2s ease',
        boxShadow: data.highlighted 
          ? '0 4px 16px rgba(139, 115, 85, 0.25), 0 2px 8px rgba(0,0,0,0.1)' 
          : '0 2px 12px rgba(139, 115, 85, 0.15), 0 1px 4px rgba(0,0,0,0.08)', // Stronger shadow for elevation
        position: 'relative',
      }}
    >
      {/* Handles for connecting edges - larger and more visible */}
      <Handle 
        type="target" 
        position={Position.Left} 
        id="left"
        style={{ 
          background: '#8B7355', 
          width: 12,
          height: 12,
          border: '2px solid white',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          opacity: 1,
        }} 
      />
      <Handle 
        type="source" 
        position={Position.Right} 
        id="right"
        style={{ 
          background: '#8B7355', 
          width: 12,
          height: 12,
          border: '2px solid white',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          opacity: 1,
        }} 
      />
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>        
        <div style={{ 
          fontSize: '15px', 
          fontWeight: 700, // Bolder for emphasis
          color: 'rgb(var(--color-forest))',
          fontFamily: 'Georgia, Cambria, serif',
          lineHeight: 1.3,
          textAlign: 'center', // Center align for nucleus effect
        }}>
          {data.name}
        </div>
        
        <div style={{ 
          fontSize: '11px', 
          color: '#8B7355', // Match theme color
          fontFamily: 'system-ui, sans-serif',
          fontVariantNumeric: 'tabular-nums',
          textAlign: 'center',
          fontWeight: 500,
        }}>
          {formatNumber(data.entityCount)} entities
        </div>
        
        {/* Pipeline summary: sources → destinations */}
        {showPipeline && (
          <div style={{
            fontSize: '10px',
            color: '#6B5645',
            fontFamily: 'system-ui, sans-serif',
            textAlign: 'center',
            marginTop: '4px',
            paddingTop: '6px',
            borderTop: '1px solid #E8E4DF',
            fontWeight: 500,
            letterSpacing: '0.2px',
          }}>
            {sourceCount} {sourceCount === 1 ? 'source' : 'sources'} → {destinationCount} {destinationCount === 1 ? 'destination' : 'destinations'}
          </div>
        )}
      </div>
    </div>
  );
}
