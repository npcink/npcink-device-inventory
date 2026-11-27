import { Suspense, useEffect, useState, type ReactNode } from "react";

/** Load on first open, then retain the modal so its close animation and reset effects still run. */
export const DeferredPanel = ({ open, children }: { open: boolean; children: ReactNode }) => {
  const [activated, setActivated] = useState(open);
  useEffect(() => {
    if (open) setActivated(true);
  }, [open]);
  if (!open && !activated) return null;
  return <Suspense fallback={<div role="status">正在加载…</div>}>{children}</Suspense>;
};
