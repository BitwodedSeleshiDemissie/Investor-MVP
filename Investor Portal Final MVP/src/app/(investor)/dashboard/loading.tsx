export default function DashboardLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-48 bg-secondary rounded-lg" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-28 bg-card border border-border rounded-xl" />
        ))}
      </div>
      <div className="h-64 bg-card border border-border rounded-xl" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="h-72 bg-card border border-border rounded-xl" />
        <div className="h-72 bg-card border border-border rounded-xl" />
      </div>
    </div>
  );
}
