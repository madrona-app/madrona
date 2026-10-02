
/**
 * Skeleton loading state for the flow canvas.
 * Shows placeholder shapes that match the expected layout structure.
 */
export function FlowSkeleton() {
  return (
    <div
      style={{
        width: '100%',
        height: 'calc(100vh - 150px)',
        background: 'rgb(var(--color-parchment))',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Skeleton CSS */}
      <style>
        {`
          @keyframes skeletonPulse {
            0%, 100% { opacity: 0.4; }
            50% { opacity: 0.7; }
          }
          .skeleton-pulse {
            animation: skeletonPulse 1.5s ease-in-out infinite;
          }
        `}
      </style>

      {/* Main content area */}
      <div
        style={{
          position: 'absolute',
          top: '60px',
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: '80px',
        }}
      >
        {/* Source connectors column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <SkeletonConnector />
          <SkeletonConnector />
          <SkeletonConnector />
        </div>

        {/* Madrona container */}
        <div
          className="skeleton-pulse"
          style={{
            width: '280px',
            height: '320px',
            background: 'rgb(var(--color-lichen))',
            borderRadius: '2px',
            border: '1px solid #D8D2C8',
            display: 'flex',
            flexDirection: 'column',
            padding: '20px',
          }}
        >
          {/* Label placeholder */}
          <div
            style={{
              width: '120px',
              height: '12px',
              background: 'rgb(var(--color-stone))',
              borderRadius: '2px',
              marginBottom: '24px',
            }}
          />

          {/* Dataset placeholders */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1 }}>
            <SkeletonDataset />
            <SkeletonDataset />
          </div>
        </div>

        {/* Destination connectors column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <SkeletonConnector />
          <SkeletonConnector />
        </div>
      </div>

      {/* Loading text */}
      <div
        style={{
          position: 'absolute',
          bottom: '40px',
          left: '50%',
          transform: 'translateX(-50%)',
          fontSize: '13px',
          color: 'rgb(var(--color-archive))',
          fontFamily: 'Georgia, serif',
        }}
      >
        Loading pipeline...
      </div>
    </div>
  );
}

function SkeletonConnector() {
  return (
    <div
      className="skeleton-pulse"
      style={{
        width: '160px',
        height: '52px',
        background: 'rgb(var(--color-lichen))',
        borderRadius: '2px',
        border: '1px solid #D8D2C8',
        padding: '12px',
      }}
    >
      <div
        style={{
          width: '80px',
          height: '10px',
          background: 'rgb(var(--color-stone))',
          borderRadius: '2px',
          marginBottom: '8px',
        }}
      />
      <div
        style={{
          width: '50px',
          height: '8px',
          background: 'rgb(var(--color-stone))',
          borderRadius: '2px',
        }}
      />
    </div>
  );
}

function SkeletonDataset() {
  return (
    <div
      style={{
        width: '100%',
        height: '80px',
        background: 'rgb(var(--color-parchment-warm))',
        borderRadius: '2px',
        border: '1px solid #D8D2C8',
        padding: '12px',
      }}
    >
      <div
        style={{
          width: '100px',
          height: '12px',
          background: 'rgb(var(--color-lichen))',
          borderRadius: '2px',
          marginBottom: '10px',
        }}
      />
      <div
        style={{
          width: '60px',
          height: '10px',
          background: 'rgb(var(--color-lichen))',
          borderRadius: '2px',
          marginBottom: '8px',
        }}
      />
      <div
        style={{
          width: '80px',
          height: '8px',
          background: 'rgb(var(--color-lichen))',
          borderRadius: '2px',
        }}
      />
    </div>
  );
}
