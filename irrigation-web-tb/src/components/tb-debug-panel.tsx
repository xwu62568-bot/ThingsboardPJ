"use client";

import { useEffect, useState } from "react";
import { subscribeTbDebugLogs, type TbDebugEntry } from "@/lib/client/thingsboard";

export function TbDebugPanel() {
  const [entries, setEntries] = useState<TbDebugEntry[]>([]);

  useEffect(() => {
    return subscribeTbDebugLogs((entry) => {
      setEntries((current) => {
        const next = [entry, ...current.filter((item) => item.id !== entry.id)];
        return next.slice(0, 24);
      });
    });
  }, []);

  return (
    <section className="debugPanel">
      <div className="panelHeader">
        <div>
          <div className="panelTitle">TB 调试日志</div>
          <p className="muted">最近的 REST / WS / RPC 事件。</p>
        </div>
      </div>
      <div className="debugList">
        {entries.length === 0 ? <p className="muted">暂无日志</p> : null}
        {entries.map((entry) => (
          <article key={entry.id} className={`debugEntry ${entry.level}`}>
            <div className="debugHead">
              <strong>{entry.scope.toUpperCase()}</strong>
              <span>{formatTime(entry.at)}</span>
            </div>
            <p>{entry.message}</p>
            {entry.detail ? <pre>{entry.detail}</pre> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}
