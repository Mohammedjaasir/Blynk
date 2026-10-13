export function SkeletonCard() {
  return (<div className="pc"><div className="sk" style={{ width: 152, height: 152, borderRadius: 14 }} /><div className="sk" style={{ width: 90, height: 12, marginTop: 10 }} /><div className="sk" style={{ width: 120, height: 14, marginTop: 8 }} /></div>);
}
export function SkeletonRail({ count = 3 }: { count?: number }) {
  return <div className="rail" aria-busy="true" aria-label="Loading">{Array.from({ length: count }, (_, i) => <SkeletonCard key={i} />)}</div>;
}
