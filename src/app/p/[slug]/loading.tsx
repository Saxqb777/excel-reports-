export default function Loading() {
  const cells = [
    { w: 12, h: 2 }, ...Array.from({ length: 6 }, () => ({ w: 2, h: 3 })), { w: 4, h: 7 }, { w: 5, h: 7 }, { w: 3, h: 7 }, { w: 8, h: 9 }, { w: 4, h: 9 },
  ];
  return (
    <div className="min-h-screen bg-bg" aria-busy="true" aria-label="Loading dashboard">
      <div className="h-11 border-b border-line" />
      <div className="h-9 border-b border-line" />
      <div className="grid grid-cols-12 gap-px bg-line">
        {cells.map((c, i) => (
          <div key={i} className="bg-bg p-3.5" style={{ gridColumn: `span ${c.w}`, height: c.h * 37 - 1 }}>
            <div className="h-2.5 w-24 animate-pulse bg-bg-sunk" style={{ animationDelay: `${i * 60}ms` }} />
            {c.h > 2 && <div className="mt-4 h-7 w-20 animate-pulse bg-bg-sunk" style={{ animationDelay: `${i * 60 + 100}ms` }} />}
          </div>
        ))}
      </div>
    </div>
  );
}
