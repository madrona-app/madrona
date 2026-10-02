import { memo } from 'react';
import { Handle, Position } from 'reactflow';

interface MergeNodeProps {
  data: {
    sourceCount?: number;
  };
}

function MergeNode({ data }: MergeNodeProps) {
  const sourceCount = data.sourceCount || 2;
  
  return (
    <div
      className="merge-node"
      style={{
        background: 'linear-gradient(135deg, #FFFFFF 0%, #F8F6F3 100%)',
        border: '2px solid #8B7355',
        borderRadius: '8px',
        padding: '10px 14px',
        fontSize: '11px',
        fontWeight: 600,
        color: '#5A4A3A',
        textAlign: 'center',
        minWidth: '100px',
        boxShadow: '0 3px 12px rgba(139, 115, 85, 0.2), 0 1px 4px rgba(0,0,0,0.1)',
        position: 'relative',
        transition: 'all 0.2s ease',
      }}
      title="Sources are merged at the dataset boundary. Conflicts are resolved by dataset rules."
    >
      {/* Left handles for incoming edges from sources */}
      <Handle
        type="target"
        position={Position.Left}
        style={{
          background: '#8B7355',
          width: 10,
          height: 10,
          border: '2px solid white',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }}
      />
      
      {/* Merge icon (funnel symbol) with label */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        gap: '7px',
      }}>
        <svg 
          width="16" 
          height="16" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* Funnel icon representing merge */}
          <path d="M3 3h18l-6 9v6l-6 3v-9l-6-9z"/>
        </svg>
        <span style={{ letterSpacing: '0.5px' }}>MERGE</span>
      </div>
      
      <div style={{ 
        fontSize: '9px', 
        color: '#8B7355', 
        marginTop: '3px',
        fontWeight: 500,
        textTransform: 'uppercase',
        letterSpacing: '0.3px',
      }}>
        {sourceCount} source{sourceCount > 1 ? 's' : ''}
      </div>
      
      {/* Right handle for outgoing edge to dataset */}
      <Handle
        type="source"
        position={Position.Right}
        style={{
          background: '#8B7355',
          width: 10,
          height: 10,
          border: '2px solid white',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }}
      />
    </div>
  );
}

export default memo(MergeNode);
