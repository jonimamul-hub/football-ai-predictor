export default function SecNav({ sections, active, setActive }) {
  return (
    <nav className="sec-nav">
      {sections.map(s => (
        <button
          key={s}
          className={"sec-btn " + (active === s ? 'active' : '')}
          onClick={() => setActive(s)}
        >
          {s.charAt(0).toUpperCase() + s.slice(1)}
        </button>
      ))}
    </nav>
  )
}
