import React from 'react';

export type AdminColumn<T> = {
  key: string;
  header: string;
  /** Right-align and use tabular numerals. */
  numeric?: boolean;
  render: (row: T) => React.ReactNode;
};

export type AdminStatusTone = 'neutral' | 'success' | 'warning' | 'danger';

interface AdminTableProps<T> {
  columns: AdminColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyTitle?: string;
  emptyHint?: string;
  caption?: string;
}

/** Linear-style data table: sticky header, 40px rows, hairline separators, scrolls inside its frame. */
export function AdminTable<T>({
  columns,
  rows,
  rowKey,
  emptyTitle = 'Nothing here yet',
  emptyHint,
  caption,
}: AdminTableProps<T>): React.ReactElement {
  return (
    <div className="adm-table-wrap">
      <table className="adm-table">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.numeric ? 'adm-num' : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} style={{ height: 'auto', padding: 0, whiteSpace: 'normal' }}>
                <div className="adm-empty">
                  <strong>{emptyTitle}</strong>
                  {emptyHint}
                </div>
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((c) => (
                  <td key={c.key} className={c.numeric ? 'adm-num' : undefined}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function AdminStatus({ tone = 'neutral', children }: { tone?: AdminStatusTone; children: React.ReactNode }) {
  return <span className={`adm-status${tone === 'neutral' ? '' : ` adm-status--${tone}`}`}>{children}</span>;
}

export function AdminId({ id }: { id: string }) {
  return (
    <span className="adm-id" title={id}>
      {id.length > 12 ? `${id.slice(0, 8)}…` : id}
    </span>
  );
}

export function AdminPageHead({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="adm-head">
      <div>
        <h1 className="rd-h1">{title}</h1>
        {desc ? <p>{desc}</p> : null}
      </div>
      {children ? <div className="adm-toolbar">{children}</div> : null}
    </header>
  );
}

export function AdminStats({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <div className="adm-stats">
      {items.map((it) => (
        <div key={it.label} className="adm-stat">
          <div className="adm-stat-label">{it.label}</div>
          <div className="adm-stat-value">{it.value}</div>
        </div>
      ))}
    </div>
  );
}
