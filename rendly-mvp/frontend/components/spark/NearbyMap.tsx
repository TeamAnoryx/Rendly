'use client';

import dynamic from 'next/dynamic';
import './nearby-map.css';

export type NearbyMapPanelProps = {
  selected: string[];
  onSelect: (name: string) => void;
  maxReached: boolean;
};

const NearbyLeaflet = dynamic(() => import('./NearbyLeaflet'), {
  ssr: false,
  loading: () => (
    <div className="nbm-card nbm-loading" role="status">
      Loading map…
    </div>
  ),
});

export default function NearbyMapPanel(props: NearbyMapPanelProps) {
  return <NearbyLeaflet {...props} />;
}
