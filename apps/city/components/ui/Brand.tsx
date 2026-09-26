export function BrandMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M6 15 16 6l10 9v11H6z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      <rect x="13" y="17" width="6" height="9" rx="1" fill="#f2b35e" />
    </svg>
  );
}

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <a className="brand" href={href}>
      <BrandMark />
      <span className="brand-name">Porchlight</span>
    </a>
  );
}
