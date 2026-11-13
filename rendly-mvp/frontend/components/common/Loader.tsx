/** Inline spinner with an accessible label. */
export default function Loader({ label = 'Loading' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 rd-small rd-muted" role="status">
      <span className="rd-spinner" aria-hidden />
      {label}…
    </span>
  );
}
